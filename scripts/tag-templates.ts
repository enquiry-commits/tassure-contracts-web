// Adds invisible Word bookmarks to every mutable table and service row.
// This is an idempotent migration tool: running it twice does not duplicate markers.

import JSZip from 'jszip'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom')
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { CC_ITEMS } from '../lib/company-changes'
import { directChildren, findRowId } from '../lib/docGenerator'
import { bookmarkNames, rowMarkerName, tableMarkerName, TemplateTableRole } from '../lib/template-contract'

interface Target {
  file: string
  languageMode: 'bilingual' | 'english-only'
}

const TARGETS: Target[] = [
  { file: 'Tassure_Proposal_CNEN.docx', languageMode: 'bilingual' },
  { file: 'Tassure_Proposal_EN.docx', languageMode: 'english-only' },
]

const TABLE_ROLES: TemplateTableRole[] = ['main', 'opt', 'ep', 'changes']

function nextBookmarkId(xmlDoc: Document): number {
  let max = 0
  const nodes = xmlDoc.getElementsByTagName('w:bookmarkStart')
  for (let i = 0; i < nodes.length; i++) {
    const id = Number(nodes[i].getAttribute('w:id') || nodes[i].getAttribute('id'))
    if (Number.isFinite(id)) max = Math.max(max, id)
  }
  return max + 1
}

function addBookmark(target: Element, marker: string, xmlDoc: Document, id: number): boolean {
  if (bookmarkNames(target).includes(marker)) return false
  const paragraph = target.localName === 'p' ? target : directChildren(target, 'p')[0]
    ?? target.getElementsByTagName('w:p')[0]
  if (!paragraph) throw new Error(`Cannot add marker ${marker}: no paragraph found`)

  const start = xmlDoc.createElement('w:bookmarkStart')
  start.setAttribute('w:id', String(id))
  start.setAttribute('w:name', marker)
  const end = xmlDoc.createElement('w:bookmarkEnd')
  end.setAttribute('w:id', String(id))
  paragraph.insertBefore(start, paragraph.firstChild)
  paragraph.appendChild(end)
  return true
}

async function tagOne(target: Target): Promise<number> {
  const path = join(process.cwd(), 'template', target.file)
  const zip = await JSZip.loadAsync(readFileSync(path))
  const entry = zip.file('word/document.xml')
  if (!entry) throw new Error(`${target.file}: word/document.xml missing`)
  const xmlDoc: Document = new DOMParser().parseFromString(await entry.async('string'), 'application/xml')
  const body = xmlDoc.getElementsByTagName('w:body')[0]
  const tables = directChildren(body, 'tbl')
  if (tables.length < 4) throw new Error(`${target.file}: expected at least 4 tables, found ${tables.length}`)

  let id = nextBookmarkId(xmlDoc)
  let added = 0
  for (let tableIndex = 0; tableIndex < TABLE_ROLES.length; tableIndex++) {
    const table = tables[tableIndex]
    if (addBookmark(table, tableMarkerName(TABLE_ROLES[tableIndex]), xmlDoc, id++)) added++

    const rows = directChildren(table, 'tr')
    if (tableIndex < 3) {
      const role = TABLE_ROLES[tableIndex]
      for (const row of rows) {
        const cells = directChildren(row, 'tc')
        if (cells.length === 0) continue
        const rowId = findRowId(cells, role, target.languageMode)
        if (rowId && addBookmark(row, rowMarkerName(rowId), xmlDoc, id++)) added++
      }
    } else {
      for (const item of CC_ITEMS) {
        const row = rows[item.row]
        if (!row) throw new Error(`${target.file}: missing Company Changes row ${item.row} (${item.key})`)
        if (directChildren(row, 'tc').length !== 5) {
          throw new Error(`${target.file}: Company Changes ${item.key} does not have 5 cells`)
        }
        if (addBookmark(row, rowMarkerName(item.key), xmlDoc, id++)) added++
      }
    }
  }

  if (added > 0 || process.argv.includes('--rewrite')) {
    zip.file('word/document.xml', new XMLSerializer().serializeToString(xmlDoc))
    writeFileSync(path, await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    }))
  }
  console.log(`${target.file}: ${added} marker(s) added`)
  return added
}

async function main() {
  for (const target of TARGETS) await tagOne(target)
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exit(1) })
}
