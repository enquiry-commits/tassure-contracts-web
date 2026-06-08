import JSZip from 'jszip'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom')
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  SERVICES, TEMPLATE_ORDER, ROW_DEFS, DEFAULT_MAPPING, ROW_ID_TO_SVC,
} from './services'
import { CC_ITEMS } from './company-changes'

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
}

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtSGD(n: number): string {
  const [int, dec] = n.toFixed(2).split('.')
  return 'SGD ' + int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + dec
}

function directChildren(el: Element, localName: string): Element[] {
  const result: Element[] = []
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i]
    if (n.nodeType === 1 && (n as Element).localName === localName) {
      result.push(n as Element)
    }
  }
  return result
}

function allDescendants(el: Element, localName: string): Element[] {
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

function paraText(p: Element): string {
  return allDescendants(p, 't').map(t => t.textContent ?? '').join('')
}

function cellText(tc: Element): string {
  return allDescendants(tc, 't').map(t => t.textContent ?? '').join('')
}

function rowIdForCell(text: string, table: string): string | null {
  for (const [id, rd] of Object.entries(ROW_DEFS)) {
    if (rd.table === table && text.includes(rd.match)) return id
  }
  return null
}

// Join text from all cells so tables with a leading "No." column still match correctly.
function rowLinked(cells: Element[], table: string, sel: Set<string>, mapping: Record<string, string[]>): boolean {
  const text = cells.map(c => cellText(c)).join(' ')
  if (text.includes('Service Scope') || text.includes('Total')) return true
  const rid = rowIdForCell(text, table)
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
function findRowId(cells: Element[], table: string): string | null {
  const text = cells.map(c => cellText(c)).join(' ')
  return rowIdForCell(text, table)
}

function fmtNum(n: number): string {
  return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// Split text at first Chinese character: ["English part", "中文部分"]
function splitAtChinese(text: string): [string, string] {
  const m = text.search(/[一-鿿㐀-䶿]/)
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
function updateFeeCell(tc: Element, amount: number, xmlDoc: any): void {
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
    if (cnPart) para.appendChild(makeCalibriRun(cnPart, '18', xmlDoc, 'Microsoft YaHei'))
    // Delete all other paragraphs
    for (const p of directChildren(tc, 'p')) {
      if (p !== para) p.parentNode?.removeChild(p)
    }
    return
  }
}

function updateCcCell(tc: Element, amount: number): void {
  const newText = fmtSGD(amount)
  for (const p of allDescendants(tc, 'p')) {
    for (const r of allDescendants(p, 'r')) {
      for (const t of allDescendants(r, 't')) {
        if ((t.textContent ?? '').trim()) {
          t.textContent = newText
          return
        }
      }
    }
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

  // Para 0: update date text
  const datePara = paras[0]
  const runs0 = allDescendants(datePara, 'r')
  if (runs0.length > 0) {
    const ts = allDescendants(runs0[0], 't')
    if (ts.length > 0) ts[0].textContent = `Date:  ${input.date}`
  }

  // Clone para 0 → company name paragraph, clear all runs, insert new run
  const companyPara = datePara.cloneNode(true) as Element
  for (const r of allDescendants(companyPara, 'r')) {
    r.parentNode?.removeChild(r)
  }
  const newRun = xmlDoc.createElement('w:r')
  const newT = xmlDoc.createElement('w:t')
  newT.setAttribute('xml:space', 'preserve')
  newT.textContent = `Company Name  企业名字:  ${input.companyName}`
  newRun.appendChild(newT)
  companyPara.appendChild(newRun)
  body.insertBefore(companyPara, datePara.nextSibling)

  // Find "Dear Management" paragraph and update salutation
  for (const p of directChildren(body, 'p')) {
    const runs = allDescendants(p, 'r')
    if (runs.length === 0) continue
    const ts = allDescendants(runs[0], 't')
    if (ts.length === 0) continue
    if ((ts[0].textContent ?? '').includes('Dear Management')) {
      let salEn = input.salutationEn
      if (!salEn.endsWith(' ')) salEn += '  '
      ts[0].textContent = salEn
      if (runs.length > 1) {
        const ts2 = allDescendants(runs[1], 't')
        if (ts2.length > 0) ts2[0].textContent = input.salutationCn
      }
      break
    }
  }
}

// ── update Table 1 total cell ─────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function updateMainTableTotalCell(tc: Element, amount: number, xmlDoc: any): void {
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
  updateFeeCell(tc, amount, xmlDoc)
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
  DP:          "Dependant's Pass",
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

function removeServiceSections(body: Element, selected: Set<string>): void {
  const paras = directChildren(body, 'p')

  // Find the fee section boundary: first page-break paragraph or known fee heading text.
  let feeStartIdx = paras.length
  for (let i = 0; i < paras.length; i++) {
    const text = paraText(paras[i])
    if (text.includes('Company Incorporation and First-Year Service Fees') || text.includes('Related Service Fees')) {
      feeStartIdx = i; break
    }
    const hasPageBreak = allDescendants(paras[i], 'br').some(br => (br as Element).getAttribute('w:type') === 'page')
    if (hasPageBreak) { feeStartIdx = i; break }
  }

  // Detect service heading paragraphs in document order using known heading phrases.
  const headings: [string, number][] = []
  for (let i = 0; i < feeStartIdx; i++) {
    const text = paraText(paras[i])
    for (const [svcKey, phrase] of Object.entries(SECTION_HEADING)) {
      if (text.includes(phrase)) { headings.push([svcKey, i]); break }
    }
  }

  // SECRETARIAL/ADDRESS sections should be kept if EITHER the T1 or T2 version is selected
  const COUNTERPART: Record<string, string> = { SECRETARIAL: 'SECRETARIAL2', ADDRESS: 'ADDRESS2' }

  const toDelete: Element[] = []
  for (let hi = 0; hi < headings.length; hi++) {
    const [svcKey, startI] = headings[hi]
    const counterpart = COUNTERPART[svcKey]
    const keep = selected.has(svcKey) || (counterpart != null && selected.has(counterpart))
    if (!keep) {
      const endI = hi + 1 < headings.length ? headings[hi + 1][1] : feeStartIdx
      for (let j = startI; j < endI; j++) toDelete.push(paras[j])
    }
  }
  for (const elem of toDelete) elem.parentNode?.removeChild(elem)
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
    if (!/^\d+$/.test(combined.trim())) continue
    for (const t of allT) {
      if (/^\d+$/.test((t.textContent ?? '').trim())) {
        t.textContent = String(counter++)
        break
      }
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

  const rowsToRemove: Element[] = []
  for (const row of directChildren(tbl, 'tr')) {
    const cells = directChildren(row, 'tc')
    if (cells.length === 0) continue
    if (!rowLinked(cells, 'main', sel, mapping)) rowsToRemove.push(row)
  }
  for (const r of rowsToRemove) r.parentNode?.removeChild(r)

  const FOC_MERGE_RIDS = new Set(['MAIN_POST_EP', 'MAIN_CORPPASS', 'MAIN_PDPA', 'MAIN_CORP_CONSULT'])
  const FOC_RID_TO_KEY: Record<string, string> = {
    MAIN_POST_EP: 'POST_EP', MAIN_CORPPASS: 'CORPPASS',
    MAIN_PDPA: 'PDPA', MAIN_CORP_CONSULT: 'CORP_CONSULT',
  }

  // Step 1 — set fee content for every surviving row.
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

    const rid = findRowId(cells, 'main')
    if (rid === 'MAIN_ND_DEPOSIT') {
      const depositAmt = feeOv['ND_DEPOSIT']
      if (depositAmt !== undefined) updateFeeCell(cells[cells.length - 1], depositAmt, xmlDoc)
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
      const svcKey = ROW_ID_TO_SVC[rid]
      if (svcKey) {
        if (focServicesSet.has(svcKey)) {
          setFeeCellFoc(cells[cells.length - 1], xmlDoc)
        } else if (feeOv[svcKey] !== undefined) {
          updateFeeCell(cells[cells.length - 1], feeOv[svcKey], xmlDoc)
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
    if (goodwillDiscount > 0) {
      dynRows.push({
        svcKey: 'GOODWILL_DISC',
        numPlaceholder: '',   // empty → renumber skips it
        descEN: 'Goodwill Discount',
        descCN: '折扣-整体配套',
        feeLines: ['-' + fmtNum(goodwillDiscount)],
      })
    }

    let dynSeq = templateDigitCount + 1
    for (const { svcKey, numPlaceholder, descEN, descCN, feeLines } of dynRows) {
      if (!sel.has(svcKey)) continue
      const rowNum = numPlaceholder ? String(dynSeq++) : ''

      if (['CERT', 'DP_MAIN', 'LOC_MAIN', 'GOODWILL_DISC'].includes(svcKey)) {
        // For special services, create row with empty description and fee, then format separately
        const newRow = createMainTableRow(rowNum, '', '', [''], refRow, xmlDoc)
        const cells = directChildren(newRow, 'tc')

        // Format description cell: EN=Calibri 10pt, CN=Microsoft YaHei 9pt
        if (cells.length > 1) {
          const descCell = cells[1]
          let descTcPr = directChildren(descCell, 'tcPr')[0]
          for (const p of directChildren(descCell, 'p')) p.parentNode?.removeChild(p)

          // EN: Calibri 10pt
          const p0 = xmlDoc.createElement('w:p')
          p0.appendChild(makeCalibriRun(descEN, '20', xmlDoc, 'Calibri', false, 'Calibri'))
          if (descTcPr) {
            descCell.insertBefore(p0, descTcPr.nextSibling)
          } else {
            descCell.appendChild(p0)
          }

          // CN: Microsoft YaHei 9pt (all fonts in this line)
          if (descCN) {
            const p1 = xmlDoc.createElement('w:p')
            p1.appendChild(makeCalibriRun(descCN, '18', xmlDoc, 'Microsoft YaHei', false, 'Microsoft YaHei'))
            if (descTcPr) {
              descCell.insertBefore(p1, descTcPr.nextSibling || p0.nextSibling)
            } else {
              descCell.appendChild(p1)
            }
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

          // Now delete paragraphs
          for (const p of directChildren(feeCell, 'p')) p.parentNode?.removeChild(p)

          for (const line of feeLines) {
            const p = xmlDoc.createElement('w:p')
            const pPr = xmlDoc.createElement('w:pPr')
            const jc = xmlDoc.createElement('w:jc')
            jc.setAttribute('w:val', 'left')
            pPr.appendChild(jc)
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
      updateMainTableTotalCell(totalCell, newTotal, xmlDoc)
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
): void {
  const OPT_FEES: Record<string, number> = {
    ACCOUNTS: 1500, SECRETARIAL2: 700, ADDRESS2: 360, AR: 60,
    UNAUDITEDFS: 700, COMPANYTAX: 700, PERSONALTAX: 300, PAYROLL: 600,
  }

  // Capture a valid data row BEFORE removal to use as clone reference in insertExtraOptRows
  let optDataRef: Element | undefined = undefined
  for (const row of directChildren(tbl, 'tr')) {
    const cells = directChildren(row, 'tc')
    if (cells.length < 2) continue
    if (/^\d+$/.test(cellText(cells[0]).trim())) { optDataRef = row; break }
  }

  const rowsToRemove: Element[] = []
  let dataRowsKept = 0
  for (const row of directChildren(tbl, 'tr')) {
    const cells = directChildren(row, 'tc')
    if (cells.length === 0) continue
    if (!rowLinked(cells, 'opt', sel, mapping)) {
      rowsToRemove.push(row)
    } else {
      const txt = cells.map(c => cellText(c)).join(' ')
      if (!txt.includes('Service Scope') && !txt.includes('Total')) dataRowsKept++
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
    const rid = findRowId(cells, 'opt')
    if (rid) {
      const svcKey = ROW_ID_TO_SVC[rid]
      if (svcKey) {
        if (focServicesSet.has(svcKey)) {
          setFeeCellFoc(cells[cells.length - 1], xmlDoc)
        } else if (feeOv[svcKey] !== undefined) {
          updateFeeCell(cells[cells.length - 1], feeOv[svcKey], xmlDoc)
        }
      }
    }
  }

  insertExtraOptRows(tbl, sel, feeOv, focServicesSet, xmlDoc, optDataRef)
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
): void {
  // Capture a valid data row BEFORE removal — used as reference for dynamic row cloning.
  // Must be captured here (pre-removal) to guarantee a proper template row is available.
  let epPreRef: Element | null = null
  for (const row of directChildren(tbl, 'tr')) {
    const cells = directChildren(row, 'tc')
    if (cells.length >= 2 && /^\d+$/.test(cellText(cells[0]).trim())) { epPreRef = row; break }
  }

  const rowsToRemove: Element[] = []
  let dataRowsKept = 0
  for (const row of directChildren(tbl, 'tr')) {
    const cells = directChildren(row, 'tc')
    if (cells.length === 0) continue
    if (!rowLinked(cells, 'ep', sel, mapping)) {
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
    const rid = findRowId(cells, 'ep')
    if (rid) {
      const svcKey = ROW_ID_TO_SVC[rid]
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
          updateFeeCell(cells[cells.length - 1], feeOv[svcKey], xmlDoc)
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
      if (findRowId(cells, 'ep') === 'EP_DP') { dpRow = row; break }
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

      // CN: Microsoft YaHei 9pt
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

      // Line 1: "600.00/person 每位"
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
      p1.appendChild(makeCalibriRun('每位', '18', xmlDoc, 'Microsoft YaHei'))
      feeCell.insertBefore(p1, tcPr.nextSibling)

      // Line 2: "(Government fee included"
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
      p2.appendChild(makeCalibriRun('(Government fee included', '20', xmlDoc, 'Calibri'))
      feeCell.insertBefore(p2, p1.nextSibling)

      // Line 3: "含政府费用)"
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

    if (insertAfter.nextSibling) {
      tbl.insertBefore(newRow, insertAfter.nextSibling)
    } else {
      tbl.appendChild(newRow)
    }
  }

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
function processChangesTable(tbl: Element, ccOverrides: Record<string, number>, xmlDoc: any): void {
  const rows = directChildren(tbl, 'tr')
  for (const item of CC_ITEMS) {
    let val = ccOverrides[item.key]
    if (val === undefined) {
      if (item.is_foc) continue
      val = item.default
    }
    if (val === 0) continue
    if (item.row < rows.length) {
      const cells = directChildren(rows[item.row], 'tc')
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
      if (cells.length > 4) updateCcCell(cells[4], val)
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
function normalizeGeneralSpacing(body: Element, xmlDoc: any): void {
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

  // Insert page break before "General"
  const pageBreakP = xmlDoc.createElement('w:p')
  const pageBreakR = xmlDoc.createElement('w:r')
  const pageBreakBr = xmlDoc.createElement('w:br')
  pageBreakBr.setAttribute('w:type', 'page')
  pageBreakR.appendChild(pageBreakBr)
  pageBreakP.appendChild(pageBreakR)
  body.insertBefore(pageBreakP, generalEl)
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

// ── main export ───────────────────────────────────────────────────────────────

export async function generateDocx(input: DocInput): Promise<Buffer> {
  const templatePath = join(process.cwd(), 'template', 'Tassure_Proposal_Template.docx')
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

  const selected = new Set(input.selected)
  const mapping = input.sectionMapping ?? Object.fromEntries(
    Object.entries(DEFAULT_MAPPING).map(([k, v]) => [k, [...v]])
  )
  const focServicesSet = new Set(input.focServices ?? [])

  fillHeader(body, input, xmlDoc)

  if (input.mode === 'selected') {
    removeServiceSections(body, selected)
  }

  const tables = directChildren(body, 'tbl')
  // Snapshot TABLE 2 column widths from the template before any processing
  const tbl2ColWidths = tables.length >= 2 ? readColWidths(tables[1]) : []

  if (tables.length >= 1) processMainTable(body, tables[0], selected, input.feeOverrides, mapping, xmlDoc, focServicesSet)
  if (tables.length >= 2) processOptTable(body, tables[1], selected, input.feeOverrides, mapping, xmlDoc, focServicesSet)
  if (tables.length >= 3) processEpTable(tables[2], selected, input.feeOverrides, mapping, xmlDoc, focServicesSet)
  if (tables.length >= 4) processChangesTable(tables[3], input.ccOverrides, xmlDoc)

  // Align TABLE 1 column widths to TABLE 2 (TABLE 2 is the baseline; TABLE 1 adapts)
  if (tbl2ColWidths.length > 0 && tables.length >= 1 && tables[0].parentNode) {
    applyColWidths(tables[0], tbl2ColWidths, xmlDoc)
  }

  addAppendixSpacing(body, xmlDoc)
  normalizeGeneralSpacing(body, xmlDoc)

  const serializer = new XMLSerializer()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newXml = serializer.serializeToString(xmlDoc as any)
  zip.file('word/document.xml', newXml)

  return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>
}
