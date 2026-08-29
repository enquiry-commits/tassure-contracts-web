export type TemplateTableRole = 'main' | 'opt' | 'ep' | 'changes'

const TABLE_MARKER_PREFIX = 'TASSURE_TABLE_'
const ROW_MARKER_PREFIX = 'TASSURE_ROW_'

export function tableMarkerName(role: TemplateTableRole): string {
  return `${TABLE_MARKER_PREFIX}${role.toUpperCase()}`
}

export function rowMarkerName(rowId: string): string {
  return `${ROW_MARKER_PREFIX}${rowId}`
}

function descendants(el: Element, localName: string): Element[] {
  const result: Element[] = []
  const walk = (node: Element) => {
    for (let i = 0; i < node.childNodes.length; i++) {
      const child = node.childNodes[i]
      if (child.nodeType !== 1) continue
      const element = child as Element
      if (element.localName === localName || element.localName === `w:${localName}` || element.nodeName === `w:${localName}`) {
        result.push(element)
      }
      walk(element)
    }
  }
  walk(el)
  return result
}

function bookmarkName(bookmark: Element): string {
  return bookmark.getAttribute('w:name') || bookmark.getAttribute('name') || ''
}

export function bookmarkNames(el: Element): string[] {
  return descendants(el, 'bookmarkStart').map(bookmarkName).filter(Boolean)
}

export function findMarkedRowId(row: Element): string | null {
  const marker = bookmarkNames(row).find((name) => name.startsWith(ROW_MARKER_PREFIX))
  return marker ? marker.slice(ROW_MARKER_PREFIX.length) : null
}

function stableBookmarkId(marker: string): string {
  let hash = 2166136261
  for (let i = 0; i < marker.length; i++) {
    hash ^= marker.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return String((hash >>> 0) + 100000)
}

export function setMarkedRowId(row: Element, rowId: string, xmlDoc: Document): void {
  const starts = descendants(row, 'bookmarkStart')
    .filter((bookmark) => bookmarkName(bookmark).startsWith(ROW_MARKER_PREFIX))
  const markerIds = new Set(starts.map((bookmark) => bookmark.getAttribute('w:id') || bookmark.getAttribute('id')))
  for (const start of starts) start.parentNode?.removeChild(start)
  for (const end of descendants(row, 'bookmarkEnd')) {
    const id = end.getAttribute('w:id') || end.getAttribute('id')
    if (markerIds.has(id)) end.parentNode?.removeChild(end)
  }

  const firstCell = descendants(row, 'tc')[0]
  const paragraph = firstCell ? descendants(firstCell, 'p')[0] : null
  if (!paragraph) throw new Error(`Cannot mark row ${rowId}: no paragraph found`)
  const marker = rowMarkerName(rowId)
  const bookmarkId = stableBookmarkId(marker)
  const start = xmlDoc.createElement('w:bookmarkStart')
  start.setAttribute('w:id', bookmarkId)
  start.setAttribute('w:name', marker)
  const end = xmlDoc.createElement('w:bookmarkEnd')
  end.setAttribute('w:id', bookmarkId)
  paragraph.insertBefore(start, paragraph.firstChild)
  paragraph.appendChild(end)
}

export function findMarkedTable(body: Element, role: TemplateTableRole): Element | null {
  const expectedMarker = tableMarkerName(role)
  for (const table of descendants(body, 'tbl')) {
    if (bookmarkNames(table).includes(expectedMarker)) return table
  }
  return null
}

export function hasMarker(el: Element, marker: string): boolean {
  return bookmarkNames(el).includes(marker)
}
