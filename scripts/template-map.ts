import JSZip from 'jszip'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DOMParser } = require('@xmldom/xmldom')
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { cellText, directChildren, getDefinitionSet } from '../lib/docGenerator'
import { CC_ITEMS } from '../lib/company-changes'
import { findMarkedRowId, findMarkedTable, type TemplateTableRole } from '../lib/template-contract'

type LanguageMode = 'bilingual' | 'english-only'

interface RowMap {
  rowIndex: number
  rowId: string | null
  serviceKey: string | null
  cells: string[]
  status: 'mapped' | 'structural' | 'unmapped'
}

interface TableMap {
  role: TemplateTableRole
  found: boolean
  rows: RowMap[]
}

interface TemplateMap {
  file: string
  languageMode: LanguageMode
  tables: TableMap[]
  errors: string[]
}

const TARGETS: { file: string; languageMode: LanguageMode }[] = [
  { file: 'Tassure_Proposal_CNEN.docx', languageMode: 'bilingual' },
  { file: 'Tassure_Proposal_EN.docx', languageMode: 'english-only' },
]

const ROLES: TemplateTableRole[] = ['main', 'opt', 'ep', 'changes']
const CC_BY_KEY = new Map(CC_ITEMS.map((item) => [item.key, item]))

function structural(cells: string[], role: TemplateTableRole, rowIndex: number): boolean {
  const text = cells.join(' ')
  if (role === 'changes') return rowIndex <= 1
  return text.includes('Service Scope') || text.includes('Total')
}

async function analyze(file: string, languageMode: LanguageMode): Promise<TemplateMap> {
  const zip = await JSZip.loadAsync(readFileSync(join(process.cwd(), 'template', file)))
  const entry = zip.file('word/document.xml')
  if (!entry) throw new Error(`${file}: word/document.xml missing`)
  const xmlDoc = new DOMParser().parseFromString(await entry.async('string'), 'application/xml')
  const body = xmlDoc.getElementsByTagName('w:body')[0]
  const { rowIdToSvc } = getDefinitionSet(languageMode)
  const errors: string[] = []

  const tables = ROLES.map((role): TableMap => {
    const table = findMarkedTable(body, role)
    if (!table) {
      errors.push(`${role}: table marker missing`)
      return { role, found: false, rows: [] }
    }
    const rows = directChildren(table, 'tr').map((row, rowIndex): RowMap => {
      const cells = directChildren(row, 'tc').map((cell) => cellText(cell).trim())
      const rowId = findMarkedRowId(row)
      const serviceKey = rowId
        ? rowIdToSvc[rowId] ?? (CC_BY_KEY.has(rowId) ? rowId : null)
        : null
      const status = rowId ? 'mapped' : structural(cells, role, rowIndex) ? 'structural' : 'unmapped'
      if (status === 'unmapped') errors.push(`${role} row ${rowIndex}: mutable row has no stable marker`)
      return { rowIndex, rowId, serviceKey, cells, status }
    })
    return { role, found: true, rows }
  })

  return { file, languageMode, tables, errors }
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

function renderTemplate(template: TemplateMap): string {
  const mapped = template.tables.flatMap((table) => table.rows).filter((row) => row.status === 'mapped').length
  const unmapped = template.tables.flatMap((table) => table.rows).filter((row) => row.status === 'unmapped').length
  return `<section class="template">
    <header><div><h2>${esc(template.file)}</h2><p>${esc(template.languageMode)}</p></div>
      <span class="badge ${template.errors.length ? 'bad' : 'good'}">${template.errors.length ? `${template.errors.length} issue(s)` : 'PASS'}</span></header>
    <div class="summary"><span>${mapped} mapped rows</span><span>${unmapped} unmapped rows</span><span>${template.tables.length} tables</span></div>
    ${template.tables.map((table) => `<article>
      <h3>${esc(table.role.toUpperCase())} <small>${table.found ? `${table.rows.length} rows` : 'MISSING'}</small></h3>
      <div class="table-wrap"><table><thead><tr><th>#</th><th>Status</th><th>Stable Row ID</th><th>Service</th><th>Template content</th></tr></thead><tbody>
      ${table.rows.map((row) => `<tr class="${row.status}"><td>${row.rowIndex}</td><td>${row.status}</td><td><code>${esc(row.rowId ?? '—')}</code></td><td><code>${esc(row.serviceKey ?? '—')}</code></td><td>${row.cells.map(esc).join(' <b>│</b> ')}</td></tr>`).join('')}
      </tbody></table></div></article>`).join('')}
  </section>`
}

function renderHtml(maps: TemplateMap[]): string {
  const totalErrors = maps.reduce((sum, template) => sum + template.errors.length, 0)
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Tassure Proposal Template Map</title><style>
  :root{font-family:Inter,Segoe UI,Arial,sans-serif;color:#172033;background:#f3f6fa}body{margin:0;padding:32px}.page{max-width:1500px;margin:auto}h1{margin:0 0 8px}.lead{color:#5e6b80;margin:0 0 24px}.overall{display:inline-block;padding:8px 14px;border-radius:999px;font-weight:700;margin-bottom:24px}.good{background:#dcfce7;color:#166534}.bad{background:#fee2e2;color:#991b1b}.template{background:white;border:1px solid #dce3ec;border-radius:16px;padding:24px;margin-bottom:28px;box-shadow:0 8px 24px #1f29370d}.template>header{display:flex;justify-content:space-between;align-items:start}.template h2{margin:0}.template header p{margin:4px 0 0;color:#64748b}.badge{padding:6px 10px;border-radius:999px;font-weight:700}.summary{display:flex;gap:12px;margin:18px 0}.summary span{background:#eef2f7;padding:8px 10px;border-radius:8px}article{margin-top:26px}h3{margin-bottom:8px}h3 small{color:#64748b;font-weight:400}.table-wrap{overflow:auto;border:1px solid #dce3ec;border-radius:10px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:9px 10px;border-bottom:1px solid #e8edf3;text-align:left;vertical-align:top}th{background:#f8fafc;position:sticky;top:0}.mapped td:nth-child(2){color:#15803d;font-weight:700}.structural{color:#64748b;background:#fafafa}.unmapped{background:#fff1f2}.unmapped td:nth-child(2){color:#be123c;font-weight:700}code{white-space:nowrap}b{color:#cbd5e1}
  </style></head><body><main class="page"><h1>Tassure Proposal Template Map</h1><p class="lead">Stable mapping from Word template rows to proposal service keys. Generated by <code>npm run template-map</code>.</p>
  <div class="overall ${totalErrors ? 'bad' : 'good'}">${totalErrors ? `${totalErrors} contract issue(s)` : 'All template contracts passed'}</div>
  ${maps.map(renderTemplate).join('')}</main></body></html>`
}

async function main() {
  const maps = await Promise.all(TARGETS.map((target) => analyze(target.file, target.languageMode)))
  const outputDir = join(process.cwd(), 'artifacts', 'template-map')
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(join(outputDir, 'template-map.json'), JSON.stringify(maps, null, 2))
  writeFileSync(join(outputDir, 'template-map.html'), renderHtml(maps))
  const errors = maps.flatMap((template) => template.errors.map((error) => `${template.file}: ${error}`))
  console.log(`Template map: ${join(outputDir, 'template-map.html')}`)
  console.log(`Contract issues: ${errors.length}`)
  for (const error of errors) console.error(` - ${error}`)
  process.exit(errors.length ? 1 : 0)
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exit(1) })
}
