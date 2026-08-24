import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'

function directChildren(el: any, localName: string): any[] {
  const result: any[] = []
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i]
    if (n.nodeType === 1 && n.localName === localName) {
      result.push(n)
    }
  }
  return result
}

function getCellText(cell: any): string {
  const ts = cell.getElementsByTagName('w:t')
  return Array.from(ts)
    .map((t: any) => t.textContent)
    .join('')
}

function parseTable(table: any, tableIndex: number) {
  const rows = directChildren(table, 'tr')
  const parsedRows = rows.map((row: any, rowIdx: number) => {
    const cells = directChildren(row, 'tc')

    // Get row properties
    const trPr = directChildren(row, 'trPr')[0]
    let rowHeight = '(auto)'
    if (trPr) {
      const trHeight = directChildren(trPr, 'trHeight')[0]
      if (trHeight) {
        rowHeight = trHeight.getAttribute('w:val')
      }
    }

    const parsedCells = cells.map((cell: any, cellIdx: number) => {
      const tcPr = directChildren(cell, 'tcPr')[0]
      let vMerge = 'none'
      let vAlign = 'none'
      let width = 'auto'

      if (tcPr) {
        const vm = directChildren(tcPr, 'vMerge')[0]
        if (vm) {
          vMerge = vm.getAttribute('w:val') || 'continue'
        }

        const va = directChildren(tcPr, 'vAlign')[0]
        if (va) {
          vAlign = va.getAttribute('w:val')
        }

        const tcW = directChildren(tcPr, 'tcW')[0]
        if (tcW) {
          width = tcW.getAttribute('w:w')
        }
      }

      return {
        text: getCellText(cell),
        vMerge,
        vAlign,
        width,
      }
    })

    return {
      index: rowIdx,
      height: rowHeight,
      cells: parsedCells,
    }
  })

  return {
    index: tableIndex,
    rows: parsedRows,
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const buffer = await file.arrayBuffer()
    const zip = await JSZip.loadAsync(buffer)
    const xml = await zip.file('word/document.xml')?.async('string')

    if (!xml) {
      return NextResponse.json({ error: 'No document.xml found' }, { status: 400 })
    }

    const parser = new DOMParser()
    const doc = parser.parseFromString(xml, 'application/xml')

    const tables = doc.getElementsByTagName('w:tbl')
    const parsedTables = Array.from(tables).map((tbl: any, idx: number) =>
      parseTable(tbl, idx)
    )

    return NextResponse.json({
      success: true,
      tables: parsedTables,
      totalTables: tables.length,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }
}
