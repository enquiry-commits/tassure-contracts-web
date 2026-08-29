// scripts/validate-templates.ts
//
// Template contract validator. Cross-checks lib/services.ts's ROW_DEFS /
// ROW_DEFS_EN against the REAL rows present in template/Tassure_Proposal_CNEN.docx
// and template/Tassure_Proposal_EN.docx.
//
// Two classes of problem this catches automatically (that previously were
// only found by a human eyeballing a generated proposal):
//
//   1. A ROW_DEFS entry whose `match` string doesn't actually match any row
//      in its template (0 matches -> ERROR: probably a typo, or the template
//      was edited and the code wasn't updated), or matches more than one row
//      (>1 matches -> WARNING: ambiguous, the wrong row could be picked).
//
//   2. An "orphan row" — a real row in the template with no ROW_DEFS entry
//      at all. Any such row falls into rowLinked()'s "unknown row, always
//      keep" branch in docGenerator.ts, regardless of what the user selects.
//      This is exactly the bug class that caused the bilingual XBRL/AUDIT/AIS
//      rows to show as phantom/duplicate rows before ROW_DEFS entries were
//      added for them.
//
// Usage: npm run validate-templates

import { readFileSync } from 'fs'
import { join } from 'path'
import { directChildren, cellText, findRowId } from '../lib/docGenerator'
import { loadXmlDocFromBuffer } from './inspect-docx'
import { ROW_DEFS, ROW_DEFS_EN } from '../lib/services'

type RowDefs = typeof ROW_DEFS

interface Target {
  file: string
  languageMode: 'bilingual' | 'english-only'
  rowDefs: RowDefs
}

const TARGETS: Target[] = [
  { file: 'Tassure_Proposal_CNEN.docx', languageMode: 'bilingual', rowDefs: ROW_DEFS },
  { file: 'Tassure_Proposal_EN.docx', languageMode: 'english-only', rowDefs: ROW_DEFS_EN },
]

const TABLE_INDEX: Record<string, number> = { main: 0, opt: 1, ep: 2 }

// Row IDs that are, by design, NEVER present as a static row in either
// template — they exist purely so docGenerator.ts's "dynamic row" mechanism
// (DYNAMIC_ROW_RIDS in processMainTable) has a rid to build/insert against.
// A 0-match result for these is expected and NOT an error. If this ever
// starts matching a real row, that's not wrong either — it just means the
// template gained a static row for something that used to be purely
// synthetic — so it's exempted from the "must match" rule entirely, not
// flagged either way.
const DYNAMIC_ONLY_RIDS = new Set(['MAIN_GOODWILL'])

function isStructuralRow(text: string): boolean {
  return text.includes('Service Scope') || text.includes('Total') || /^No\.?/.test(text.trim())
}

async function validateOne(target: Target): Promise<{ errors: number; warnings: number }> {
  const buf = readFileSync(join(process.cwd(), 'template', target.file))
  const xmlDoc = await loadXmlDocFromBuffer(buf)
  const body = xmlDoc.getElementsByTagName('w:body')[0]
  const tables = directChildren(body, 'tbl')

  let errors = 0
  let warnings = 0

  // 1. Every ROW_DEFS entry must resolve to exactly one row in its table
  //    (except DYNAMIC_ONLY_RIDS, which are expected to never match).
  for (const [id, def] of Object.entries(target.rowDefs)) {
    if (DYNAMIC_ONLY_RIDS.has(id)) continue
    const tbl = tables[TABLE_INDEX[def.table]]
    if (!tbl) {
      console.error(`[ERROR] ${target.file}: table '${def.table}' not found (for ${id})`)
      errors++
      continue
    }
    const matches = directChildren(tbl, 'tr').filter((row) =>
      directChildren(row, 'tc').map(cellText).join(' ').includes(def.match),
    )
    if (matches.length === 0) {
      console.error(`[ERROR] ${target.file}: ROW_DEFS.${id} (match='${def.match}') matches 0 rows`)
      errors++
    } else if (matches.length > 1) {
      console.warn(`[WARN]  ${target.file}: ROW_DEFS.${id} (match='${def.match}') matches ${matches.length} rows — ambiguous`)
      warnings++
    }
  }

  // 2. Orphan rows: real template rows with no ROW_DEFS entry at all.
  for (const [tableName, idx] of Object.entries(TABLE_INDEX)) {
    const tbl = tables[idx]
    if (!tbl) continue
    directChildren(tbl, 'tr').forEach((row, i) => {
      const cells = directChildren(row, 'tc')
      if (cells.length === 0) return
      const text = cells.map(cellText).join(' ')
      if (isStructuralRow(text)) return
      const rid = findRowId(cells, tableName, target.languageMode)
      if (rid === null) {
        console.error(`[ERROR] ${target.file}: orphan row (no ROW_DEFS match) in table '${tableName}' row ${i}: "${text.slice(0, 100)}"`)
        errors++
      }
    })
  }

  return { errors, warnings }
}

async function main() {
  let totalErrors = 0
  let totalWarnings = 0
  for (const target of TARGETS) {
    const { errors, warnings } = await validateOne(target)
    console.log(`${target.file}: ${errors} error(s), ${warnings} warning(s)`)
    totalErrors += errors
    totalWarnings += warnings
  }
  console.log(`\n=== Total: ${totalErrors} error(s), ${totalWarnings} warning(s) ===`)
  process.exit(totalErrors > 0 ? 1 : 0)
}

if (require.main === module) {
  main().catch((err) => { console.error(err); process.exit(1) })
}
