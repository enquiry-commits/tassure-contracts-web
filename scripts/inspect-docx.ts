// scripts/inspect-docx.ts
//
// Structural inspector for any Tassure proposal .docx (a template file, or a
// generated proposal). Prints, per table, per row: the row index, a text
// preview, the row-ID it resolves to via the SAME matching logic
// docGenerator.ts uses at generation time (imported directly — never
// reimplemented here), the service key that row-ID maps to (if any), and
// flags for rows that are unmatched or that duplicate a service already
// seen earlier in the same table. Also reports a lightweight "shape"
// fingerprint (tcPr/pPr/rPr presence) for each row's fee cell, so
// formatting-consistency bugs (e.g. a force-rebuilt cell missing the
// standard properties) show up without opening the file in Word.
//
// This replaces the one-off PowerShell/Node scripts that were hand-written
// fresh every time a row-matching or duplicate-row bug needed diagnosing.
//
// Usage:
//   npm run inspect-docx -- <path-to.docx> [--language bilingual|english-only]
//
// If --language is omitted, it's guessed from the filename (a name
// containing "_EN" but not "CNEN" is treated as english-only; anything
// else is treated as bilingual).

import JSZip from 'jszip'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DOMParser } = require('@xmldom/xmldom')
import { readFileSync } from 'fs'
import {
  directChildren, allDescendants, paraText, cellText, findRowId, getDefinitionSet,
} from '../lib/docGenerator'

export type LanguageMode = 'bilingual' | 'english-only'

export interface RowReport {
  tableIndex: number
  tableName: 'main' | 'opt' | 'ep' | 'other'
  rowIndex: number
  textPreview: string
  rid: string | null
  svcKey: string | null
  flags: string[] // 'UNMATCHED' | 'DUPLICATE:<svcKey>'
  feeCellShape: { hasTcPr: boolean; hasPPr: boolean; hasRPr: boolean } | null
}

export interface DocReport {
  languageMode: LanguageMode
  companyNameFound: boolean
  dateFound: boolean
  tables: { tableIndex: number; tableName: string; rowCount: number; rows: RowReport[] }[]
}

const TABLE_ROLES = ['main', 'opt', 'ep'] as const
type TableRole = (typeof TABLE_ROLES)[number] | 'other'

// Rows that are structural (header/total) rather than a specific service —
// never flagged as UNMATCHED even though they have no rid.
function isStructuralRow(text: string): boolean {
  return text.includes('Service Scope') || text.includes('Total') || /^No\.?/.test(text.trim())
}

// Identify a table's role (main/opt/ep/other) by CONTENT, not position.
// docGenerator.ts itself only ever addresses tables[0]/[1]/[2] by fixed
// position — but that's safe there because it reads those positions off the
// PRISTINE template before any table is ever deleted. A GENERATED document,
// by contrast, can have had an entire table removed (e.g. the main table
// when nothing in it was selected), which shifts every later table's index
// down. Re-deriving role from position on a generated file would silently
// mislabel tables — exactly the "structural assumption instead of content
// check" failure mode this tool exists to catch, so it must not make that
// assumption itself. Instead: try matching every row against each of
// main/opt/ep's ROW_DEFS scope and assign whichever scope gets the most
// hits (a table with zero hits in any scope — e.g. the company-changes
// table, which isn't covered by ROW_DEFS at all — is 'other').
function identifyTableRole(
  tbl: Element,
  rows: Element[][],
  languageMode: LanguageMode,
): TableRole {
  // main/opt/ep tables all have the same 3-column shape (No. / Service Scope
  // / Fee). The company-changes table (processChangesTable) is a genuinely
  // different 5-column shape (No. / Service / Description / Qty / Price) —
  // a real, structural difference, not a heuristic guess. Checking column
  // count first avoids misclassifying it on a single coincidental substring
  // match (e.g. a heading row that happens to contain "Corporate Secretarial
  // Services", which is also a main-table ROW_DEFS match string).
  if (rows.length === 0) return 'other'
  const colCounts = new Map<number, number>()
  for (const cells of rows) colCounts.set(cells.length, (colCounts.get(cells.length) ?? 0) + 1)
  const modalColCount = [...colCounts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  if (modalColCount !== 3) return 'other'

  const scores: Record<(typeof TABLE_ROLES)[number], number> = { main: 0, opt: 0, ep: 0 }
  for (const cells of rows) {
    for (const role of TABLE_ROLES) {
      if (findRowId(cells, role, languageMode) !== null) scores[role]++
    }
  }
  let best: TableRole = 'other'
  let bestScore = 0
  for (const role of TABLE_ROLES) {
    if (scores[role] > bestScore) { best = role; bestScore = scores[role] }
  }
  return best
}

export async function loadXmlDocFromBuffer(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf)
  const docEntry = zip.file('word/document.xml')
  if (!docEntry) throw new Error('Invalid DOCX: word/document.xml not found')
  const xmlStr = await docEntry.async('string')
  return new DOMParser().parseFromString(xmlStr, 'application/xml')
}

export function analyzeDocumentXml(xmlDoc: any, languageMode: LanguageMode): DocReport {
  const body = xmlDoc.getElementsByTagName('w:body')[0]
  const paras = directChildren(body, 'p')
  const dateFound = paras.length > 0 && /Date:\s*\S/.test(paraText(paras[0]))
  const companyNameFound = paras.slice(0, 5).some((p: Element) => {
    const t = paraText(p)
    const idx = t.indexOf('Company Name')
    if (idx === -1) return false
    return /:\s*\S/.test(t.slice(idx))
  })

  const { rowIdToSvc, rowDefs } = getDefinitionSet(languageMode)

  // Some services legitimately span more than one physical row by design
  // (e.g. ND -> MAIN_ND + MAIN_ND_DEPOSIT: the nominee-director row plus its
  // "Additional Deposit" sub-row). Compute, per table, how many distinct
  // row-IDs map to each service key, so we only flag a real duplicate —
  // an occurrence count beyond what the row-def design itself expects —
  // rather than crying wolf on intentional multi-row services.
  const expectedCountByTableAndSvc = new Map<string, number>()
  for (const [id, def] of Object.entries(rowDefs)) {
    const svc = rowIdToSvc[id]
    if (!svc) continue
    const k = `${def.table}:${svc}`
    expectedCountByTableAndSvc.set(k, (expectedCountByTableAndSvc.get(k) ?? 0) + 1)
  }

  const tables = directChildren(body, 'tbl')
  const tableReports = tables.map((tbl: Element, tableIndex: number) => {
    const trRows = directChildren(tbl, 'tr')
    const rowCells = trRows.map((row) => directChildren(row, 'tc')).filter((c) => c.length > 0)
    const tableName = identifyTableRole(tbl, rowCells, languageMode)
    const seenSvcKeyCounts = new Map<string, number>()
    const rows = trRows
      .map((row: Element, rowIndex: number): RowReport | null => {
        const cells = directChildren(row, 'tc')
        if (cells.length === 0) return null
        const text = cells.map(cellText).join(' | ')
        const rid = tableName === 'other' ? null : findRowId(cells, tableName, languageMode)
        const svcKey = rid ? rowIdToSvc[rid] ?? null : null
        const flags: string[] = []
        // Table 3+ ("other") isn't covered by the ROW_DEFS matching system at
        // all (processChangesTable works on fixed row indices, not rid
        // lookups) — every row there would trivially show UNMATCHED, which
        // isn't meaningful signal, so skip the flag there.
        if (rid === null && tableName !== 'other' && !isStructuralRow(text)) flags.push('UNMATCHED')
        if (svcKey) {
          const seenCount = (seenSvcKeyCounts.get(svcKey) ?? 0) + 1
          seenSvcKeyCounts.set(svcKey, seenCount)
          const expected = expectedCountByTableAndSvc.get(`${tableName}:${svcKey}`) ?? 1
          if (seenCount > expected) flags.push(`DUPLICATE:${svcKey}`)
        }
        const feeCell = cells[cells.length - 1]
        const hasTcPr = directChildren(feeCell, 'tcPr').length > 0
        const firstP = directChildren(feeCell, 'p')[0]
        const hasPPr = firstP ? directChildren(firstP, 'pPr').length > 0 : false
        const firstR = firstP ? directChildren(firstP, 'r')[0] : undefined
        const hasRPr = firstR ? directChildren(firstR, 'rPr').length > 0 : false
        return {
          tableIndex, tableName, rowIndex,
          textPreview: text.slice(0, 120),
          rid, svcKey, flags,
          feeCellShape: { hasTcPr, hasPPr, hasRPr },
        }
      })
      .filter((r: RowReport | null): r is RowReport => r !== null)
    return { tableIndex, tableName, rowCount: rows.length, rows }
  })

  return { languageMode, companyNameFound, dateFound, tables: tableReports }
}

export function printReport(report: DocReport, label: string): number {
  console.log(`\n=== DOCX Inspection: ${label} (${report.languageMode}) ===`)
  console.log(`Header: Date found=${report.dateFound ? 'YES' : 'NO'}  CompanyName found=${report.companyNameFound ? 'YES' : 'NO'}`)
  let issues = 0
  for (const t of report.tables) {
    console.log(`\n--- Table ${t.tableIndex} (${t.tableName}) — ${t.rowCount} rows ---`)
    for (const r of t.rows) {
      const shape = r.feeCellShape
        ? `${r.feeCellShape.hasTcPr ? 'Y' : 'N'}/${r.feeCellShape.hasPPr ? 'Y' : 'N'}/${r.feeCellShape.hasRPr ? 'Y' : 'N'}`
        : '-'
      const flagStr = r.flags.join(',')
      if (r.flags.length) issues++
      console.log(
        ` ${String(r.rowIndex).padStart(2)} | ${(r.rid ?? 'null').padEnd(16)} | ${(r.svcKey ?? '-').padEnd(12)} | ${flagStr.padEnd(20)} | tcPr/pPr/rPr=${shape.padEnd(6)} | ${r.textPreview}`,
      )
    }
  }
  console.log(`\n=== Summary: ${issues} flagged row(s) ===`)
  return issues
}

async function main() {
  const args = process.argv.slice(2)
  const path = args[0]
  if (!path) {
    console.error('Usage: inspect-docx <path.docx> [--language bilingual|english-only]')
    process.exit(2)
  }
  const langIdx = args.indexOf('--language')
  const langMode = (langIdx !== -1 ? args[langIdx + 1] : undefined) as LanguageMode | undefined
  const guessed: LanguageMode = path.includes('_EN') && !path.includes('CNEN') ? 'english-only' : 'bilingual'
  const languageMode = langMode ?? guessed

  const xmlDoc = await loadXmlDocFromBuffer(readFileSync(path))
  const report = analyzeDocumentXml(xmlDoc, languageMode)
  const issues = printReport(report, path)
  process.exit(issues > 0 ? 1 : 0)
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1) })
}
