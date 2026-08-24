import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { readFileSync } from 'fs'
import { resolve } from 'path'

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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { tableIndex, rowIndex, property, value, cellIndex, download } = body

    const templatePath = resolve(process.cwd(), 'template/Tassure_Proposal_EN.docx')
    const buffer = readFileSync(templatePath)

    const zip = await JSZip.loadAsync(buffer)
    const xml = await zip.file('word/document.xml')?.async('string')

    if (!xml) {
      return NextResponse.json(
        { error: 'No document.xml found' },
        { status: 400 }
      )
    }

    const parser = new DOMParser()
    const doc = parser.parseFromString(xml, 'application/xml')
    const serializer = new XMLSerializer()

    // If download flag is set, just return the file without modifications
    if (download) {
      const newBuffer = await zip.generateAsync({ type: 'arraybuffer' })
      return new NextResponse(newBuffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': 'attachment; filename="Tassure_Proposal_EN_modified.docx"',
        },
      })
    }

    const tables = doc.getElementsByTagName('w:tbl')
    const targetTable = tables[tableIndex]

    if (!targetTable) {
      return NextResponse.json(
        { error: `Table ${tableIndex} not found` },
        { status: 400 }
      )
    }

    const rows = targetTable.getElementsByTagName('w:tr')
    const targetRow = rows[rowIndex]

    if (!targetRow) {
      return NextResponse.json(
        { error: `Row ${rowIndex} not found` },
        { status: 400 }
      )
    }

    // Apply changes
    if (property === 'rowHeight') {
      let trPr = directChildren(targetRow, 'trPr')[0]
      if (!trPr) {
        trPr = doc.createElement('w:trPr')
        targetRow.insertBefore(trPr, targetRow.firstChild)
      }

      let trHeight = directChildren(trPr, 'trHeight')[0]
      if (!trHeight) {
        trHeight = doc.createElement('w:trHeight')
        trPr.appendChild(trHeight)
      }

      trHeight.setAttribute('w:val', value.toString())
      trHeight.setAttribute('w:type', 'dxa')
    } else if (property === 'vMerge' || property === 'vAlign') {
      const cells = targetRow.getElementsByTagName('w:tc')
      const targetCell = cells[cellIndex]

      if (!targetCell) {
        return NextResponse.json(
          { error: `Cell ${cellIndex} not found` },
          { status: 400 }
        )
      }

      let tcPr = directChildren(targetCell, 'tcPr')[0]
      if (!tcPr) {
        tcPr = doc.createElement('w:tcPr')
        targetCell.insertBefore(tcPr, targetCell.firstChild)
      }

      if (property === 'vMerge') {
        const existing = directChildren(tcPr, 'vMerge')
        for (const el of existing) {
          el.parentNode?.removeChild(el)
        }

        if (value && value !== 'none') {
          const vMerge = doc.createElement('w:vMerge')
          if (value !== 'continue') {
            vMerge.setAttribute('w:val', value)
          }
          tcPr.appendChild(vMerge)
        }
      } else if (property === 'vAlign') {
        const existing = directChildren(tcPr, 'vAlign')
        for (const el of existing) {
          el.parentNode?.removeChild(el)
        }

        if (value && value !== 'none') {
          const vAlign = doc.createElement('w:vAlign')
          vAlign.setAttribute('w:val', value)
          tcPr.appendChild(vAlign)
        }
      }
    }

    const newXml = serializer.serializeToString(doc)
    zip.file('word/document.xml', newXml)

    const newBuffer = await zip.generateAsync({ type: 'arraybuffer' })

    return new NextResponse(newBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': 'attachment; filename="Tassure_Proposal_EN_modified.docx"',
      },
    })
  } catch (error: any) {
    console.error('Error updating document:', error)
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }
}
