import JSZip from 'jszip'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom')
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  SERVICES, TEMPLATE_ORDER, ROW_DEFS, DEFAULT_MAPPING, ROW_ID_TO_SVC,
  ROW_DEFS_EN, DEFAULT_MAPPING_EN, ROW_ID_TO_SVC_EN,
} from './services'
import { CC_ITEMS } from './company-changes'
import { findMarkedRowId, findMarkedTable, setMarkedRowId } from './template-contract'
import { buildProposalPlan, type ProposalPlan } from './proposal-plan'

export const PROPOSAL_GENERATOR_CONTRACT_VERSION = '2026-08-31.1'

export interface DocInput {
  companyName: string
  date: string
  salutationEn: string
  salutationCn: string
  mode: 'full' | 'selected'
  selected: string[]
  feeOverrides: Record<string, number>
  ccOverrides: Record<string, number>
  sectionMapping?: Record<string, string[]>
  focServices?: string[]
  languageMode?: 'bilingual' | 'english-only'
}

// ── helpers ──────────────────────────────────────────────────────────────────

// Get the appropriate definitions set based on language mode
export function getDefinitionSet(languageMode?: string): {
  rowDefs: Record<string, { table: string; label: string; match: string }>
  mapping: Record<string, string[]>
  rowIdToSvc: Record<string, string>
  templateFileName: string
} {
  if (languageMode === 'english-only') {
    return {
      rowDefs: ROW_DEFS_EN,
      mapping: DEFAULT_MAPPING_EN,
      rowIdToSvc: ROW_ID_TO_SVC_EN,
      templateFileName: 'Tassure_Proposal_EN.docx',
    }
  }
  return {
    rowDefs: ROW_DEFS,
    mapping: DEFAULT_MAPPING,
    rowIdToSvc: ROW_ID_TO_SVC,
    templateFileName: 'Tassure_Proposal_CNEN.docx',
  }
}

function fmtSGD(n: number): string {
  const [int, dec] = n.toFixed(2).split('.')
  return 'SGD ' + int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + dec
}

export function directChildren(el: Element, localName: string): Element[] {
  const result: Element[] = []
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i]
    if (n.nodeType === 1 && (n as Element).localName === localName) {
      result.push(n as Element)
    }
  }
  return result
}

export function allDescendants(el: Element, localName: string): Element[] {
  const result: Element[] = []
  function walk(node: Element) {
    for (let i = 0; i < node.childNodes.length; i++) {
      const n = node.childNodes[i]
      if (n.nodeType !== 1) continue
      const child = n as Element
      if (child.localName === localName) result.push(child)
      walk(child)
    }
  }
  walk(el)
  return result
}

export function paraText(p: Element): string {
  return allDescendants(p, 't').map(t => t.textContent ?? '').join('')
}

export function cellText(tc: Element): string {
  return allDescendants(tc, 't').map(t => t.textContent ?? '').join('')
}

function rowIdForCell(text: string, table: string, languageMode?: string): string | null {
  const { rowDefs } = getDefinitionSet(languageMode)
  for (const [id, rd] of Object.entries(rowDefs)) {
    if (rd.table === table && text.includes(rd.match)) return id
  }
  return null
}

// Join text from all cells so tables with a leading "No." column still match correctly.
function rowLinked(cells: Element[], table: string, sel: Set<string>, mapping: Record<string, string[]>, languageMode?: string): boolean {
  const text = cells.map(c => cellText(c)).join(' ')
  if (text.includes('Service Scope') || text.includes('Total')) return true
  const rid = findRowId(cells, table, languageMode)
  if (rid === null) return true  // truly unknown rows always kept
  // FOC merge group rows are controlled directly by service selection, not via the configurable mapping
  if (table === 'main') {
    const FOC_RID_TO_SVC: Record<string, string> = {
      MAIN_POST_EP: 'POST_EP', MAIN_CORPPASS: 'CORPPASS',
      MAIN_PDPA: 'PDPA', MAIN_CORP_CONSULT: 'CORP_CONSULT',
    }
    if (FOC_RID_TO_SVC[rid] !== undefined) return sel.has(FOC_RID_TO_SVC[rid])
  }
  return [...sel].some(k => (mapping[k] ?? []).includes(rid))
}

// Find row ID by searching across all cells (handles tables with a leading number column).
export function findRowId(cells: Element[], table: string, languageMode?: string): string | null {
  const row = cells[0]?.parentNode as Element | undefined
  const markedRowId = row && row.nodeType === 1 ? findMarkedRowId(row) : null
  if (markedRowId) {
    const { rowDefs } = getDefinitionSet(languageMode)
    const definition = rowDefs[markedRowId]
    if (definition?.table === table) return markedRowId
  }
  const text = cells.map(c => cellText(c)).join(' ')
  return rowIdForCell(text, table, languageMode)
}

function fmtNum(n: number): string {
  return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// Split text at first Chinese character: ["English part", "中文部分"]
function splitAtChinese(text: string): [string, string] {
  // Match Chinese characters AND Chinese punctuation/symbols. Punctuation-
  // only marks (parens, brackets, the ellipsis "…", etc.) only count as
  // "Chinese starts here" when the text ALSO contains at least one genuine
  // CJK ideograph. Without that guard, a text node that's purely
  // decorative -- e.g. the signature block's dotted underline, built from
  // a repeated "…" with no actual Chinese words -- gets misclassified as
  // translatable Chinese content. removeChineseContent() then wipes it to
  // nothing for english-only output: the dotted line disappeared entirely,
  // as reported this session. Genuine bilingual text (e.g. a Chinese
  // phrase ending in "…") still has real ideographs elsewhere in the
  // string, so this guard doesn't change how those split.
  const hasIdeograph = /[一-鿿㐀-䶿]/u.test(text)
  const pattern = hasIdeograph
    ? /[一-鿿㐀-䶿（）【】《》「」『』、；，。！？：…]/u
    : /[一-鿿㐀-䶿]/u
  const m = text.search(pattern)
  return m === -1 ? [text, ''] : [text.slice(0, m), text.slice(m)]
}

// Build a <w:r> with explicit Calibri font and half-point size (e.g. '20' = 10pt, '18' = 9pt)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCalibriRun(text: string, szVal: string, xmlDoc: any, eastAsiaFont = 'Calibri', bold = false, asciiFont = 'Calibri'): Element {
  const r = xmlDoc.createElement('w:r')
  const rPr = xmlDoc.createElement('w:rPr')
  const rFonts = xmlDoc.createElement('w:rFonts')
  rFonts.setAttribute('w:ascii', asciiFont)
  rFonts.setAttribute('w:hAnsi', asciiFont)
  rFonts.setAttribute('w:eastAsia', eastAsiaFont)
  rPr.appendChild(rFonts)
  if (bold) { const b = xmlDoc.createElement('w:b'); rPr.appendChild(b) }
  const sz = xmlDoc.createElement('w:sz'); sz.setAttribute('w:val', szVal); rPr.appendChild(sz)
  const szCs = xmlDoc.createElement('w:szCs'); szCs.setAttribute('w:val', szVal); rPr.appendChild(szCs)
  r.appendChild(rPr)
  const t = xmlDoc.createElement('w:t')
  t.setAttribute('xml:space', 'preserve')
  t.textContent = text
  r.appendChild(t)
  return r
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function updateFeeCell(tc: Element, amount: number, xmlDoc: any, languageMode: 'bilingual' | 'english-only' = 'bilingual'): void {
  const num = fmtNum(amount)

  // First pass: unambiguous markers that always live in a single run
  for (const run of allDescendants(tc, 'r')) {
    for (const t of allDescendants(run, 't')) {
      const txt = t.textContent ?? ''
      if (/SGD\s+[\d,]+\.?\d*/.test(txt)) {
        t.textContent = txt.replace(/SGD\s+[\d,]+\.?\d*/, num)
        return
      }
      if (txt.includes('F.O.C.')) { t.textContent = txt.replace('F.O.C.', num); return }
      if (txt.includes('On Quote')) { t.textContent = txt.replace('On Quote', num); return }
    }
  }

  // Second pass: find paragraph with number, rebuild it, delete other paragraphs
  for (const para of directChildren(tc, 'p')) {
    const ts = allDescendants(para, 't')
    if (ts.length === 0) continue
    const combined = ts.map(t => t.textContent ?? '').join('')
    if (!/[\d,]+\.\d+/.test(combined)) continue
    // Found the paragraph with number — rebuild it
    const newText = combined.replace(/[\d,]+\.\d+/, num).trim()
    for (const r of directChildren(para, 'r')) r.parentNode?.removeChild(r)
    const [enPart, cnPart] = splitAtChinese(newText)
    if (enPart) para.appendChild(makeCalibriRun(enPart, '20', xmlDoc))
    if (cnPart && languageMode === 'bilingual') para.appendChild(makeCalibriRun(cnPart, '18', xmlDoc, 'Microsoft YaHei'))
    // Delete all other paragraphs
    for (const p of directChildren(tc, 'p')) {
      if (p !== para) p.parentNode?.removeChild(p)
    }
    return
  }
}

function updateCcCell(tc: Element, amount: number, xmlDoc?: any, languageMode: 'bilingual' | 'english-only' = 'bilingual'): void {
  const newText = fmtSGD(amount)

  // Find paragraph with text, preserve pPr (formatting), only replace runs
  for (const p of allDescendants(tc, 'p')) {
    const ts = allDescendants(p, 't')
    if (ts.length === 0) continue
    const combined = ts.map(t => t.textContent ?? '').join('')
    if (!combined.trim()) continue

    // Found paragraph with text - preserve pPr, replace all runs
    const pPr = directChildren(p, 'pPr')[0]

    // Remove all existing runs but keep pPr
    for (let i = p.childNodes.length - 1; i >= 0; i--) {
      const child = p.childNodes[i] as Element
      if (child.nodeType === 1 && child.localName !== 'pPr') {
        p.removeChild(child)
      }
    }

    // Create new run with formatted text (keep original formatting)
    if (xmlDoc) {
      p.appendChild(makeCalibriRun(newText, '20', xmlDoc, 'Calibri'))
    } else {
      // Fallback without xmlDoc
      const r = xmlDoc?.createElement('w:r')
      if (r) {
        const t = xmlDoc.createElement('w:t')
        t.setAttribute('xml:space', 'preserve')
        t.textContent = newText
        r.appendChild(t)
        p.appendChild(r)
      }
    }
    return
  }
}

function stripVMerge(tc: Element): void {
  const tcPr = directChildren(tc, 'tcPr')[0]
  if (!tcPr) return
  for (const vm of directChildren(tcPr, 'vMerge')) tcPr.removeChild(vm)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setVMerge(tc: Element, restart: boolean, xmlDoc: any): void {
  let tcPr = directChildren(tc, 'tcPr')[0]
  if (!tcPr) {
    tcPr = xmlDoc.createElement('w:tcPr')
    const firstPara = directChildren(tc, 'p')[0]
    if (firstPara) tc.insertBefore(tcPr, firstPara)
    else tc.appendChild(tcPr)
  }
  for (const vm of directChildren(tcPr, 'vMerge')) tcPr.removeChild(vm)
  const vMerge = xmlDoc.createElement('w:vMerge')
  if (restart) vMerge.setAttribute('w:val', 'restart')
  tcPr.appendChild(vMerge)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function clearCellContent(tc: Element, xmlDoc: any): void {
  for (const p of directChildren(tc, 'p')) p.parentNode?.removeChild(p)
  tc.appendChild(xmlDoc.createElement('w:p'))
}

// ── create a new data row with unified font standards ─────────────────────────
// Standard format: EN=Calibri 10pt, CN=Microsoft YaHei 9pt
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMainTableRow(
  numText: string,
  descEN: string, descCN: string,
  feeLines: string[],
  referenceRow: Element,
  xmlDoc: any,
): Element {
  const newRow = referenceRow.cloneNode(true) as Element
  const cells = directChildren(newRow, 'tc')
  if (cells.length < 3) return newRow
  for (const cell of cells) {
    stripVMerge(cell)
    const tcPr = directChildren(cell, 'tcPr')[0]
    if (tcPr) for (const shd of directChildren(tcPr, 'shd')) tcPr.removeChild(shd)
  }
  const trPr = directChildren(newRow, 'trPr')[0]
  if (trPr) {
    for (const shd of directChildren(trPr, 'shd')) trPr.removeChild(shd)
    for (const h of directChildren(trPr, 'trHeight')) trPr.removeChild(h)
  }

  // Cell 0: row number (Calibri 10pt) — centered
  const numCell = cells[0]
  // Completely clear row number cell (remove ALL child nodes except tcPr)
  for (let i = numCell.childNodes.length - 1; i >= 0; i--) {
    const child = numCell.childNodes[i] as Element
    if (child.nodeType === 1 && child.localName !== 'tcPr') {
      numCell.removeChild(child)
    }
  }
  const p0num = xmlDoc.createElement('w:p')
  const pPr = xmlDoc.createElement('w:pPr')
  const jc = xmlDoc.createElement('w:jc')
  jc.setAttribute('w:val', 'center')
  pPr.appendChild(jc)
  const spacing = xmlDoc.createElement('w:spacing')
  spacing.setAttribute('w:before', '0')
  spacing.setAttribute('w:after', '0')
  pPr.appendChild(spacing)
  p0num.appendChild(pPr)
  if (numText) {
    p0num.appendChild(makeCalibriRun(numText, '20', xmlDoc, 'Calibri'))
  }
  numCell.appendChild(p0num)

  // Cell 1: description (EN=Calibri 10pt, CN=Microsoft YaHei 9pt)
  const descCell = cells[1]
  // Completely clear description cell (remove ALL child nodes except tcPr)
  for (let i = descCell.childNodes.length - 1; i >= 0; i--) {
    const child = descCell.childNodes[i] as Element
    if (child.nodeType === 1 && child.localName !== 'tcPr') {
      descCell.removeChild(child)
    }
  }
  const p0 = xmlDoc.createElement('w:p')
  const p0Pr = xmlDoc.createElement('w:pPr')
  const p0Spacing = xmlDoc.createElement('w:spacing')
  p0Spacing.setAttribute('w:before', '0')
  p0Spacing.setAttribute('w:after', '0')
  p0Pr.appendChild(p0Spacing)
  p0.appendChild(p0Pr)
  p0.appendChild(makeCalibriRun(descEN, '20', xmlDoc, 'Calibri'))
  descCell.appendChild(p0)
  if (descCN) {
    const p1 = xmlDoc.createElement('w:p')
    const p1Pr = xmlDoc.createElement('w:pPr')
    const p1Spacing = xmlDoc.createElement('w:spacing')
    p1Spacing.setAttribute('w:before', '0')
    p1Spacing.setAttribute('w:after', '0')
    p1Pr.appendChild(p1Spacing)
    p1.appendChild(p1Pr)
    p1.appendChild(makeCalibriRun(descCN, '18', xmlDoc, 'Microsoft YaHei'))
    descCell.appendChild(p1)
  }

  // Cell 2: fee lines (Calibri 10pt)
  const feeCell = cells[2]
  // Ensure tcPr exists and is first
  let tcPr = directChildren(feeCell, 'tcPr')[0]
  if (!tcPr) {
    tcPr = xmlDoc.createElement('w:tcPr')
    feeCell.insertBefore(tcPr, feeCell.firstChild)
  }
  // Completely clear fee cell (remove ALL child nodes except tcPr)
  for (let i = feeCell.childNodes.length - 1; i >= 0; i--) {
    const child = feeCell.childNodes[i] as Element
    if (child.nodeType === 1 && child.localName !== 'tcPr') {
      feeCell.removeChild(child)
    }
  }
  let lastInserted: Element | null = null
  for (const line of feeLines) {
    const p = xmlDoc.createElement('w:p')
    const pPr = xmlDoc.createElement('w:pPr')
    const spacing = xmlDoc.createElement('w:spacing')
    spacing.setAttribute('w:before', '0')
    spacing.setAttribute('w:after', '0')
    pPr.appendChild(spacing)
    p.appendChild(pPr)
    p.appendChild(makeCalibriRun(line, '20', xmlDoc, 'Calibri'))
    if (lastInserted) {
      feeCell.insertBefore(p, lastInserted.nextSibling)
    } else {
      feeCell.insertBefore(p, tcPr.nextSibling)
    }
    lastInserted = p
  }

  return newRow
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setFeeCellFoc(tc: Element, xmlDoc: any): void {
  const existingParas = directChildren(tc, 'p')
  const pPrClone = existingParas.length > 0
    ? (directChildren(existingParas[0], 'pPr')[0]?.cloneNode(true) ?? null)
    : null
  // Ensure tcPr exists and is first
  let tcPr = directChildren(tc, 'tcPr')[0]
  if (!tcPr) {
    tcPr = xmlDoc.createElement('w:tcPr')
    tc.insertBefore(tcPr, tc.firstChild)
  }
  for (const p of existingParas) p.parentNode?.removeChild(p)

  // English lines: Calibri 10pt (sz=20); Chinese lines: YaHei 9pt (sz=18) — match content column
  const lines: [string, string, string][] = [
    ['F.O.C.',              '20', 'Calibri'],
    ['Included in package', '20', 'Calibri'],
    ['不另收费',             '18', 'Microsoft YaHei'],
    ['(含在报价配套内)',      '18', 'Microsoft YaHei'],
  ]
  let lastInserted: Element | null = null
  for (const [line, szVal, font] of lines) {
    const newPara = xmlDoc.createElement('w:p')
    if (pPrClone) newPara.appendChild((pPrClone as Node).cloneNode(true))
    newPara.appendChild(makeCalibriRun(line, szVal, xmlDoc, font))
    if (lastInserted) {
      tc.insertBefore(newPara, lastInserted.nextSibling)
    } else {
      tc.insertBefore(newPara, tcPr.nextSibling)
    }
    lastInserted = newPara
  }
}

// ── fill header ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fillHeader(body: Element, input: DocInput, xmlDoc: any): void {
  const paras = directChildren(body, 'p')
  if (paras.length === 0) return

  const isEnglishOnly = input.languageMode === 'english-only'

  // Para 0: update date text
  const datePara = paras[0]
  const runs0 = allDescendants(datePara, 'r')
  if (runs0.length > 0) {
    const ts = allDescendants(runs0[0], 't')
    if (ts.length > 0) ts[0].textContent = `Date:  ${input.date}`
  }

  // Para 1: update company name (handle both bilingual and English templates)
  let companyNameUpdated = false
  if (paras.length > 1) {
    const companyPara = paras[1]
    const companyRuns = allDescendants(companyPara, 'r')
    if (companyRuns.length > 0) {
      const ts = allDescendants(companyRuns[0], 't')
      if (ts.length > 0) {
        if (isEnglishOnly) {
          ts[0].textContent = `Company Name:  ${input.companyName}`
        } else {
          ts[0].textContent = `Company Name  企业名字:  ${input.companyName}`
        }
        companyNameUpdated = true
      }
    }
  }

  // If company name not found in Para[1], create/insert it (handles CNEN template)
  if (!companyNameUpdated) {
    const companyPara = datePara.cloneNode(true) as Element
    // Clear existing runs
    for (const r of allDescendants(companyPara, 'r')) {
      r.parentNode?.removeChild(r)
    }
    const newRun = xmlDoc.createElement('w:r')
    const newT = xmlDoc.createElement('w:t')
    newT.setAttribute('xml:space', 'preserve')
    if (isEnglishOnly) {
      newT.textContent = `Company Name:  ${input.companyName}`
    } else {
      newT.textContent = `Company Name  企业名字:  ${input.companyName}`
    }
    newRun.appendChild(newT)
    companyPara.appendChild(newRun)
    // Insert after date paragraph
    body.insertBefore(companyPara, datePara.nextSibling)
  }

  // Find "Dear Management" paragraph and update salutation
  for (const p of directChildren(body, 'p')) {
    const runs = allDescendants(p, 'r')
    if (runs.length === 0) continue
    const ts = allDescendants(runs[0], 't')
    if (ts.length === 0) continue
    if ((ts[0].textContent ?? '').includes('Dear Management')) {
      ts[0].textContent = input.salutationEn
      // Only update Chinese salutation if bilingual mode
      if (!isEnglishOnly && runs.length > 1) {
        const ts2 = allDescendants(runs[1], 't')
        if (ts2.length > 0) ts2[0].textContent = input.salutationCn
      }
      break
    }
  }
}

// ── update Table 1 total cell ─────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function updateMainTableTotalCell(tc: Element, amount: number, xmlDoc: any, languageMode: 'bilingual' | 'english-only' = 'bilingual'): void {
  const num = fmtNum(amount)
  for (const para of directChildren(tc, 'p')) {
    const ts = allDescendants(para, 't')
    if (ts.length === 0) continue
    const combined = ts.map(t => t.textContent ?? '').join('')
    if (!/[\d,]+\.\d+/.test(combined)) continue
    // Replace all fragmented character runs with a single bold Calibri run
    for (const r of directChildren(para, 'r')) r.parentNode?.removeChild(r)
    para.appendChild(makeCalibriRun(num, '20', xmlDoc, 'Calibri', true))
    // Force left indent to 141 twips (0.25 cm) — same as fee cells above
    let pPr = directChildren(para, 'pPr')[0]
    if (!pPr) {
      pPr = xmlDoc.createElement('w:pPr')
      para.insertBefore(pPr, para.firstChild)
    }
    const existingInd = directChildren(pPr, 'ind')[0]
    if (existingInd) {
      existingInd.setAttribute('w:left', '141')
    } else {
      const ind = xmlDoc.createElement('w:ind')
      ind.setAttribute('w:left', '141')
      pPr.appendChild(ind)
    }
    return
  }
  updateFeeCell(tc, amount, xmlDoc, languageMode)
}

// ── override cell text (keeps cell/para properties, replaces runs) ────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function overrideFirstParaText(tc: Element, text: string, xmlDoc: any): void {
  const paras = directChildren(tc, 'p')
  let para = paras[0]
  if (!para) { para = xmlDoc.createElement('w:p'); tc.appendChild(para) }
  for (const r of directChildren(para, 'r')) r.parentNode?.removeChild(r)
  for (let i = 1; i < paras.length; i++) paras[i].parentNode?.removeChild(paras[i])
  const run = xmlDoc.createElement('w:r')
  const t = xmlDoc.createElement('w:t')
  t.setAttribute('xml:space', 'preserve')
  t.textContent = text
  run.appendChild(t)
  para.appendChild(run)
}

// ── insert extra opt rows (XBRL / AUDIT / AIS) ────────────────────────────────

function insertExtraOptRows(
  tbl: Element, sel: Set<string>, feeOv: Record<string, number>,
  focServicesSet: Set<string>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  xmlDoc: any,
  dataRef?: Element,  // pre-removal data row for cloning (avoids using header as template)
  languageMode: 'bilingual' | 'english-only' = 'bilingual',
): void {
  const EXTRAS = [
    { key: 'XBRL',  en: 'XBRL Reporting Service', cn: '转换和准备XBRL报告' },
    { key: 'AUDIT', en: 'Auditing Services',        cn: '公司审计' },
    { key: 'AIS',   en: 'AIS/IR8A Services',        cn: '员工年收入申报' },
  ]
  const toInsert = EXTRAS.filter(e => sel.has(e.key))
  if (toInsert.length === 0) return

  const rows = directChildren(tbl, 'tr')
  if (rows.length < 2) return
  const totalRow = rows[rows.length - 1]
  // Use provided pre-removal data row; fallback to second-to-last (may be header if all removed)
  const templateRow = dataRef ?? rows[rows.length - 2]

  for (const extra of toInsert) {
    const newRow = templateRow.cloneNode(true) as Element
    const rowId = extra.key === 'AIS' && languageMode === 'english-only'
      ? 'OPT_AIS_EN'
      : `OPT_${extra.key}`
    setMarkedRowId(newRow, rowId, xmlDoc)
    const cells = directChildren(newRow, 'tc')
    if (cells.length < 2) continue

    // Mark number cell with a digit so renumberTableRows picks it up
    // Also ensure center alignment
    for (const p of directChildren(cells[0], 'p')) {
      let pPr = directChildren(p, 'pPr')[0]
      if (!pPr) {
        pPr = xmlDoc.createElement('w:pPr')
        p.insertBefore(pPr, p.firstChild)
      }
      let jc = directChildren(pPr, 'w:jc')[0]
      if (!jc) {
        jc = xmlDoc.createElement('w:jc')
        jc.setAttribute('w:val', 'center')
        pPr.appendChild(jc)
      }
      for (const t of directChildren(p, 't')) {
        if (/^\d+$/.test((t.textContent ?? '').trim())) { t.textContent = '99'; break }
      }
    }

    // --- Service name cell (cells[1]) ---
    // Standard format: EN=Calibri 10pt, CN=Microsoft YaHei 9pt
    const svcParas = directChildren(cells[1], 'p')
    for (let i = svcParas.length - 1; i >= 2; i--) {
      svcParas[i].parentNode?.removeChild(svcParas[i])
    }

    // Para[0]: English name (Calibri 10pt)
    if (svcParas.length >= 1) {
      for (const r of directChildren(svcParas[0], 'r')) r.parentNode?.removeChild(r)
      svcParas[0].appendChild(makeCalibriRun(extra.en, '20', xmlDoc, 'Calibri'))
    }

    // Para[1]: Chinese name (Microsoft YaHei 9pt)
    if (svcParas.length >= 2) {
      for (const r of directChildren(svcParas[1], 'r')) r.parentNode?.removeChild(r)
      svcParas[1].appendChild(makeCalibriRun(extra.cn, '18', xmlDoc, 'Microsoft YaHei'))
    }

    // --- Fee cell (cells[cells.length - 1]) ---
    const feeCell = cells[cells.length - 1]
    const svc = SERVICES.find(s => s.key === extra.key)
    const hasFeeOverride = feeOv[extra.key] !== undefined
    // bundled/foc services (e.g. AIS) are excluded from focServicesSet by the frontend,
    // so check fee_type directly to detect the "no SGD override → show F.O.C." case.
    const isFocDisplay = focServicesSet.has(extra.key) ||
      (!hasFeeOverride && (svc?.fee_type === 'bundled' || svc?.fee_type === 'foc'))

    if (isFocDisplay) {
      setFeeCellFoc(feeCell, xmlDoc)
    } else {
      // Replace fee paragraphs with unified font (Calibri 10pt for EN/numbers)
      const existingFeeParas = directChildren(feeCell, 'p')
      for (const p of existingFeeParas) p.parentNode?.removeChild(p)
      const newFeePara = xmlDoc.createElement('w:p')
      // pPr with matching font size — without this the paragraph's own
      // formatting is unset, which reads fine in Word (falls back to the
      // run's own rPr) but diverges structurally from every other fee row
      // (same class of inconsistency as the ND_DEPOSIT2 force-rebuild fix).
      const feePPr = xmlDoc.createElement('w:pPr')
      const feePRPr = xmlDoc.createElement('w:rPr')
      const feeSz = xmlDoc.createElement('w:sz'); feeSz.setAttribute('w:val', '20')
      const feeSzCs = xmlDoc.createElement('w:szCs'); feeSzCs.setAttribute('w:val', '20')
      feePRPr.appendChild(feeSz); feePRPr.appendChild(feeSzCs)
      feePPr.appendChild(feePRPr)
      newFeePara.appendChild(feePPr)
      if (hasFeeOverride) {
        newFeePara.appendChild(makeCalibriRun(fmtNum(feeOv[extra.key]), '20', xmlDoc, 'Calibri'))
      } else {
        newFeePara.appendChild(makeCalibriRun('On Quote / ', '20', xmlDoc, 'Calibri'))
        newFeePara.appendChild(makeCalibriRun('按实报价', '18', xmlDoc, 'Microsoft YaHei'))
      }
      feeCell.appendChild(newFeePara)
    }

    tbl.insertBefore(newRow, totalRow)
  }
}

// ── remove service sections ───────────────────────────────────────────────────

// Match strings for each service's heading paragraph in the template.
// The new template uses Word paragraph styles (Heading1, NormalWeb, ListParagraph) — no "1." prefixes.
const SECTION_HEADING: Record<string, string> = {
  INCORP:      'Company Incorporation Services',
  SECRETARIAL: 'Corporate Secretarial Services',
  BANK:        'Company Bank Account Opening',
  ADDRESS:     'Company Registered and Mailing Address',
  ND:          'Nominee Director Service',
  EP:          'Employment Pass application',
  DP:          'Dependant’s Pass (“DP”) Application Service',
  AR:          'Annual Return Service',
  XBRL:        'XBRL Reporting Service',
  ACCOUNTS:    'Management Accounts Preparation',
  UNAUDITEDFS: 'Unaudited Financial Statement',
  AUDIT:       'Auditing services',
  COMPANYTAX:  'Annual Corporate Taxation',
  CORPPASS:    'CorpPass Registration Service',
  AIS:         'AIS/IR8A Services',
  PAYROLL:     'Payroll Service',
  PERSONALTAX: 'Personal Tax',
  PASSRENEWAL: 'Work Pass Renewal Service',
  LOC:         'Letter of Consent',
}

// One narrative section can be sold through more than one fee-table service.
// Keep the section whenever any equivalent service is selected. Without this
// explicit relationship, annual ND, first-year DP and first-year LOC could
// appear in the fee table while their explanatory section was deleted.
const SECTION_SELECTION_KEYS: Record<string, string[]> = {
  SECRETARIAL: ['SECRETARIAL', 'SECRETARIAL2'],
  ADDRESS: ['ADDRESS', 'ADDRESS2'],
  ND: ['ND', 'ND2'],
  DP: ['DP', 'DP_MAIN', 'DP_RENEW'],
  LOC: ['LOC', 'LOC_MAIN'],
}

function sectionIsSelected(sectionKey: string, selected: Set<string>): boolean {
  return (SECTION_SELECTION_KEYS[sectionKey] ?? [sectionKey]).some((key) => selected.has(key))
}

function findServiceSectionHeadings(paras: Element[]): { feeStartIdx: number; headings: [string, number][] } {
  let feeStartIdx = paras.length
  for (let i = 0; i < paras.length; i++) {
    const text = paraText(paras[i])
    if (text.includes('Company Incorporation and First-Year Service Fees') || text.includes('Related Service Fees')) {
      feeStartIdx = i
      break
    }
    const hasPageBreak = allDescendants(paras[i], 'br').some(
      (br) => (br as Element).getAttribute('w:type') === 'page',
    )
    if (hasPageBreak) {
      feeStartIdx = i
      break
    }
  }

  const headings: [string, number][] = []
  for (let i = 0; i < feeStartIdx; i++) {
    const text = paraText(paras[i])
    const pPr = directChildren(paras[i], 'pPr')[0]
    const pStyle = pPr ? directChildren(pPr, 'pStyle')[0] : undefined
    const style = pStyle?.getAttribute('w:val') || pStyle?.getAttribute('val') || ''
    // Several body paragraphs repeat the heading phrase verbatim (notably
    // Payroll, Work Pass Renewal and LOC). They are content, not section
    // boundaries, and must not split or duplicate the detected section.
    if (style === 'BodyText') continue
    for (const [svcKey, phrase] of Object.entries(SECTION_HEADING)) {
      if (text.includes(phrase)) {
        headings.push([svcKey, i])
        break
      }
    }
  }
  return { feeStartIdx, headings }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ensureParagraphFlag(p: Element, flagName: 'keepNext' | 'keepLines', xmlDoc: any): void {
  let pPr = directChildren(p, 'pPr')[0]
  if (!pPr) {
    pPr = xmlDoc.createElement('w:pPr')
    p.insertBefore(pPr, p.firstChild)
  }
  if (directChildren(pPr, flagName).length === 0) {
    pPr.appendChild(xmlDoc.createElement(`w:${flagName}`))
  }
}

function removeServiceSections(body: Element, selected: Set<string>, xmlDoc: any): void {
  const paras = directChildren(body, 'p')
  const { feeStartIdx, headings } = findServiceSectionHeadings(paras)

  const toDelete: Element[] = []
  for (let hi = 0; hi < headings.length; hi++) {
    const [svcKey, startI] = headings[hi]
    const keep = sectionIsSelected(svcKey, selected)
    if (!keep) {
      const endI = hi + 1 < headings.length ? headings[hi + 1][1] : feeStartIdx
      for (let j = startI; j < endI; j++) toDelete.push(paras[j])
    } else {
      // A heading must never be orphaned alone at the bottom of a page with
      // its content starting fresh on the next page. But gluing together the
      // ENTIRE section (heading + every bullet, however long) over-corrects:
      // if that whole block doesn't fit in the remaining space on a page,
      // Word pushes it ALL to the next page, leaving a large blank gap
      // behind on the page before it — this is the "why is there so much
      // empty space" symptom, not leftover/undeleted content.
      // Only glue the heading to a small, fixed number of paragraphs right
      // after it (enough to also cover the section's first bilingual EN/CN
      // bullet pair, since the heading itself is a single combined EN+CN
      // paragraph in this template). This bounds the worst-case forced
      // block to a few lines regardless of how long the section is — the
      // rest of the section flows across a page break normally, same as
      // any other multi-paragraph content in the document.
      const endI = hi + 1 < headings.length ? headings[hi + 1][1] : feeStartIdx
      const HEADING_KEEP_WINDOW = 2
      const keepNextUntil = Math.min(startI + HEADING_KEEP_WINDOW, endI - 1)
      for (let j = startI; j < endI; j++) {
        ensureParagraphFlag(paras[j], 'keepLines', xmlDoc)
        if (j < keepNextUntil) ensureParagraphFlag(paras[j], 'keepNext', xmlDoc)
      }
    }
  }
  for (const elem of toDelete) elem.parentNode?.removeChild(elem)
}

function assertGeneratedProposalContract(body: Element, input: DocInput, plan: ProposalPlan): void {
  const failures: string[] = []
  const companyName = input.companyName.trim()
  // Spacer and drawing-anchor paragraphs make fixed indices unreliable.
  // Require the label and supplied value in the same body paragraph.
  const bodyParagraphTexts = directChildren(body, 'p').map((paragraph) => {
    // xmldom reports nodes created during this generation pass as `w:t`
    // until serialization/reparse, while template nodes report `t`.
    const textNodes = [...allDescendants(paragraph, 't'), ...allDescendants(paragraph, 'w:t')]
    return textNodes.map((node) => node.textContent ?? '').join('')
  })
  const companyLine = bodyParagraphTexts.find((text) => text.includes('Company Name'))
  if (!companyLine) {
    failures.push('company name line is missing from the document header')
  } else if (companyName && !companyLine.includes(companyName)) {
    failures.push('company name is missing from the document header')
  } else if (!companyName) {
    const colonIndex = companyLine.indexOf(':')
    if (colonIndex === -1 || /\S/.test(companyLine.slice(colonIndex + 1))) {
      failures.push('company name should remain blank in the document header')
    }
  }
  if (!bodyParagraphTexts.some((text) => /Date:\s*\S/.test(text))) {
    failures.push('proposal date is missing from the document header')
  }

  const actualRowCounts = new Map<string, number>()
  for (const table of directChildren(body, 'tbl')) {
    for (const row of directChildren(table, 'tr')) {
      const rowId = findMarkedRowId(row)
      if (rowId) actualRowCounts.set(rowId, (actualRowCounts.get(rowId) ?? 0) + 1)

      // Every marked row's text should have balanced parentheses. Content
      // built as separate English/Chinese runs (any dynamically-created
      // row) can end up with a parenthesis living only in one language's
      // run -- fine if both languages render, but if that run is dropped
      // for the active languageMode, the other side is left with an
      // unmatched "(" or ")". Concretely caught the DP_RENEW fee cell
      // rendering "(Government fee included" with no close in
      // english-only mode; this check runs on every real generation, not
      // just the offline verify-docgen suite, so a similar bug in any
      // other row fails closed here instead of silently publishing.
      if (rowId) {
        const rowText = cellText(row)
        const opens = (rowText.match(/\(/g) ?? []).length
        const closes = (rowText.match(/\)/g) ?? []).length
        if (opens !== closes) {
          failures.push(`${rowId}: unbalanced parentheses in rendered text (${opens} "(" vs ${closes} ")")`)
        }
      }
    }
  }

  const expectedRowIds = new Set(plan.impacts.flatMap((impact) => impact.rowIds))
  for (const [rowId, count] of actualRowCounts) {
    // Company-change rows belong to the always-present appendix and use a
    // separate pricing contract, not the selected-service proposal plan.
    if (rowId.startsWith('CC_R')) continue
    if (!expectedRowIds.has(rowId)) failures.push(`unexpected marked row ${rowId}`)
    if (count !== 1) failures.push(`${rowId} appears ${count} times`)
  }
  for (const impact of plan.impacts) {
    for (const rowId of impact.rowIds) {
      const actual = actualRowCounts.get(rowId) ?? 0
      const expected = impact.selected ? 1 : 0
      if (actual !== expected) {
        failures.push(`${impact.serviceKey}/${rowId}: expected ${expected} row, found ${actual}`)
      }
    }
  }

  const selected = new Set(plan.selected)
  const { headings } = findServiceSectionHeadings(directChildren(body, 'p'))
  const headingCounts = new Map<string, number>()
  for (const [sectionKey] of headings) {
    headingCounts.set(sectionKey, (headingCounts.get(sectionKey) ?? 0) + 1)
  }
  for (const sectionKey of Object.keys(SECTION_HEADING)) {
    const expected = input.mode === 'full' || sectionIsSelected(sectionKey, selected) ? 1 : 0
    const actual = headingCounts.get(sectionKey) ?? 0
    if (actual !== expected) failures.push(`service section ${sectionKey}: expected ${expected}, found ${actual}`)
  }

  if (failures.length) {
    throw new Error(`Generated proposal failed final contract: ${failures.join('; ')}`)
  }
}

// Keep the complete Payment Terms block together when it fits on one page.
// This avoids a single final clause being stranded on a page by itself.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function keepPaymentTermsTogether(body: Element, xmlDoc: any): void {
  const paras = directChildren(body, 'p')
  const start = paras.findIndex((p) => paraText(p).includes('Payment Terms'))
  if (start < 0) return

  let end = paras.findIndex((p, index) => index > start && paraText(p).trim() === 'General')
  if (end < 0) end = paras.length

  // Blank spacer paragraphs are part of the chain too; leaving one without
  // keepNext would silently break the group and strand the final clause.
  const block = paras.slice(start, end)
  block.forEach((p, index) => {
    ensureParagraphFlag(p, 'keepLines', xmlDoc)
    if (index < block.length - 1) ensureParagraphFlag(p, 'keepNext', xmlDoc)
  })
}

function removeStalePaginationCache(xmlDoc: Document): void {
  const staleBreaks = allDescendants(xmlDoc.documentElement as Element, 'lastRenderedPageBreak')
  for (const marker of staleBreaks) marker.parentNode?.removeChild(marker)
}

async function ensureRepeatedPageBranding(zip: JSZip): Promise<void> {
  const documentEntry = zip.file('word/document.xml')
  const relationshipsEntry = zip.file('word/_rels/document.xml.rels')
  const settingsEntry = zip.file('word/settings.xml')
  const contentTypesEntry = zip.file('[Content_Types].xml')
  const primaryHeader = zip.file('word/header1.xml')
  const primaryFooter = zip.file('word/footer1.xml')
  if (!documentEntry || !relationshipsEntry || !settingsEntry || !contentTypesEntry || !primaryHeader || !primaryFooter) {
    throw new Error('Template contract failed: primary header/footer package parts are missing')
  }

  let documentXml = await documentEntry.async('string')
  let relationshipsXml = await relationshipsEntry.async('string')
  let settingsXml = await settingsEntry.async('string')
  let contentTypesXml = await contentTypesEntry.async('string')

  // The source templates only define the primary header/footer. Word can
  // suppress those floating brand elements on some dynamically reflowed
  // pages. Giving odd and even pages their own identical parts makes the
  // rendered result deterministic after service blocks are added/removed.
  if (!/w:headerReference\b[^>]*w:type="even"/.test(documentXml)) {
    const headerRelId = 'rIdTassureEvenHeader'
    const footerRelId = 'rIdTassureEvenFooter'
    zip.file('word/header2.xml', await primaryHeader.async('nodebuffer'))
    zip.file('word/footer2.xml', await primaryFooter.async('nodebuffer'))

    const primaryHeaderRels = zip.file('word/_rels/header1.xml.rels')
    if (primaryHeaderRels) {
      zip.file('word/_rels/header2.xml.rels', await primaryHeaderRels.async('nodebuffer'))
    }
    const primaryFooterRels = zip.file('word/_rels/footer1.xml.rels')
    if (primaryFooterRels) {
      zip.file('word/_rels/footer2.xml.rels', await primaryFooterRels.async('nodebuffer'))
    }

    relationshipsXml = relationshipsXml.replace(
      '</Relationships>',
      `<Relationship Id="${headerRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml"/>` +
      `<Relationship Id="${footerRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer2.xml"/>` +
      '</Relationships>',
    )
    documentXml = documentXml.replace(
      /(<w:sectPr\b[^>]*>)/,
      `$1<w:headerReference w:type="even" r:id="${headerRelId}"/>` +
      `<w:footerReference w:type="even" r:id="${footerRelId}"/>`,
    )
    contentTypesXml = contentTypesXml.replace(
      '</Types>',
      '<Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
      '<Override PartName="/word/footer2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
      '</Types>',
    )
  }

  if (!/<w:evenAndOddHeaders\b/.test(settingsXml)) {
    settingsXml = settingsXml.replace('</w:settings>', '<w:evenAndOddHeaders/></w:settings>')
  }

  zip.file('word/document.xml', documentXml)
  zip.file('word/_rels/document.xml.rels', relationshipsXml)
  zip.file('word/settings.xml', settingsXml)
  zip.file('[Content_Types].xml', contentTypesXml)
}

// ── renumber table rows ───────────────────────────────────────────────────────
// Handles both template elements (localName='t', parsed from XML) and
// dynamically created elements (localName='w:t', from createElement).

function renumberTableRows(tbl: Element): void {
  let counter = 1
  for (const row of directChildren(tbl, 'tr')) {
    const cells = directChildren(row, 'tc')
    if (cells.length === 0) continue
    const numCell = cells[0]
    // Collect <w:t> from both template rows (localName='t') and dynamic rows (localName='w:t')
    const allT: Element[] = [
      ...allDescendants(numCell, 't'),
      ...allDescendants(numCell, 'w:t'),
    ]
    const combined = allT.map(t => t.textContent ?? '').join('')

    // If cell is empty or has a digit, this is a numberable row
    const hasExistingDigit = /^\d+$/.test(combined.trim())
    const isEmpty = combined.trim() === ''

    if (!hasExistingDigit && !isEmpty) continue

    // Update or create text node with new number
    if (hasExistingDigit) {
      // Clear all text runs first, then set the new number in the first one
      for (const t of allT) {
        t.textContent = ''
      }
      if (allT.length > 0) {
        allT[0].textContent = String(counter++)
      }
    } else if (isEmpty && allT.length > 0) {
      // Fill in empty cell with new number (clear other runs first)
      for (const t of allT) {
        t.textContent = ''
      }
      allT[0].textContent = String(counter++)
    }
  }
}

// ── process main table ────────────────────────────────────────────────────────

function processMainTable(
  body: Element, tbl: Element,
  sel: Set<string>, feeOv: Record<string, number>,
  mapping: Record<string, string[]>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  xmlDoc: any,
  focServicesSet: Set<string>,
  languageMode: 'bilingual' | 'english-only' = 'bilingual',
): void {
  // Find heading immediately before tbl — needed when removing the table.
  const bodyKids = Array.from({ length: body.childNodes.length }, (_, i) => body.childNodes[i])
    .filter((n): n is Element => (n as Element).nodeType === 1) as Element[]
  const tblIdx = bodyKids.indexOf(tbl)
  let headingBeforeTbl: Element | null = null
  for (let i = tblIdx - 1; i >= 0; i--) {
    if (bodyKids[i].localName === 'p') { headingBeforeTbl = bodyKids[i]; break }
  }

  // Remove table + heading only when no real main-table service is selected.
  const anyMainSelected = SERVICES.some(s => s.table === 'main' && s.fee_type !== 'discount' && sel.has(s.key))
  if (!anyMainSelected) {
    tbl.parentNode?.removeChild(tbl)
    headingBeforeTbl?.parentNode?.removeChild(headingBeforeTbl)
    return
  }

  // The template already contains a built-in <w:br type="page"/> paragraph immediately
  // before the "Company Incorporation..." heading, so no additional page break is needed here.

  // IMPORTANT: Capture existing row numbers BEFORE any modifications (BEFORE removal)
  const preserveRowNums = languageMode === 'english-only'
  const existingRowNums: Map<Element, string> = new Map()
  const existingFeeValues: Map<Element, string> = new Map()

  if (preserveRowNums) {
    for (const row of directChildren(tbl, 'tr')) {
      const cells = directChildren(row, 'tc')
      if (cells.length >= 3) {
        const numCell = cells[0]
        const feeCell = cells[2]
        const numText = cellText(numCell).trim()
        const feeText = cellText(feeCell).trim()
        if (numText && /^\d+$/.test(numText)) {
          existingRowNums.set(row, numText)
        }
        if (feeText && feeText !== 'Fee (SGD)' && feeText !== 'Fee(SGD)') {
          existingFeeValues.set(row, feeText)
        }
      }
    }
  }

  // Calculate total dynamically from SERVICES array.
  let newTotal = 0
  for (const svc of SERVICES) {
    if (svc.table !== 'main' || !sel.has(svc.key)) continue
    if (['foc', 'bundled', 'discount'].includes(svc.fee_type)) continue
    if (focServicesSet.has(svc.key)) continue
    newTotal += feeOv[svc.key] ?? svc.fee ?? 0
  }
  // FOC/bundled services with SGD override
  for (const svc of SERVICES) {
    if (svc.table === 'main' && ['foc', 'bundled'].includes(svc.fee_type) && sel.has(svc.key)) {
      const extra = feeOv[svc.key]
      if (extra && !focServicesSet.has(svc.key)) newTotal += extra
    }
  }
  // ND deposit sub-row
  if (sel.has('ND') && !focServicesSet.has('ND')) newTotal += feeOv['ND_DEPOSIT'] ?? 3000
  // Goodwill discount — subtract from total
  const goodwillDiscount = sel.has('GOODWILL_DISC') ? (feeOv['GOODWILL_DISC'] ?? 0) : 0
  if (goodwillDiscount > 0) newTotal = Math.max(0, newTotal - goodwillDiscount)

  // Capture a valid data row BEFORE removal (digit in first cell = real data row)
  let dataRefRow: Element | null = null
  for (const row of directChildren(tbl, 'tr')) {
    const cells = directChildren(row, 'tc')
    if (cells.length < 3) continue
    if (/^\d+$/.test(cellText(cells[0]).trim())) { dataRefRow = row; break }
  }

  // Filter rows based on user selection (applies to both bilingual and english-only modes)
  // CERT/DP_MAIN/LOC_MAIN/GOODWILL_DISC are always re-created dynamically below (with their own
  // numbering/formatting), so their template rows must always be dropped here — otherwise the
  // template row (kept by rowLinked when selected) and the dynamic row both render, duplicating the line.
  const DYNAMIC_ROW_RIDS = new Set(['MAIN_CERT', 'MAIN_DP_MAIN', 'MAIN_LOC_MAIN', 'MAIN_GOODWILL'])
  const rowsToRemove: Element[] = []
  for (const row of directChildren(tbl, 'tr')) {
    const cells = directChildren(row, 'tc')
    if (cells.length === 0) continue
    const rid = findRowId(cells, 'main', languageMode)
    if (rid && DYNAMIC_ROW_RIDS.has(rid)) { rowsToRemove.push(row); continue }
    if (!rowLinked(cells, 'main', sel, mapping, languageMode)) rowsToRemove.push(row)
  }
  for (const r of rowsToRemove) r.parentNode?.removeChild(r)

  const FOC_MERGE_RIDS = new Set(['MAIN_POST_EP', 'MAIN_CORPPASS', 'MAIN_PDPA', 'MAIN_CORP_CONSULT'])
  const FOC_RID_TO_KEY: Record<string, string> = {
    MAIN_POST_EP: 'POST_EP', MAIN_CORPPASS: 'CORPPASS',
    MAIN_PDPA: 'PDPA', MAIN_CORP_CONSULT: 'CORP_CONSULT',
  }

  // Step 1 — set fee content for every surviving row

  for (const row of directChildren(tbl, 'tr')) {
    const cells = directChildren(row, 'tc')
    if (cells.length === 0) continue

    // Clean up description cells for XBRL, Auditing, AIS (rebuild with single paragraph like DP renewal service)
    if (cells.length > 1) {
      const descCell = cells[1]
      const descText = cellText(descCell)
      const isXbrl = descText.includes('XBRL')
      const isAuditing = descText.includes('Auditing')
      const isAis = descText.includes('AIS/IR8A')

      if (isXbrl || isAuditing || isAis) {
        let descTcPr = directChildren(descCell, 'tcPr')[0]
        // Delete ALL child nodes except tcPr
        for (let i = descCell.childNodes.length - 1; i >= 0; i--) {
          const child = descCell.childNodes[i] as Element
          if (child.nodeType === 1 && child.localName !== 'tcPr') {
            descCell.removeChild(child)
          }
        }
        // Recreate single paragraph with just the service name
        const p = xmlDoc.createElement('w:p')
        const pPr = xmlDoc.createElement('w:pPr')
        const spacing = xmlDoc.createElement('w:spacing')
        spacing.setAttribute('w:before', '0')
        spacing.setAttribute('w:after', '0')
        pPr.appendChild(spacing)
        p.appendChild(pPr)
        p.appendChild(makeCalibriRun(descText.trim(), '20', xmlDoc))
        if (descTcPr) {
          descCell.insertBefore(p, descTcPr.nextSibling)
        } else {
          descCell.appendChild(p)
        }
      }
    }

    const rid = findRowId(cells, 'main', languageMode)
    if (rid === 'MAIN_ND_DEPOSIT') {
      const depositAmt = feeOv['ND_DEPOSIT']
      if (depositAmt !== undefined) updateFeeCell(cells[cells.length - 1], depositAmt, xmlDoc, languageMode)
    } else if (rid && FOC_MERGE_RIDS.has(rid)) {
      const feeCell = cells[cells.length - 1]
      stripVMerge(feeCell)
      const svcKey = FOC_RID_TO_KEY[rid]
      if (svcKey && !focServicesSet.has(svcKey) && feeOv[svcKey] !== undefined) {
        // Clear cell completely, write just the SGD amount (no F.O.C. block lines)
        const existingParas = directChildren(feeCell, 'p')
        const pPrClone = existingParas[0]
          ? (directChildren(existingParas[0], 'pPr')[0]?.cloneNode(true) ?? null)
          : null
        for (const p of existingParas) p.parentNode?.removeChild(p)
        const newPara = xmlDoc.createElement('w:p')
        if (pPrClone) newPara.appendChild((pPrClone as Node).cloneNode(true))
        newPara.appendChild(makeCalibriRun(fmtNum(feeOv[svcKey]), '20', xmlDoc))
        feeCell.appendChild(newPara)
      } else {
        setFeeCellFoc(feeCell, xmlDoc)
      }
    } else if (rid) {
      const { rowIdToSvc } = getDefinitionSet(languageMode)
      const svcKey = rowIdToSvc[rid]
      if (svcKey) {
        if (focServicesSet.has(svcKey)) {
          setFeeCellFoc(cells[cells.length - 1], xmlDoc)
        } else if (feeOv[svcKey] !== undefined) {
          updateFeeCell(cells[cells.length - 1], feeOv[svcKey], xmlDoc, languageMode)
        }
      }
    }
  }

  // ── Insert dynamic rows (CERT, DP_MAIN, LOC_MAIN, GOODWILL_DISC) before Total row ──
  {
    const allRowsNow = directChildren(tbl, 'tr')
    const totalRowEl = allRowsNow[allRowsNow.length - 1]
    const refRow = dataRefRow ?? (allRowsNow.length >= 2 ? allRowsNow[allRowsNow.length - 2] : allRowsNow[0])

    // Count how many template rows will be numbered 1..N by renumberTableRows.
    // Dynamic rows created with createElement have localName='w:t' (not 't'), so
    // renumberTableRows cannot find their text nodes — we must pre-assign numbers here.
    let templateDigitCount = 0
    for (const row of allRowsNow) {
      const c = directChildren(row, 'tc')
      if (c.length > 0 && /^\d+$/.test(cellText(c[0]).trim())) templateDigitCount++
    }

    type DynRow = { svcKey: string; numPlaceholder: string; descEN: string; descCN: string; feeLines: string[] }
    const dynRows: DynRow[] = [
      {
        svcKey: 'CERT',
        numPlaceholder: '1',
        descEN: 'Purchase of Certificate of Incorporation',
        descCN: '购买公司注册证书',
        feeLines: [fmtNum(feeOv['CERT'] ?? 100)],
      },
      {
        svcKey: 'DP_MAIN',
        numPlaceholder: '1',
        descEN: 'DP Application',
        descCN: '家属准证申请',
        feeLines: [fmtNum(feeOv['DP_MAIN'] ?? 600) + '/person 每位'],
      },
      {
        svcKey: 'LOC_MAIN',
        numPlaceholder: '1',
        descEN: 'Letter of Consent (LOC) Application',
        descCN: '工作许可同意书（LOC）申请',
        feeLines: [fmtNum(feeOv['LOC_MAIN'] ?? 200) + '/person 每位'],
      },
    ]
    if (sel.has('GOODWILL_DISC')) {
      dynRows.push({
        svcKey: 'GOODWILL_DISC',
        numPlaceholder: '',   // empty → renumber skips it
        descEN: 'Goodwill Discount',
        descCN: '折扣-整体配套',
        feeLines: [goodwillDiscount > 0 ? '-' + fmtNum(goodwillDiscount) : fmtNum(0)],
      })
    }

    let dynSeq = templateDigitCount + 1
    for (const { svcKey, numPlaceholder, descEN, descCN, feeLines } of dynRows) {
      if (!sel.has(svcKey)) continue
      const rowNum = numPlaceholder ? String(dynSeq++) : ''

      if (['CERT', 'DP_MAIN', 'LOC_MAIN', 'GOODWILL_DISC'].includes(svcKey)) {
        // For special services, create row with empty description and fee, then format separately
        const newRow = createMainTableRow(rowNum, '', '', [''], refRow, xmlDoc)
        const dynamicRowIds: Record<string, string> = {
          CERT: 'MAIN_CERT',
          DP_MAIN: 'MAIN_DP_MAIN',
          LOC_MAIN: 'MAIN_LOC_MAIN',
          GOODWILL_DISC: 'MAIN_GOODWILL',
        }
        setMarkedRowId(newRow, dynamicRowIds[svcKey], xmlDoc)
        const cells = directChildren(newRow, 'tc')

        // Format description cell: EN=Calibri 10pt, CN=Microsoft YaHei 9pt
        if (cells.length > 1) {
          const descCell = cells[1]
          let descTcPr = directChildren(descCell, 'tcPr')[0]
          // Completely clear description cell (remove ALL child nodes except tcPr)
          for (let i = descCell.childNodes.length - 1; i >= 0; i--) {
            const child = descCell.childNodes[i] as Element
            if (child.nodeType === 1 && child.localName !== 'tcPr') {
              descCell.removeChild(child)
            }
          }

          // EN: Calibri 10pt (first paragraph)
          const p0 = xmlDoc.createElement('w:p')
          const p0Pr = xmlDoc.createElement('w:pPr')
          const p0Spacing = xmlDoc.createElement('w:spacing')
          p0Spacing.setAttribute('w:before', '0')
          p0Spacing.setAttribute('w:after', '0')
          p0Pr.appendChild(p0Spacing)
          p0.appendChild(p0Pr)
          p0.appendChild(makeCalibriRun(descEN, '20', xmlDoc, 'Calibri', false, 'Calibri'))
          if (descTcPr) {
            descCell.insertBefore(p0, descTcPr.nextSibling)
          } else {
            descCell.appendChild(p0)
          }

          // CN: Microsoft YaHei 9pt (second paragraph, after English)
          if (descCN) {
            const p1 = xmlDoc.createElement('w:p')
            const p1Pr = xmlDoc.createElement('w:pPr')
            const p1Spacing = xmlDoc.createElement('w:spacing')
            p1Spacing.setAttribute('w:before', '0')
            p1Spacing.setAttribute('w:after', '0')
            p1Pr.appendChild(p1Spacing)
            p1.appendChild(p1Pr)
            p1.appendChild(makeCalibriRun(descCN, '18', xmlDoc, 'Microsoft YaHei', false, 'Microsoft YaHei'))
            // Always append after p0, ensuring English is always before Chinese
            descCell.appendChild(p1)
          }
        }

        // Format fee cell: mixed Calibri (EN/numbers) and YaHei (CN)
        if (cells.length > 2) {
          const feeCell = cells[2]

          // Set cell vertical alignment to top FIRST
          let tcPr = directChildren(feeCell, 'tcPr')[0]
          if (!tcPr) {
            tcPr = xmlDoc.createElement('w:tcPr')
            feeCell.insertBefore(tcPr, feeCell.firstChild)
          }
          for (const va of directChildren(tcPr, 'vAlign')) tcPr.removeChild(va)
          const vAlign = xmlDoc.createElement('w:vAlign')
          vAlign.setAttribute('w:val', 'top')
          tcPr.appendChild(vAlign)

          // Completely clear fee cell (remove ALL child nodes except tcPr)
          for (let i = feeCell.childNodes.length - 1; i >= 0; i--) {
            const child = feeCell.childNodes[i] as Element
            if (child.nodeType === 1 && child.localName !== 'tcPr') {
              feeCell.removeChild(child)
            }
          }

          for (const line of feeLines) {
            const p = xmlDoc.createElement('w:p')
            const pPr = xmlDoc.createElement('w:pPr')
            const jc = xmlDoc.createElement('w:jc')
            jc.setAttribute('w:val', 'left')
            pPr.appendChild(jc)
            const spacing = xmlDoc.createElement('w:spacing')
            spacing.setAttribute('w:before', '0')
            spacing.setAttribute('w:after', '0')
            pPr.appendChild(spacing)
            p.appendChild(pPr)

            // Split by Chinese characters to apply different fonts
            const parts = line.split(/(?<=[^a-zA-Z0-9\/\-\(\) ])|(?=[^a-zA-Z0-9\/\-\(\) ])/)
            for (const part of parts) {
              if (/[^\x00-\x7F]/.test(part)) {
                // Contains non-ASCII (Chinese)
                p.appendChild(makeCalibriRun(part, '18', xmlDoc, 'Microsoft YaHei', false, 'Microsoft YaHei'))
              } else {
                // ASCII (English, numbers, symbols)
                p.appendChild(makeCalibriRun(part, '20', xmlDoc, 'Calibri', false, 'Calibri'))
              }
            }
            if (tcPr) {
              feeCell.insertBefore(p, tcPr.nextSibling || feeCell.firstChild)
            } else {
              feeCell.appendChild(p)
            }
          }
        }

        tbl.insertBefore(newRow, totalRowEl)
      } else {
        // For non-special services, use default formatting
        const newRow = createMainTableRow(rowNum, descEN, descCN, feeLines, refRow, xmlDoc)
        tbl.insertBefore(newRow, totalRowEl)
      }
    }
  }

  renumberTableRows(tbl)

  const finalRows = directChildren(tbl, 'tr')
  if (finalRows.length > 0) {
    const lastRow = finalRows[finalRows.length - 1]
    const lastCells = directChildren(lastRow, 'tc')
    if (lastCells.length > 0) {
      const totalCell = lastCells[lastCells.length - 1]
      updateMainTableTotalCell(totalCell, newTotal, xmlDoc, languageMode)
      // Set vertical alignment to center on the total fee cell
      {
        let tcPr = directChildren(totalCell, 'tcPr')[0]
        if (!tcPr) { tcPr = xmlDoc.createElement('w:tcPr'); totalCell.insertBefore(tcPr, totalCell.firstChild) }
        for (const v of directChildren(tcPr, 'vAlign')) tcPr.removeChild(v)
        const vAlign = xmlDoc.createElement('w:vAlign')
        vAlign.setAttribute('w:val', 'center')
        tcPr.appendChild(vAlign)
      }
      // "(Including secure deposit 含押金X,XXX.00)" — keep only when ND selected, update amount
      for (const p of directChildren(totalCell, 'p')) {
        if (!paraText(p).includes('Including secure deposit') && !paraText(p).includes('含押金')) continue
        if (!sel.has('ND')) {
          p.parentNode?.removeChild(p)
        } else {
          // Add indent to deposit line
          let pPr = directChildren(p, 'pPr')[0]
          if (!pPr) {
            pPr = xmlDoc.createElement('w:pPr')
            p.insertBefore(pPr, p.firstChild)
          }
          let ind = directChildren(pPr, 'w:ind')[0]
          if (!ind) {
            ind = xmlDoc.createElement('w:ind')
            ind.setAttribute('w:left', '141')
            pPr.appendChild(ind)
          }

          // Update deposit amount to reflect the actual ND_DEPOSIT override
          const depositAmt = feeOv['ND_DEPOSIT'] ?? 3000
          for (const t of allDescendants(p, 't')) {
            const txt = t.textContent ?? ''
            if (/[\d,]+\.\d+/.test(txt)) {
              t.textContent = txt.replace(/[\d,]+\.\d+/, fmtNum(depositAmt))
              break
            }
          }
        }
      }
    }
  }
}

// ── Table 2 total cell — English Calibri 11pt (sz=22), Chinese Calibri 10pt (sz=20) ──────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function updateOptTotalCell(tc: Element, amount: number, xmlDoc: any): void {
  const num = fmtNum(amount)
  for (const para of allDescendants(tc, 'p')) {
    const ts = allDescendants(para, 't')
    if (ts.length === 0) continue
    const combined = ts.map(t => t.textContent ?? '').join('')
    if (!combined.trim()) continue
    for (const r of directChildren(para, 'r')) r.parentNode?.removeChild(r)
    const newText = /[\d,]+\.\d+/.test(combined)
      ? combined.replace(/[\d,]+\.\d+/, num).trim()
      : combined.trim()
    const [enPart, cnPart] = splitAtChinese(newText)
    if (enPart) para.appendChild(makeCalibriRun(enPart, '22', xmlDoc, 'Calibri', true))
    if (cnPart) para.appendChild(makeCalibriRun(cnPart, '20', xmlDoc, 'Calibri', true))
  }
}

// ── process optional table ────────────────────────────────────────────────────

function processOptTable(
  body: Element, tbl: Element,
  sel: Set<string>, feeOv: Record<string, number>,
  mapping: Record<string, string[]>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  xmlDoc: any,
  focServicesSet: Set<string>,
  languageMode: 'bilingual' | 'english-only' = 'bilingual',
): void {
  const OPT_FEES: Record<string, number> = {
    ACCOUNTS: 1500, SECRETARIAL2: 700, ADDRESS2: 360, AR: 60,
    UNAUDITEDFS: 700, COMPANYTAX: 700, PERSONALTAX: 300, PAYROLL: 600,
    ND2: 3000, ND_DEPOSIT2: 0,
  }

  // IMPORTANT: Capture existing row numbers and fees BEFORE any modifications (BEFORE removal)
  const preserveRowNums = languageMode === 'english-only'
  const existingRowNums: Map<Element, string> = new Map()
  const existingFeeValues: Map<Element, string> = new Map()

  if (preserveRowNums) {
    for (const row of directChildren(tbl, 'tr')) {
      const cells = directChildren(row, 'tc')
      if (cells.length >= 3) {
        const numCell = cells[0]
        const feeCell = cells[2]
        const numText = cellText(numCell).trim()
        const feeText = cellText(feeCell).trim()
        if (numText && /^\d+$/.test(numText)) {
          existingRowNums.set(row, numText)
        }
        if (feeText && feeText !== 'Fee (SGD)' && feeText !== 'Fee(SGD)') {
          existingFeeValues.set(row, feeText)
        }
      }
    }
  }

  // Capture a valid data row BEFORE removal to use as clone reference in insertExtraOptRows
  let optDataRef: Element | undefined = undefined
  for (const row of directChildren(tbl, 'tr')) {
    const cells = directChildren(row, 'tc')
    if (cells.length < 2) continue
    if (/^\d+$/.test(cellText(cells[0]).trim())) { optDataRef = row; break }
  }

  // OPT_XBRL/OPT_AUDIT/OPT_AIS(_EN) are always re-created dynamically below via
  // insertExtraOptRows() (with their own numbering/formatting), so their template
  // rows must always be dropped here — otherwise the template row (kept by rowLinked
  // when selected, or kept unconditionally when unmatched in bilingual mode) and the
  // dynamic row both render, duplicating (or phantom-ing) the line.
  // Mirrors DYNAMIC_ROW_RIDS in processMainTable and the EP_DP_RENEW guard in processEpTable.
  const DYNAMIC_OPT_RIDS = new Set(['OPT_XBRL', 'OPT_AUDIT', 'OPT_AIS', 'OPT_AIS_EN'])

  const rowsToRemove: Element[] = []
  let dataRowsKept = 0
  for (const row of directChildren(tbl, 'tr')) {
    const cells = directChildren(row, 'tc')
    if (cells.length === 0) continue
    const rid = findRowId(cells, 'opt', languageMode)
    if (rid && DYNAMIC_OPT_RIDS.has(rid)) { rowsToRemove.push(row); continue }
    if (!rowLinked(cells, 'opt', sel, mapping, languageMode)) {
      rowsToRemove.push(row)
    } else {
      const txt = cells.map(c => cellText(c)).join(' ')
      if (!txt.includes('Service Scope') && !txt.includes('Total')) dataRowsKept++
    }
  }

  // If removing ND_DEPOSIT2, fix ND2's row height and cell properties
  for (const r of rowsToRemove) {
    const cells = directChildren(r, 'tc')
    if (cells.length > 0) {
      const txt = cells.map(c => cellText(c)).join(' ')
      // Check for both English and Chinese text of ND_DEPOSIT2
      const isDepositRow = txt.includes('Additional Deposit') || txt.includes('另付押金')

      if (isDepositRow) {
        const allRows = Array.from(tbl.getElementsByTagName('w:tr'))
        const rowIdx = allRows.indexOf(r)
        if (rowIdx > 0) {
          const prevRow = allRows[rowIdx - 1]
          const prevRowId = findMarkedRowId(prevRow)
          const prevCells = directChildren(prevRow, 'tc')

          // Fix row height: set to 560 (normal row height)
          const prevTrPr = directChildren(prevRow, 'trPr')[0]
          if (prevTrPr) {
            const trHeights = directChildren(prevTrPr, 'trHeight')
            for (const th of trHeights) {
              th.setAttribute('w:val', '560')  // Normal row height
            }
            // If no trHeight exists, create one
            if (trHeights.length === 0) {
              const newHeight = xmlDoc.createElement('w:trHeight')
              newHeight.setAttribute('w:val', '560')
              newHeight.setAttribute('w:type', 'dxa')
              prevTrPr.appendChild(newHeight)
            }
          } else {
            // If no trPr exists, create it with height
            const newTrPr = xmlDoc.createElement('w:trPr')
            const newHeight = xmlDoc.createElement('w:trHeight')
            newHeight.setAttribute('w:val', '560')
            newHeight.setAttribute('w:type', 'dxa')
            newTrPr.appendChild(newHeight)
            prevRow.insertBefore(newTrPr, prevRow.firstChild)
          }

          // Fix first cell (number cell) - remove vMerge, vAlign, and extra empty paragraphs
          if (prevCells.length > 0) {
            const firstCell = prevCells[0]
            const prevTcPr = directChildren(firstCell, 'tcPr')[0]
            if (prevTcPr) {
              // Remove vMerge
              const vMerges = directChildren(prevTcPr, 'vMerge')
              for (const vm of vMerges) vm.parentNode?.removeChild(vm)
              // Remove vAlign (vertical alignment)
              const vAligns = directChildren(prevTcPr, 'vAlign')
              for (const va of vAligns) va.parentNode?.removeChild(va)
            }

            // Remove extra empty paragraphs from the cell
            // Delete ALL paragraphs first, then find and keep only the content paragraph
            const paragraphs = directChildren(firstCell, 'p')
            let contentPara: Element | undefined = undefined
            let contentText = ''

            // Find paragraph with actual number content
            for (const para of paragraphs) {
              const texts = para.getElementsByTagName('w:t')
              let paraText = ''
              for (let t = 0; t < texts.length; t++) {
                paraText += texts[t].textContent
              }
              if (paraText.trim() && /^\d+$/.test(paraText.trim())) {
                contentPara = para
                contentText = paraText
                break
              }
            }

            // If found, remove ALL other paragraphs
            if (contentPara) {
              const allParas = directChildren(firstCell, 'p')
              for (const para of allParas) {
                if (para !== contentPara) {
                  firstCell.removeChild(para)
                }
              }
            }
          }

          // The marker may have lived in one of the empty paragraphs just
          // removed above. Restore it on the surviving number paragraph so
          // later generation stages never have to guess this row by text.
          if (prevRowId) setMarkedRowId(prevRow, prevRowId, xmlDoc)
        }
      }
    }
  }

  for (const r of rowsToRemove) r.parentNode?.removeChild(r)

  const extraSelected = ['XBRL', 'AUDIT', 'AIS'].some(k => sel.has(k))
  if (dataRowsKept === 0 && !extraSelected) {
    tbl.parentNode?.removeChild(tbl)
    // Remove both the English and Chinese opt-table headings, plus the page-break paragraph before them.
    for (const p of directChildren(body, 'p')) {
      const t = paraText(p)
      if (
        t.includes('Indicative Fees for Ongoing') || t.includes('Annual service fees') ||
        t.includes('公司后期维护') || t.includes('年度维护')
      ) {
        // Also remove the immediately preceding page-break paragraph if present.
        const bodyKids = Array.from({ length: body.childNodes.length }, (_, i) => body.childNodes[i])
          .filter((n): n is Element => (n as Element).nodeType === 1) as Element[]
        const idx = bodyKids.indexOf(p)
        if (idx > 0) {
          const prev = bodyKids[idx - 1]
          if (prev.localName === 'p' && allDescendants(prev, 'br').some(br => (br as Element).getAttribute('w:type') === 'page')) {
            prev.parentNode?.removeChild(prev)
          }
        }
        p.parentNode?.removeChild(p)
        // Remove the sibling heading paragraph immediately after (Chinese or English counterpart).
        const refreshedKids = Array.from({ length: body.childNodes.length }, (_, i) => body.childNodes[i])
          .filter((n): n is Element => (n as Element).nodeType === 1) as Element[]
        const nextIdx = refreshedKids.findIndex(n => {
          if (n.localName !== 'p') return false
          const nt = paraText(n as Element)
          return nt.includes('公司后期维护') || nt.includes('年度维护') || nt.includes('Indicative Fees for Ongoing')
        })
        if (nextIdx !== -1) refreshedKids[nextIdx].parentNode?.removeChild(refreshedKids[nextIdx])
        break
      }
    }
    return
  }

  // TABLE 2 is being kept — remove the page-break paragraph before its heading
  // so it flows directly after TABLE 1 with one blank line instead of a new page.
  for (const p of directChildren(body, 'p')) {
    const t = paraText(p)
    if (t.includes('Indicative Fees for Ongoing') || t.includes('公司后期维护') || t.includes('年度维护')) {
      const bodyKids = Array.from({ length: body.childNodes.length }, (_, i) => body.childNodes[i])
        .filter((n): n is Element => (n as Element).nodeType === 1) as Element[]
      const idx = bodyKids.indexOf(p)
      if (idx > 0) {
        const prev = bodyKids[idx - 1]
        if (prev.localName === 'p' && allDescendants(prev, 'br').some(br => (br as Element).getAttribute('w:type') === 'page')) {
          prev.parentNode?.removeChild(prev)
        }
      }
      break
    }
  }

  let newTotal = 0
  for (const [k, v] of Object.entries(OPT_FEES)) {
    if (sel.has(k) && !focServicesSet.has(k)) newTotal += feeOv[k] ?? v
  }
  for (const svc of SERVICES) {
    if (svc.table === 'optional' && ['foc', 'bundled', 'quote'].includes(svc.fee_type) && sel.has(svc.key)) {
      const extra = feeOv[svc.key]
      if (extra && !focServicesSet.has(svc.key)) newTotal += extra
    }
  }

  for (const row of directChildren(tbl, 'tr')) {
    const cells = directChildren(row, 'tc')
    if (cells.length === 0) continue
    const rid = findRowId(cells, 'opt', languageMode)
    if (rid) {
      const { rowIdToSvc } = getDefinitionSet(languageMode)
      const svcKey = rowIdToSvc[rid]
      if (svcKey) {
        if (focServicesSet.has(svcKey)) {
          setFeeCellFoc(cells[cells.length - 1], xmlDoc)
        } else if (feeOv[svcKey] !== undefined) {
          updateFeeCell(cells[cells.length - 1], feeOv[svcKey], xmlDoc, languageMode)
        }
        // Special handling for ND_DEPOSIT2: always update if we have the value
        if (svcKey === 'ND_DEPOSIT2' && feeOv['ND_DEPOSIT2'] !== undefined) {
          const feeCell = cells[cells.length - 1]

          // Copy tcPr from the first data row in the table (for width/margin consistency)
          const allRows = directChildren(tbl, 'tr')
          let referenceFeeCell: Element | null = null
          if (allRows.length > 1) {
            const refRow = allRows[1] as Element
            const refCells = directChildren(refRow, 'tc')
            if (refCells.length > 0) {
              referenceFeeCell = refCells[refCells.length - 1]
            }
          }
          if (referenceFeeCell) {
            const refTcPr = directChildren(referenceFeeCell, 'tcPr')[0]
            const existingTcPr = directChildren(feeCell, 'tcPr')[0]
            if (refTcPr && !existingTcPr) {
              feeCell.insertBefore(refTcPr.cloneNode(true), feeCell.firstChild)
            }
          }

          // Clear all paragraphs
          for (const p of directChildren(feeCell, 'p')) {
            feeCell.removeChild(p)
          }

          // Create new paragraph with proper formatting
          const p = xmlDoc.createElement('w:p')
          const pPr = xmlDoc.createElement('w:pPr')
          const pRPr = xmlDoc.createElement('w:rPr')
          const pSz = xmlDoc.createElement('w:sz')
          pSz.setAttribute('w:val', '20')
          const pSzCs = xmlDoc.createElement('w:szCs')
          pSzCs.setAttribute('w:val', '20')
          pRPr.appendChild(pSz)
          pRPr.appendChild(pSzCs)
          pPr.appendChild(pRPr)
          p.appendChild(pPr)

          // Add formatted run with fee value
          const r = makeCalibriRun(fmtNum(feeOv['ND_DEPOSIT2']), '20', xmlDoc)
          p.appendChild(r)
          feeCell.appendChild(p)
        }
      }
    }
  }

  insertExtraOptRows(tbl, sel, feeOv, focServicesSet, xmlDoc, optDataRef, languageMode)

  // Renumber all table rows (works for both bilingual and English templates)
  renumberTableRows(tbl)

  const rows = directChildren(tbl, 'tr')
  if (rows.length > 0) {
    const lastRow = rows[rows.length - 1]
    const lastCells = directChildren(lastRow, 'tc')
    if (lastCells.length > 0) updateOptTotalCell(lastCells[lastCells.length - 1], newTotal, xmlDoc)
  }
}

// ── process EP table ──────────────────────────────────────────────────────────

function processEpTable(
  tbl: Element, sel: Set<string>, feeOv: Record<string, number>,
  mapping: Record<string, string[]>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  xmlDoc: any,
  focServicesSet: Set<string>,
  languageMode: 'bilingual' | 'english-only' = 'bilingual',
): void {
  // Preserve row numbers and fees for English template
  const preserveRowNums = languageMode === 'english-only'
  const existingRowNums: Map<Element, string> = new Map()
  const existingFeeValues: Map<Element, string> = new Map()

  if (preserveRowNums) {
    for (const row of directChildren(tbl, 'tr')) {
      const cells = directChildren(row, 'tc')
      if (cells.length > 0) {
        const numCell = cells[0]
        const numText = cellText(numCell).trim()
        if (numText && /^\d+$/.test(numText)) {
          existingRowNums.set(row, numText)
        }
      }
      // Capture fee values from existing rows
      if (cells.length >= 3) {
        const feeCell = cells[2]
        const feeText = cellText(feeCell).trim()
        if (feeText && feeText !== 'Fee (SGD)' && feeText !== 'Fee(SGD)') {
          existingFeeValues.set(row, feeText)
        }
      }
    }
  }

  // Capture a valid data row BEFORE removal — used as reference for dynamic row cloning.
  // Must be captured here (pre-removal) to guarantee a proper template row is available.
  let epPreRef: Element | null = null
  for (const row of directChildren(tbl, 'tr')) {
    const cells = directChildren(row, 'tc')
    if (cells.length >= 2 && /^\d+$/.test(cellText(cells[0]).trim())) { epPreRef = row; break }
  }

  // EP_DP_RENEW is always re-created dynamically below (with its own numbering/formatting),
  // so its template row must always be dropped here — otherwise the template row (kept by
  // rowLinked when selected) and the dynamic row both render, duplicating the line.
  const rowsToRemove: Element[] = []
  let dataRowsKept = 0
  for (const row of directChildren(tbl, 'tr')) {
    const cells = directChildren(row, 'tc')
    if (cells.length === 0) continue
    const rid = findRowId(cells, 'ep', languageMode)
    if (rid === 'EP_DP_RENEW') { rowsToRemove.push(row); continue }
    if (!rowLinked(cells, 'ep', sel, mapping, languageMode)) {
      rowsToRemove.push(row)
    } else {
      const txt = cells.map(c => cellText(c)).join(' ')
      if (!txt.includes('Service Scope')) dataRowsKept++
    }
  }
  for (const r of rowsToRemove) r.parentNode?.removeChild(r)

  // Keep table if any template rows remain OR if DP_RENEW (dynamic) is selected
  if (dataRowsKept === 0 && !sel.has('DP_RENEW')) {
    tbl.parentNode?.removeChild(tbl)
    return
  }

  for (const row of directChildren(tbl, 'tr')) {
    const cells = directChildren(row, 'tc')
    if (cells.length === 0) continue
    const rid = findRowId(cells, 'ep', languageMode)
    if (rid) {
      const { rowIdToSvc } = getDefinitionSet(languageMode)
      const svcKey = rowIdToSvc[rid]
      if (svcKey) {
        // Set row height to 1.1cm for PASSRENEWAL (EP renewal service)
        if (svcKey === 'PASSRENEWAL') {
          let trPr = directChildren(row, 'trPr')[0]
          if (!trPr) {
            trPr = xmlDoc.createElement('w:trPr')
            row.insertBefore(trPr, row.firstChild)
          }
          for (const h of directChildren(trPr, 'trHeight')) trPr.removeChild(h)
          const trHeight = xmlDoc.createElement('w:trHeight')
          trHeight.setAttribute('w:val', '624')
          trHeight.setAttribute('w:type', 'dxa')
          trPr.appendChild(trHeight)
        }
        if (focServicesSet.has(svcKey)) {
          setFeeCellFoc(cells[cells.length - 1], xmlDoc)
        } else if (feeOv[svcKey] !== undefined) {
          updateFeeCell(cells[cells.length - 1], feeOv[svcKey], xmlDoc, languageMode)
        }
      }
    }
  }

  // Insert DP_RENEW dynamically after the DP Application row
  if (sel.has('DP_RENEW')) {
    const epRows = directChildren(tbl, 'tr')
    const refRow = epPreRef ?? epRows[epRows.length - 1]
    // Find DP Application row to insert after
    let dpRow: Element | null = null
    for (const row of epRows) {
      const cells = directChildren(row, 'tc')
      if (findRowId(cells, 'ep', languageMode) === 'EP_DP') { dpRow = row; break }
    }
    const insertAfter = dpRow ?? epRows[epRows.length - 1]
    // Count existing template digit rows to assign the correct sequential number
    let epDigitCount = 0
    for (const row of epRows) {
      const c = directChildren(row, 'tc')
      if (c.length > 0 && /^\d+$/.test(cellText(c[0]).trim())) epDigitCount++
    }
    const newRow = createMainTableRow(
      String(epDigitCount + 1),
      '', // Will format description separately
      '',
      [''], // placeholder, will be replaced with formatted fee
      refRow,
      xmlDoc,
    )
    setMarkedRowId(newRow, 'EP_DP_RENEW', xmlDoc)

    // Format DP renewal service row: description and fee cells
    // Set row height to 1.1cm (624 twips)
    let trPr = directChildren(newRow, 'trPr')[0]
    if (!trPr) {
      trPr = xmlDoc.createElement('w:trPr')
      newRow.insertBefore(trPr, newRow.firstChild)
    }
    for (const h of directChildren(trPr, 'trHeight')) trPr.removeChild(h)
    const trHeight = xmlDoc.createElement('w:trHeight')
    trHeight.setAttribute('w:val', '624')
    trHeight.setAttribute('w:type', 'dxa')
    trPr.appendChild(trHeight)

    const cells = directChildren(newRow, 'tc')

    // Format description cell (cells[1]): Microsoft YaHei
    if (cells.length > 1) {
      const descCell = cells[1]
      let descTcPr = directChildren(descCell, 'tcPr')[0]
      // Delete all paragraphs
      for (const p of directChildren(descCell, 'p')) p.parentNode?.removeChild(p)

      // EN: Microsoft YaHei 9pt
      const p0 = xmlDoc.createElement('w:p')
      const p0Pr = xmlDoc.createElement('w:pPr')
      const p0Spacing = xmlDoc.createElement('w:spacing')
      p0Spacing.setAttribute('w:before', '0')
      p0Spacing.setAttribute('w:after', '0')
      p0Pr.appendChild(p0Spacing)
      p0.appendChild(p0Pr)
      p0.appendChild(makeCalibriRun('DP renewal service', '18', xmlDoc, 'Microsoft YaHei', false, 'Microsoft YaHei'))
      if (descTcPr) {
        descCell.insertBefore(p0, descTcPr.nextSibling)
      } else {
        descCell.appendChild(p0)
      }

      // CN: Microsoft YaHei 9pt. Built here as its own dedicated paragraph
      // (unlike removeChineseContent()'s later strip-in-place pass, which
      // only removes CJK characters from a run and can't safely remove a
      // whole paragraph) -- so in english-only mode this paragraph must
      // simply never be created, not created-then-cleaned-up. The earlier
      // approach relied on removeChineseContent() to strip it afterward,
      // but that function assumes text before the first CJK character is
      // genuine standalone English worth preserving; here "DP" is part of
      // the Chinese phrase itself ("DP 续约"), so it survived the strip as
      // a stray leftover paragraph -- the "DP" line under "DP renewal
      // service" reported this session.
      if (languageMode === 'bilingual') {
        const p1 = xmlDoc.createElement('w:p')
        const p1Pr = xmlDoc.createElement('w:pPr')
        const p1Spacing = xmlDoc.createElement('w:spacing')
        p1Spacing.setAttribute('w:before', '0')
        p1Spacing.setAttribute('w:after', '0')
        p1Pr.appendChild(p1Spacing)
        p1.appendChild(p1Pr)
        p1.appendChild(makeCalibriRun('DP 续约（每2年一次）', '18', xmlDoc, 'Microsoft YaHei', false, 'Microsoft YaHei'))
        if (descTcPr) {
          descCell.insertBefore(p1, p0.nextSibling || descTcPr.nextSibling)
        } else {
          descCell.appendChild(p1)
        }
      }
    }

    // Format fee cell with mixed fonts
    if (cells.length > 2) {
      const feeCell = cells[2]

      // Set cell vertical alignment to top FIRST before deleting paragraphs
      let tcPr = directChildren(feeCell, 'tcPr')[0]
      if (!tcPr) {
        tcPr = xmlDoc.createElement('w:tcPr')
        feeCell.insertBefore(tcPr, feeCell.firstChild)
      }
      for (const va of directChildren(tcPr, 'vAlign')) tcPr.removeChild(va)
      const vAlign = xmlDoc.createElement('w:vAlign')
      vAlign.setAttribute('w:val', 'top')
      tcPr.appendChild(vAlign)

      // Delete ALL child nodes except tcPr (books, paragraphs, etc.)
      for (let i = feeCell.childNodes.length - 1; i >= 0; i--) {
        const child = feeCell.childNodes[i] as Element
        if (child.nodeType === 1 && child.localName !== 'tcPr') {
          feeCell.removeChild(child)
        }
      }

      // Line 1: "600.00/person" (+ " 每位" in bilingual mode only)
      const p1 = xmlDoc.createElement('w:p')
      const pPr1 = xmlDoc.createElement('w:pPr')
      const jc1 = xmlDoc.createElement('w:jc')
      jc1.setAttribute('w:val', 'left')
      pPr1.appendChild(jc1)
      const spacing1 = xmlDoc.createElement('w:spacing')
      spacing1.setAttribute('w:before', '0')
      spacing1.setAttribute('w:after', '0')
      pPr1.appendChild(spacing1)
      p1.appendChild(pPr1)
      const dpAmount = fmtNum(feeOv['DP_RENEW'] ?? 600)
      p1.appendChild(makeCalibriRun(dpAmount + '/person ', '20', xmlDoc, 'Calibri'))
      if (languageMode === 'bilingual') p1.appendChild(makeCalibriRun('每位', '18', xmlDoc, 'Microsoft YaHei'))
      feeCell.insertBefore(p1, tcPr.nextSibling)

      // Line 2: "(Government fee included)" in english-only mode -- complete
      // and self-contained, since there's no Chinese line 3 to carry the
      // closing paren. In bilingual mode this stays open, "(Government fee
      // included", and line 3 below closes it after the Chinese text --
      // matching the static bilingual template's own existing text flow
      // for this same phrase (one shared pair of parens wrapping both
      // languages). Previously the closing paren always lived only in the
      // Chinese-only run, so english-only output -- which drops that run
      // entirely rather than relying on removeChineseContent() to strip it
      // -- must supply its own now, or the line renders as "(Government
      // fee included" missing its close, as reported this session.
      const p2 = xmlDoc.createElement('w:p')
      const pPr2 = xmlDoc.createElement('w:pPr')
      const jc2 = xmlDoc.createElement('w:jc')
      jc2.setAttribute('w:val', 'left')
      pPr2.appendChild(jc2)
      const spacing2 = xmlDoc.createElement('w:spacing')
      spacing2.setAttribute('w:before', '0')
      spacing2.setAttribute('w:after', '0')
      pPr2.appendChild(spacing2)
      p2.appendChild(pPr2)
      const governmentFeeText = languageMode === 'bilingual' ? '(Government fee included' : '(Government fee included)'
      p2.appendChild(makeCalibriRun(governmentFeeText, '20', xmlDoc, 'Calibri'))
      feeCell.insertBefore(p2, p1.nextSibling)

      // Line 3: "含政府费用)" -- bilingual only, see line 2's comment.
      if (languageMode === 'bilingual') {
        const p3 = xmlDoc.createElement('w:p')
        const pPr3 = xmlDoc.createElement('w:pPr')
        const jc3 = xmlDoc.createElement('w:jc')
        jc3.setAttribute('w:val', 'left')
        pPr3.appendChild(jc3)
        const spacing3 = xmlDoc.createElement('w:spacing')
        spacing3.setAttribute('w:before', '0')
        spacing3.setAttribute('w:after', '0')
        pPr3.appendChild(spacing3)
        p3.appendChild(pPr3)
        p3.appendChild(makeCalibriRun('含政府费用)', '18', xmlDoc, 'Microsoft YaHei'))
        feeCell.insertBefore(p3, p2.nextSibling)
      }
    }

    if (insertAfter.nextSibling) {
      tbl.insertBefore(newRow, insertAfter.nextSibling)
    } else {
      tbl.appendChild(newRow)
    }
  }

  // Renumber all table rows (works for both bilingual and English templates)
  renumberTableRows(tbl)
}

// ── reformat Qty cells in changes table ──────────────────────────────────────

const QTY_PHRASES: Array<[RegExp, string, string]> = [
  [/Per\s+Transaction/i, 'Per Transaction', '每次'],
  [/One[\s-]Off/i,       'One-Off',         '一次性'],
  [/Per\s+Lodgement/i,   'Per Lodgement',   '每次登记'],
  [/Per\s+Set/i,         'Per Set',         '每份'],
  [/Per\s+Time/i,        'Per Time',        '每次'],
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reformatQtyCells(tbl: Element, xmlDoc: any): void {
  for (const row of directChildren(tbl, 'tr')) {
    const cells = directChildren(row, 'tc')
    if (cells.length < 4) continue
    const qtyCell = cells[3]
    const text = cellText(qtyCell)

    let enText: string | null = null
    let cnText: string | null = null
    for (const [regex, en, cn] of QTY_PHRASES) {
      if (regex.test(text)) { enText = en; cnText = cn; break }
    }
    if (!enText || !cnText) continue

    const existingParas = directChildren(qtyCell, 'p')
    const pPrClone = existingParas.length > 0
      ? (directChildren(existingParas[0], 'pPr')[0]?.cloneNode(true) ?? null)
      : null
    for (const p of existingParas) p.parentNode?.removeChild(p)

    const buildPara = (lineText: string, eastAsia: boolean) => {
      const p = xmlDoc.createElement('w:p')
      if (pPrClone) p.appendChild(pPrClone.cloneNode(true))
      const rPr = xmlDoc.createElement('w:rPr')
      const rFonts = xmlDoc.createElement('w:rFonts')
      rFonts.setAttribute('w:ascii', 'Calibri')
      rFonts.setAttribute('w:hAnsi', 'Calibri')
      if (eastAsia) rFonts.setAttribute('w:eastAsia', 'Microsoft YaHei')
      rPr.appendChild(rFonts)
      const sz = xmlDoc.createElement('w:sz'); sz.setAttribute('w:val', '14'); rPr.appendChild(sz)
      const szCs = xmlDoc.createElement('w:szCs'); szCs.setAttribute('w:val', '14'); rPr.appendChild(szCs)
      const r = xmlDoc.createElement('w:r')
      r.appendChild(rPr)
      const t = xmlDoc.createElement('w:t')
      t.setAttribute('xml:space', 'preserve')
      t.textContent = lineText
      r.appendChild(t)
      p.appendChild(r)
      return p
    }

    qtyCell.appendChild(buildPara(enText, false))
    qtyCell.appendChild(buildPara(cnText, true))
  }
}

// ── process company changes table ─────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processChangesTable(tbl: Element, ccOverrides: Record<string, number>, xmlDoc: any, languageMode: 'bilingual' | 'english-only' = 'bilingual'): void {
  const rows = directChildren(tbl, 'tr')
  const rowsById = new Map(rows.map((row) => [findMarkedRowId(row), row]))
  for (const item of CC_ITEMS) {
    let val = ccOverrides[item.key]
    if (val === undefined) {
      if (item.is_foc) continue
      val = item.default
    }
    if (val === 0) continue
    const targetRow = rowsById.get(item.key) ?? rows[item.row]
    if (targetRow) {
      const cells = directChildren(targetRow, 'tc')
      // Center align row number in first cell
      if (cells.length > 0) {
        for (const p of directChildren(cells[0], 'p')) {
          let pPr = directChildren(p, 'pPr')[0]
          if (!pPr) {
            pPr = xmlDoc.createElement('w:pPr')
            p.insertBefore(pPr, p.firstChild)
          }
          let jc = directChildren(pPr, 'w:jc')[0]
          if (!jc) {
            jc = xmlDoc.createElement('w:jc')
            jc.setAttribute('w:val', 'center')
            pPr.appendChild(jc)
          }
        }
      }
      if (cells.length > 4) updateCcCell(cells[4], val, xmlDoc, languageMode)
    }
  }
  reformatQtyCells(tbl, xmlDoc)
}

// ── add page break before appendix (changes table) ───────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addAppendixSpacing(body: Element, xmlDoc: any): void {
  for (const p of directChildren(body, 'p')) {
    if (paraText(p).includes('For any other post-incorporation')) {
      // Check if a page-break paragraph already exists immediately before this heading
      const bodyKids = Array.from({ length: body.childNodes.length }, (_, i) => body.childNodes[i])
        .filter((n): n is Element => (n as Element).nodeType === 1) as Element[]
      const idx = bodyKids.indexOf(p)
      const prevHasPageBreak = idx > 0 &&
        allDescendants(bodyKids[idx - 1], 'br').some(br => (br as Element).getAttribute('w:type') === 'page')
      if (!prevHasPageBreak) {
        const pageBreakP = xmlDoc.createElement('w:p')
        const pageBreakR = xmlDoc.createElement('w:r')
        const pageBreakBr = xmlDoc.createElement('w:br')
        pageBreakBr.setAttribute('w:type', 'page')
        pageBreakR.appendChild(pageBreakBr)
        pageBreakP.appendChild(pageBreakR)
        body.insertBefore(pageBreakP, p)
      }
      break
    }
  }
}

// ── normalize spacing before "General" section ───────────────────────────────
// The template has 5 blank paragraphs before "General"; ensure exactly 2.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeGeneralSpacing(body: Element, xmlDoc: any, languageMode?: string): void {
  const bodyKids = Array.from({ length: body.childNodes.length }, (_, i) => body.childNodes[i])
    .filter((n): n is Element => (n as Element).nodeType === 1) as Element[]

  let generalEl: Element | null = null
  let genIdx = -1
  for (let i = 0; i < bodyKids.length; i++) {
    if (bodyKids[i].localName === 'p' && paraText(bodyKids[i]).trim() === 'General') {
      generalEl = bodyKids[i]; genIdx = i; break
    }
  }
  if (!generalEl) return

  // Remove consecutive blank paragraphs immediately before "General"
  for (let i = genIdx - 1; i >= 0; i--) {
    if (bodyKids[i].localName !== 'p') break
    if (paraText(bodyKids[i]).trim() === '') {
      bodyKids[i].parentNode?.removeChild(bodyKids[i])
    } else {
      break
    }
  }

  // Insert page break before "General" ONLY for bilingual mode
  // English-only mode: skip page break to avoid blank pages
  if (languageMode !== 'english-only') {
    const pageBreakP = xmlDoc.createElement('w:p')
    const pageBreakR = xmlDoc.createElement('w:r')
    const pageBreakBr = xmlDoc.createElement('w:br')
    pageBreakBr.setAttribute('w:type', 'page')
    pageBreakR.appendChild(pageBreakBr)
    pageBreakP.appendChild(pageBreakR)
    body.insertBefore(pageBreakP, generalEl)
  }
}

// ── table column-width sync helpers ──────────────────────────────────────────

function readColWidths(tbl: Element): Array<{ w: string; type: string }> {
  const rows = directChildren(tbl, 'tr')
  if (rows.length === 0) return []
  const cells = directChildren(rows[0], 'tc')
  return cells.map(tc => {
    const tcPr = directChildren(tc, 'tcPr')[0]
    const tcW = tcPr ? directChildren(tcPr, 'tcW')[0] : undefined
    return {
      w: tcW?.getAttribute('w:w') ?? '0',
      type: tcW?.getAttribute('w:type') ?? 'dxa',
    }
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyColWidths(tbl: Element, colWidths: Array<{ w: string; type: string }>, xmlDoc: any): void {
  if (colWidths.length === 0) return

  // Update overall table width
  const tblPr = directChildren(tbl, 'tblPr')[0]
  if (tblPr) {
    const totalDxa = colWidths.reduce((s, c) => s + parseInt(c.w, 10), 0)
    for (const tw of directChildren(tblPr, 'tblW')) tblPr.removeChild(tw)
    const newTblW = xmlDoc.createElement('w:tblW')
    newTblW.setAttribute('w:w', String(totalDxa))
    newTblW.setAttribute('w:type', 'dxa')
    tblPr.appendChild(newTblW)
  }

  // Update grid column definitions
  const tblGrid = directChildren(tbl, 'tblGrid')[0]
  if (tblGrid) {
    for (const gc of directChildren(tblGrid, 'gridCol')) tblGrid.removeChild(gc)
    for (const col of colWidths) {
      const gridCol = xmlDoc.createElement('w:gridCol')
      gridCol.setAttribute('w:w', col.w)
      tblGrid.appendChild(gridCol)
    }
  }

  // Update per-cell widths; sum widths for horizontally merged cells (gridSpan)
  for (const row of directChildren(tbl, 'tr')) {
    const cells = directChildren(row, 'tc')
    let colIdx = 0
    for (const cell of cells) {
      if (colIdx >= colWidths.length) break
      let tcPr = directChildren(cell, 'tcPr')[0]
      if (!tcPr) {
        tcPr = xmlDoc.createElement('w:tcPr')
        const fp = directChildren(cell, 'p')[0]
        if (fp) cell.insertBefore(tcPr, fp)
        else cell.appendChild(tcPr)
      }
      const gridSpanEl = directChildren(tcPr, 'gridSpan')[0]
      const gridSpan = gridSpanEl ? parseInt(gridSpanEl.getAttribute('w:val') ?? '1', 10) : 1
      let mergedW = 0
      for (let j = colIdx; j < Math.min(colIdx + gridSpan, colWidths.length); j++) {
        mergedW += parseInt(colWidths[j].w, 10)
      }
      for (const tw of directChildren(tcPr, 'tcW')) tcPr.removeChild(tw)
      const newTcW = xmlDoc.createElement('w:tcW')
      newTcW.setAttribute('w:w', String(mergedW))
      newTcW.setAttribute('w:type', 'dxa')
      const fc = tcPr.childNodes[0]
      if (fc) tcPr.insertBefore(newTcW, fc as Element)
      else tcPr.appendChild(newTcW)
      colIdx += gridSpan
    }
  }
}

// ── remove all Chinese content for english-only mode ─────────────────────────
function removeChineseContent(body: Element): void {
  function processElement(el: Element): void {
    for (let i = el.childNodes.length - 1; i >= 0; i--) {
      const node = el.childNodes[i]
      if (node.nodeType === 3) {
        let text = node.textContent ?? ''
        const [enPart, cnPart] = splitAtChinese(text)

        // Only clean up if we actually found Chinese - preserve spacing if it's pure English
        if (cnPart) {
          text = enPart
            .replace(/[　-〿]/g, '')
            .replace(/[＀-￯]/g, '')
            .replace(/[一-鿿]/g, '')
            .replace(/[㐀-䶿]/g, '')
            .replace(/[/\\]/g, '')
            .trim()
          text = text.replace(/(\d+|\$)\s*[）\)]*\s*$/, '$1')
          text = text.replace(/^[\s()（）\[\]【】\{\}｛｝]*$/, '')
        }

        node.textContent = text
      } else if (node.nodeType === 1) {
        processElement(node as Element)
      }
    }
  }
  processElement(body)
}

// ── main export ───────────────────────────────────────────────────────────────

export async function generateDocx(input: DocInput): Promise<Buffer> {
  const plan = buildProposalPlan(input)
  const { templateFileName } = getDefinitionSet(input.languageMode)
  const templatePath = join(process.cwd(), 'template', templateFileName)
  const templateBuffer = readFileSync(templatePath)

  const zip = await JSZip.loadAsync(templateBuffer)
  const docEntry = zip.file('word/document.xml')
  if (!docEntry) throw new Error('Invalid DOCX: word/document.xml not found')

  const xmlStr = await docEntry.async('string')
  const parser = new DOMParser()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const xmlDoc: any = parser.parseFromString(xmlStr, 'application/xml')

  const bodies = allDescendants(xmlDoc.documentElement as Element, 'body')
  if (bodies.length === 0) throw new Error('Could not find w:body in document XML')
  const body = bodies[0]

  const selected = new Set(plan.selected)
  const mapping = plan.mapping
  const focServicesSet = new Set(input.focServices ?? [])

  fillHeader(body, input, xmlDoc)

  if (input.mode === 'selected') {
    removeServiceSections(body, selected, xmlDoc)
  }

  const mainTable = findMarkedTable(body, 'main')
  const optTable = findMarkedTable(body, 'opt')
  const epTable = findMarkedTable(body, 'ep')
  const changesTable = findMarkedTable(body, 'changes')
  if (!mainTable || !optTable || !epTable || !changesTable) {
    throw new Error('Template contract failed: stable table markers are missing; refusing positional fallback')
  }
  // Snapshot TABLE 2 column widths from the template before any processing
  const tbl2ColWidths = readColWidths(optTable)

  processMainTable(body, mainTable, selected, input.feeOverrides, mapping, xmlDoc, focServicesSet, input.languageMode)
  processOptTable(body, optTable, selected, input.feeOverrides, mapping, xmlDoc, focServicesSet, input.languageMode)
  processEpTable(epTable, selected, input.feeOverrides, mapping, xmlDoc, focServicesSet, input.languageMode)
  processChangesTable(changesTable, input.ccOverrides, xmlDoc, input.languageMode)

  // Align TABLE 1 column widths to TABLE 2 (TABLE 2 is the baseline; TABLE 1 adapts)
  if (tbl2ColWidths.length > 0 && mainTable.parentNode) {
    applyColWidths(mainTable, tbl2ColWidths, xmlDoc)
  }

  addAppendixSpacing(body, xmlDoc)
  normalizeGeneralSpacing(body, xmlDoc, input.languageMode)
  keepPaymentTermsTogether(body, xmlDoc)

  // Remove all Chinese content if english-only mode
  if (input.languageMode === 'english-only') {
    removeChineseContent(body)
  }

  // Final fail-closed audit. A proposal with missing/duplicate/phantom rows,
  // an absent client name, or mismatched narrative sections must never leave
  // the server as a seemingly successful download.
  assertGeneratedProposalContract(body, input, plan)

  // Word stores cached page-break positions from the original template.
  // They become invalid as soon as optional services are removed or inserted,
  // so the final document must force Word to paginate from the real content.
  removeStalePaginationCache(xmlDoc)

  const serializer = new XMLSerializer()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newXml = serializer.serializeToString(xmlDoc as any)
  zip.file('word/document.xml', newXml)
  await ensureRepeatedPageBranding(zip)

  return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>
}
