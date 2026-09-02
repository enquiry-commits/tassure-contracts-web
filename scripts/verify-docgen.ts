// scripts/verify-docgen.ts
//
// Generation regression harness — the real safety net. Calls the actual
// generateDocx() (the exact function the production API route uses) across
// a matrix of scenarios (bilingual x english-only, crossed with selection
// sets that deliberately cover every "dynamic row" service) and asserts,
// using the same row-analysis logic as scripts/inspect-docx.ts:
//
//   - no service produces 2+ rows in the same table
//   - every selected "dynamic" service produces exactly 1 row
//   - every unselected "dynamic" service produces 0 rows (no phantom rows)
//   - Company Name and Date are always present in the header
//   - every fee cell has the same tcPr/pPr/rPr "shape" as the majority
//     (structural formatting-consistency check — catches ND_DEPOSIT2-style
//     force-rebuilt cells that are missing standard properties)
//
// Run this before trusting any lib/docGenerator.ts / lib/services.ts change
// — it replaces "push, wait for Vercel, ask the user to eyeball a generated
// file" with something that fails loudly, locally, in seconds.
//
// Usage: npm run verify-docgen

import { generateDocx, DocInput } from '../lib/docGenerator'
import { SERVICES } from '../lib/services'
import { loadXmlDocFromBuffer, analyzeDocumentXml, DocReport, LanguageMode } from './inspect-docx'
import { buildProposalPlan, ProposalPlan } from '../lib/proposal-plan'

// Services that have a "dynamic row" implementation somewhere in
// docGenerator.ts (force-removed-then-conditionally-reinserted) — these are
// exactly the services at risk of the duplicate/phantom-row bug class.
const DYNAMIC_KEYS = ['CERT', 'DP_MAIN', 'LOC_MAIN', 'GOODWILL_DISC', 'DP_RENEW', 'XBRL', 'AUDIT', 'AIS', 'ND_DEPOSIT2']

// Anchors: a harmless, always-selected main-table + opt-table service, on
// top of the app's own defaults. Two independent reasons these matter:
//  1. GOODWILL_DISC is a discount row that (by design) only ever renders
//     alongside real main-table purchases — a scenario selecting NOTHING
//     else in the main table isn't a real proposal shape, it's this
//     harness inventing a case the app was never meant to handle.
//  2. MAIN_ND/OPT_ND and MAIN_ND_DEPOSIT/OPT_ND_DEPOSIT intentionally share
//     ROW_DEFS match text ("Local Nominee Director Service" / "Additional
//     Deposit") since they're the same service offered in two different
//     tables (year-1 vs annual-maintenance) — so a table containing ONLY
//     ND-family rows is structurally ambiguous between 'main' and 'opt' by
//     content alone. Keeping at least one non-ND anchor selected in each
//     table means every table this harness generates always has enough
//     distinguishing content to identify unambiguously — the same
//     column-count/content signal a human (or docGenerator.ts itself,
//     which never needs to guess because it reads tables[0]/[1]/[2] off
//     the pristine template) relies on.
const ANCHOR_KEYS = ['INCORP', 'ACCOUNTS'] // one main-table, one opt-table service
const BASELINE = [...ANCHOR_KEYS]

interface Scenario {
  name: string
  selected: string[]
  companyName?: string
  goodwillDiscount?: number
}

function scenario(name: string, extra: string[]): Scenario {
  const sel = new Set([...BASELINE, ...extra])
  if (sel.has('ND_DEPOSIT2')) sel.add('ND2') // the frontend always pairs these; mirror it here
  return { name, selected: [...sel] }
}

const SCENARIOS: Scenario[] = [
  scenario('minimal', []),
  { ...scenario('empty-company-name', []), companyName: '' },
  { ...scenario('goodwill-discount-positive', ['GOODWILL_DISC']), goodwillDiscount: 100 },
  scenario('all-services', SERVICES.map((service) => service.key)),
  ...SERVICES.map((service) => scenario(`with-${service.key}`, [service.key])),
]

async function runScenario(languageMode: LanguageMode, sc: Scenario): Promise<string[]> {
  // Match the quote builder's conditional special-field payload exactly.
  // The reported production failure was ND selected with a zero deposit.
  const feeOverrides: Record<string, number> = {}
  if (sc.goodwillDiscount !== undefined) feeOverrides.GOODWILL_DISC = sc.goodwillDiscount
  if (sc.selected.includes('ND')) feeOverrides.ND_DEPOSIT = 0
  if (sc.selected.includes('ND_DEPOSIT2')) feeOverrides.ND_DEPOSIT2 = 3000
  const input: DocInput = {
    companyName: sc.companyName ?? 'Verify Test Pte Ltd',
    date: '01 January 2026',
    salutationEn: 'Dear Management,',
    salutationCn: '尊敬的领导，',
    mode: 'selected',
    selected: sc.selected,
    feeOverrides,
    ccOverrides: {},
    focServices: [],
    languageMode,
  }
  const plan = buildProposalPlan(input)
  const buf = await generateDocx(input)
  const xmlDoc = await loadXmlDocFromBuffer(buf)
  const report = analyzeDocumentXml(xmlDoc, languageMode)
  return assertScenario(report, sc, languageMode, plan)
}

function assertScenario(report: DocReport, sc: Scenario, languageMode: string, plan: ProposalPlan): string[] {
  const failures: string[] = []
  const selSet = new Set(sc.selected)

  // No duplicate service rows in any table.
  for (const t of report.tables) {
    for (const r of t.rows) {
      const dup = r.flags.find((f) => f.startsWith('DUPLICATE:'))
      if (dup) failures.push(`[${languageMode}/${sc.name}] Table ${t.tableIndex}: ${dup} at row ${r.rowIndex} ("${r.textPreview}")`)
    }
  }

  // Dynamic services: exactly 1 row if selected, 0 if not.
  for (const key of DYNAMIC_KEYS) {
    const count = report.tables.flatMap((t) => t.rows).filter((r) => r.svcKey === key).length
    const expected = selSet.has(key) ? 1 : 0
    if (count !== expected) {
      failures.push(`[${languageMode}/${sc.name}] service ${key}: expected ${expected} row(s), found ${count}`)
    }
  }

  // Every mapped row follows the selection plan exactly. This covers all
  // services, not only rows that happen to be implemented dynamically.
  const allRows = report.tables.flatMap((table) => table.rows)
  for (const impact of plan.impacts) {
    for (const rowId of impact.rowIds) {
      const count = allRows.filter((row) => row.rid === rowId).length
      const expected = impact.selected ? 1 : 0
      if (count !== expected) {
        failures.push(`[${languageMode}/${sc.name}] ${impact.serviceKey}/${rowId}: expected ${expected}, found ${count}`)
      }
    }
  }

  // ND's deposit is a sub-row, not a service. Verify the exact zero-value
  // payload that previously failed reaches the generated DOCX unchanged.
  if (selSet.has('ND')) {
    const depositRow = allRows.find((row) => row.rid === 'MAIN_ND_DEPOSIT')
    if (!depositRow?.textPreview.includes('0.00')) {
      failures.push(`[${languageMode}/${sc.name}] MAIN_ND_DEPOSIT: expected rendered fee 0.00`)
    }
  }

  // The quote builder omits a zero-value goodwill override. Selection alone
  // must still produce exactly one discount row without rendering "-0.00".
  if (selSet.has('GOODWILL_DISC')) {
    const goodwillRow = allRows.find((row) => row.rid === 'MAIN_GOODWILL')
    const expectedAmount = sc.goodwillDiscount ?? 0
    if (expectedAmount > 0 && !goodwillRow?.textPreview.includes(`-${expectedAmount.toFixed(2)}`)) {
      failures.push(`[${languageMode}/${sc.name}] MAIN_GOODWILL: expected rendered discount -${expectedAmount.toFixed(2)}`)
    }
    if (expectedAmount === 0 && (!goodwillRow?.textPreview.includes('0.00') || goodwillRow.textPreview.includes('-0.00'))) {
      failures.push(`[${languageMode}/${sc.name}] MAIN_GOODWILL: expected rendered zero discount 0.00`)
    }
  }

  // Every row's text should have balanced parentheses. Content built as
  // separate English/Chinese runs (common in dynamically-created rows) can
  // end up with a parenthesis living only in the Chinese-only run -- fine
  // in bilingual mode where both runs render, but if the Chinese run is
  // dropped entirely for english-only mode (or, before this check existed,
  // stripped in a way that left a stray fragment behind) the English side
  // is left with an unmatched "(" and no ")". Caught exactly this on
  // DP_RENEW's fee cell: "(Government fee included" with no close.
  // Skipped once textPreview hits inspect-docx's 120-char truncation --
  // legitimately long rows (e.g. the company-changes table's free-form
  // fee descriptions) can have their closing ")" cut off by the preview
  // itself, which isn't a real content bug.
  for (const t of report.tables) {
    for (const r of t.rows) {
      if (r.textPreview.length >= 120) continue
      const opens = (r.textPreview.match(/\(/g) ?? []).length
      const closes = (r.textPreview.match(/\)/g) ?? []).length
      if (opens !== closes) {
        failures.push(`[${languageMode}/${sc.name}] Table ${t.tableIndex} row ${r.rowIndex}: unbalanced parentheses (${opens} "(" vs ${closes} ")") in "${r.textPreview}"`)
      }
    }
  }

  // Header always populated.
  if (!report.companyNameFound) failures.push(`[${languageMode}/${sc.name}] Company Name label missing from header`)
  if (sc.companyName === '' && report.companyNameHasValue) {
    failures.push(`[${languageMode}/${sc.name}] Company Name should remain blank`)
  }
  if (sc.companyName !== '' && !report.companyNameHasValue) {
    failures.push(`[${languageMode}/${sc.name}] Company Name value missing from header`)
  }
  if (!report.dateFound) failures.push(`[${languageMode}/${sc.name}] Date missing/empty in header`)

  // Fee-cell shape consistency vs. the majority ("reference") shape.
  const allShapes = report.tables
    .flatMap((t) => t.rows)
    .map((r) => r.feeCellShape)
    .filter((s): s is NonNullable<typeof s> => s !== null)
  const shapeKey = (s: NonNullable<typeof allShapes[number]>) => `${s.hasTcPr}/${s.hasPPr}/${s.hasRPr}`
  const counts = new Map<string, number>()
  for (const s of allShapes) counts.set(shapeKey(s), (counts.get(shapeKey(s)) ?? 0) + 1)
  const modal = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  for (const t of report.tables) {
    for (const r of t.rows) {
      if (r.feeCellShape && modal && shapeKey(r.feeCellShape) !== modal) {
        failures.push(`[${languageMode}/${sc.name}] Table ${t.tableIndex} row ${r.rowIndex}: fee-cell shape ${shapeKey(r.feeCellShape)} != reference ${modal} ("${r.textPreview}")`)
      }
    }
  }

  return failures
}

async function main() {
  const allFailures: string[] = []
  for (const languageMode of ['bilingual', 'english-only'] as const) {
    for (const sc of SCENARIOS) {
      const failures = await runScenario(languageMode, sc)
      console.log(`${languageMode} / ${sc.name}: ${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}`)
      allFailures.push(...failures)
    }
  }
  if (allFailures.length) {
    console.log('\n=== FAILURES ===')
    allFailures.forEach((f) => console.log(' - ' + f))
  }
  console.log(`\n=== ${allFailures.length === 0 ? 'ALL SCENARIOS PASSED' : `${allFailures.length} FAILURE(S)`} ===`)
  process.exit(allFailures.length > 0 ? 1 : 0)
}

main().catch((err) => { console.error(err); process.exit(1) })
