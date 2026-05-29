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
  if (rid === null) return true  // unknown rows always kept (e.g. Corporate Consultation Support)
  // These F.O.C. rows are always shown in the main table regardless of service selection.
  if (table === 'main' && (rid === 'MAIN_POST_EP' || rid === 'MAIN_CORPPASS' || rid === 'MAIN_PDPA')) return true
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

function updateFeeCell(tc: Element, amount: number): void {
  const num = fmtNum(amount)
  for (const run of allDescendants(tc, 'r')) {
    for (const t of allDescendants(run, 't')) {
      const txt = t.textContent ?? ''
      if (/SGD\s+[\d,]+\.?\d*/.test(txt)) {
        t.textContent = txt.replace(/SGD\s+[\d,]+\.?\d*/, fmtSGD(amount))
        return
      }
      if (txt.includes('F.O.C.')) { t.textContent = txt.replace('F.O.C.', fmtSGD(amount)); return }
      if (txt.includes('On Quote')) { t.textContent = txt.replace('On Quote', fmtSGD(amount)); return }
      // New template uses plain numbers like "900.00", "3,000.00", "12,960.00(Including...)"
      if (/[\d,]+\.\d+/.test(txt)) {
        t.textContent = txt.replace(/[\d,]+\.\d+/, num)
        return
      }
    }
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setFeeCellFoc(tc: Element, xmlDoc: any): void {
  const existingParas = directChildren(tc, 'p')
  const templatePara = existingParas.length > 0 ? existingParas[0].cloneNode(true) as Element : null
  // Grab a template run so we can clone its w:rPr (font settings) for each new line.
  const templateRuns = templatePara ? allDescendants(templatePara, 'r') : []
  const templateRun = templateRuns.length > 0 ? templateRuns[0] : null

  for (const p of existingParas) p.parentNode?.removeChild(p)

  const lines = ['F.O.C.', 'Included in package', '不另收费', '(含在报价配套内)']
  for (const line of lines) {
    const newPara = templatePara ? templatePara.cloneNode(true) as Element : xmlDoc.createElement('w:p')
    // Remove all existing runs from the clone; keep w:pPr intact.
    for (const r of directChildren(newPara, 'r')) r.parentNode?.removeChild(r)

    // Clone a template run to inherit w:rPr (fonts, size, colour) — prevents Word
    // from guessing a wrong East-Asian font (e.g. Korean) for CJK characters.
    const run = templateRun
      ? (templateRun.cloneNode(true) as Element)
      : xmlDoc.createElement('w:r')
    // Clear any existing text nodes inside the cloned run, then set new text.
    for (const t of allDescendants(run, 't')) t.parentNode?.removeChild(t)
    const t = xmlDoc.createElement('w:t')
    t.setAttribute('xml:space', 'preserve')
    t.textContent = line
    run.appendChild(t)
    newPara.appendChild(run)
    tc.appendChild(newPara)
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
): void {
  const EXTRAS = [
    { key: 'XBRL',  en: 'XBRL Reporting Service',  cn: 'XBRL报告服务' },
    { key: 'AUDIT', en: 'Auditing Services',         cn: '公司审计' },
    { key: 'AIS',   en: 'AIS / IR8A Services',       cn: '员工年收入申报' },
  ]
  const toInsert = EXTRAS.filter(e => sel.has(e.key))
  if (toInsert.length === 0) return

  const rows = directChildren(tbl, 'tr')
  if (rows.length < 2) return
  const totalRow = rows[rows.length - 1]
  const templateRow = rows[rows.length - 2]

  for (const extra of toInsert) {
    const svc = SERVICES.find(s => s.key === extra.key)
    const newRow = templateRow.cloneNode(true) as Element
    const cells = directChildren(newRow, 'tc')
    if (cells.length < 2) continue

    // Mark number cell with a digit so renumberTableRows picks it up
    for (const t of allDescendants(cells[0], 't')) {
      if (/^\d+$/.test((t.textContent ?? '').trim())) { t.textContent = '99'; break }
    }

    // Service name cell
    overrideFirstParaText(cells[1], `${extra.en}  ${extra.cn}`, xmlDoc)

    // Fee cell
    let feeText: string
    if (focServicesSet.has(extra.key)) {
      feeText = 'F.O.C. / 不另收费'
    } else if (feeOv[extra.key] !== undefined) {
      feeText = fmtSGD(feeOv[extra.key])
    } else {
      feeText = svc?.fee_type === 'bundled' ? 'Bundled / 含在配套内' : 'On Quote / 按实报价'
    }
    overrideFirstParaText(cells[cells.length - 1], feeText, xmlDoc)

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

  const toDelete: Element[] = []
  for (let hi = 0; hi < headings.length; hi++) {
    const [svcKey, startI] = headings[hi]
    if (!selected.has(svcKey)) {
      const endI = hi + 1 < headings.length ? headings[hi + 1][1] : feeStartIdx
      for (let j = startI; j < endI; j++) toDelete.push(paras[j])
    }
  }
  for (const elem of toDelete) elem.parentNode?.removeChild(elem)
}

// ── renumber table rows ───────────────────────────────────────────────────────

function renumberTableRows(tbl: Element): void {
  let counter = 1
  for (const row of directChildren(tbl, 'tr')) {
    const cells = directChildren(row, 'tc')
    if (cells.length === 0) continue
    const numCell = cells[0]
    const num = cellText(numCell).trim()
    // Only renumber cells that contain a plain integer (skip "No." header, empty cells, Total rows)
    if (/^\d+$/.test(num)) {
      for (const t of allDescendants(numCell, 't')) {
        if (/^\d+$/.test((t.textContent ?? '').trim())) {
          t.textContent = String(counter++)
          break
        }
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
  const MAIN_FEES: Record<string, number> = {
    INCORP: 900, SECRETARIAL: 700, ADDRESS: 360, ND: 3000, EP: 4000, BANK: 1000,
  }

  // Find heading immediately before tbl — needed when removing the table.
  const bodyKids = Array.from({ length: body.childNodes.length }, (_, i) => body.childNodes[i])
    .filter((n): n is Element => (n as Element).nodeType === 1) as Element[]
  const tblIdx = bodyKids.indexOf(tbl)
  let headingBeforeTbl: Element | null = null
  for (let i = tblIdx - 1; i >= 0; i--) {
    if (bodyKids[i].localName === 'p') { headingBeforeTbl = bodyKids[i]; break }
  }

  // Remove table + heading only when no main-table service is selected at all.
  // (Do NOT use newTotal === 0 — F.O.C. services are selected but contribute 0 to total.)
  const anyMainSelected = SERVICES.some(s => s.table === 'main' && sel.has(s.key))
  if (!anyMainSelected) {
    tbl.parentNode?.removeChild(tbl)
    headingBeforeTbl?.parentNode?.removeChild(headingBeforeTbl)
    return
  }

  // The template already contains a built-in <w:br type="page"/> paragraph immediately
  // before the "Company Incorporation..." heading, so no additional page break is needed here.

  // Calculate total (F.O.C. services excluded — shown in their cell but not summed).
  let newTotal = 0
  for (const [k, v] of Object.entries(MAIN_FEES)) {
    if (sel.has(k) && !focServicesSet.has(k)) newTotal += feeOv[k] ?? v
  }
  for (const svc of SERVICES) {
    if (svc.table === 'main' && ['foc', 'bundled'].includes(svc.fee_type) && sel.has(svc.key)) {
      const extra = feeOv[svc.key]
      if (extra && !focServicesSet.has(svc.key)) newTotal += extra
    }
  }

  // Deposit is always 3000 (or override) when ND is selected — template sub-row is kept via mapping.
  if (sel.has('ND') && !focServicesSet.has('ND')) newTotal += feeOv['ND_DEPOSIT'] ?? 3000

  const rowsToRemove: Element[] = []
  for (const row of directChildren(tbl, 'tr')) {
    const cells = directChildren(row, 'tc')
    if (cells.length === 0) continue
    if (!rowLinked(cells, 'main', sel, mapping)) rowsToRemove.push(row)
  }
  for (const r of rowsToRemove) r.parentNode?.removeChild(r)

  for (const row of directChildren(tbl, 'tr')) {
    const cells = directChildren(row, 'tc')
    if (cells.length === 0) continue
    const rid = findRowId(cells, 'main')
    if (rid === 'MAIN_ND_DEPOSIT') {
      // Template already contains this sub-row; just update fee if overridden.
      const depositAmt = feeOv['ND_DEPOSIT']
      if (depositAmt !== undefined) updateFeeCell(cells[cells.length - 1], depositAmt)
    } else if (rid) {
      const svcKey = ROW_ID_TO_SVC[rid]
      if (svcKey) {
        if (focServicesSet.has(svcKey)) {
          setFeeCellFoc(cells[cells.length - 1], xmlDoc)
        } else if (feeOv[svcKey] !== undefined) {
          updateFeeCell(cells[cells.length - 1], feeOv[svcKey])
        }
      }
    }
  }

  renumberTableRows(tbl)

  const finalRows = directChildren(tbl, 'tr')
  if (finalRows.length > 0) {
    const lastRow = finalRows[finalRows.length - 1]
    const lastCells = directChildren(lastRow, 'tc')
    if (lastCells.length > 0) updateFeeCell(lastCells[lastCells.length - 1], newTotal)
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
    ACCOUNTS: 1500, SECRETARIAL: 700, ADDRESS: 360, AR: 60,
    UNAUDITEDFS: 700, COMPANYTAX: 700, PERSONALTAX: 300, PAYROLL: 600,
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
          updateFeeCell(cells[cells.length - 1], feeOv[svcKey])
        }
      }
    }
  }

  insertExtraOptRows(tbl, sel, feeOv, focServicesSet, xmlDoc)
  renumberTableRows(tbl)

  const rows = directChildren(tbl, 'tr')
  if (rows.length > 0) {
    const lastRow = rows[rows.length - 1]
    const lastCells = directChildren(lastRow, 'tc')
    if (lastCells.length > 0) updateFeeCell(lastCells[lastCells.length - 1], newTotal)
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

  if (dataRowsKept === 0) {
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
        if (focServicesSet.has(svcKey)) {
          setFeeCellFoc(cells[cells.length - 1], xmlDoc)
        } else if (feeOv[svcKey] !== undefined) {
          updateFeeCell(cells[cells.length - 1], feeOv[svcKey])
        }
      }
    }
  }

  renumberTableRows(tbl)
}

// ── process company changes table ─────────────────────────────────────────────

function processChangesTable(tbl: Element, ccOverrides: Record<string, number>): void {
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
      if (cells.length > 4) updateCcCell(cells[4], val)
    }
  }
}

// ── add appendix spacing ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addAppendixSpacing(body: Element, xmlDoc: any): void {
  for (const p of directChildren(body, 'p')) {
    if (paraText(p).includes('For any other post-incorporation')) {
      for (let i = 0; i < 3; i++) {
        const newP = xmlDoc.createElement('w:p')
        body.insertBefore(newP, p)
      }
      break
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
  if (tables.length >= 1) processMainTable(body, tables[0], selected, input.feeOverrides, mapping, xmlDoc, focServicesSet)
  if (tables.length >= 2) processOptTable(body, tables[1], selected, input.feeOverrides, mapping, xmlDoc, focServicesSet)
  if (tables.length >= 3) processEpTable(tables[2], selected, input.feeOverrides, mapping, xmlDoc, focServicesSet)
  if (tables.length >= 4) processChangesTable(tables[3], input.ccOverrides)

  addAppendixSpacing(body, xmlDoc)

  const serializer = new XMLSerializer()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newXml = serializer.serializeToString(xmlDoc as any)
  zip.file('word/document.xml', newXml)

  return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>
}
