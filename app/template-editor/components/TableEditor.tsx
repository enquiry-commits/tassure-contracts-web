'use client'

import { useState } from 'react'
import styles from './TableEditor.module.css'

interface Cell {
  text: string
  vMerge: string
  vAlign: string
  width: string
}

interface Row {
  index: number
  height: string
  cells: Cell[]
}

interface Table {
  index: number
  rows: Row[]
}

interface Props {
  table: Table
  onUpdate: (tableIndex: number, rowIndex: number, property: string, value: any, cellIndex?: number) => void
}

export function TableEditor({ table, onUpdate }: Props) {
  const [selectedCell, setSelectedCell] = useState<{ row: number; col: number } | null>(null)

  const activeRow = selectedCell ? table.rows[selectedCell.row] : null
  const activeCell = activeRow && selectedCell ? activeRow.cells[selectedCell.col] : null

  return (
    <div className={styles.container}>
      <div className={styles.preview}>
        <h3>Table {table.index + 1}</h3>
        <div className={styles.tableWrapper}>
          <table className={styles.docxTable}>
            <tbody>
              {table.rows.map((row) => (
                <tr key={row.index} style={{ height: row.height !== '(auto)' ? `${parseInt(row.height) / 20}pt` : 'auto' }}>
                  {row.cells.map((cell, cellIdx) => (
                    <td
                      key={cellIdx}
                      onClick={() => setSelectedCell({ row: row.index, col: cellIdx })}
                      className={selectedCell?.row === row.index && selectedCell?.col === cellIdx ? styles.selected : ''}
                      style={{
                        verticalAlign: cell.vAlign !== 'none' ? cell.vAlign : 'top',
                        width: cell.width !== 'auto' ? `${parseInt(cell.width) / 20}pt` : 'auto',
                      }}
                    >
                      <div className={styles.cellContent}>
                        {cell.text || <em>(empty)</em>}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedCell && activeRow && activeCell && (
        <div className={styles.inspector}>
          <h4>
            Row {selectedCell.row + 1}, Cell {selectedCell.col + 1}
          </h4>

          <div className={styles.section}>
            <h5>Row Properties</h5>
            <div className={styles.property}>
              <label>Height (twips)</label>
              <input
                type="text"
                value={activeRow.height}
                onChange={(e) =>
                  onUpdate(table.index, selectedCell.row, 'rowHeight', e.target.value)
                }
                placeholder="e.g., 560"
              />
              <small>
                {activeRow.height !== '(auto)'
                  ? `${parseInt(activeRow.height) / 20}pt`
                  : 'auto'}
              </small>
            </div>
          </div>

          <div className={styles.section}>
            <h5>Cell Properties</h5>

            <div className={styles.property}>
              <label>Vertical Merge (vMerge)</label>
              <select
                value={activeCell.vMerge}
                onChange={(e) =>
                  onUpdate(
                    table.index,
                    selectedCell.row,
                    'vMerge',
                    e.target.value,
                    selectedCell.col
                  )
                }
              >
                <option value="none">None</option>
                <option value="restart">Start merge</option>
                <option value="continue">Continue merge</option>
              </select>
            </div>

            <div className={styles.property}>
              <label>Vertical Alignment (vAlign)</label>
              <select
                value={activeCell.vAlign}
                onChange={(e) =>
                  onUpdate(
                    table.index,
                    selectedCell.row,
                    'vAlign',
                    e.target.value,
                    selectedCell.col
                  )
                }
              >
                <option value="none">None (default)</option>
                <option value="top">Top</option>
                <option value="center">Center</option>
                <option value="bottom">Bottom</option>
              </select>
            </div>

            <div className={styles.property}>
              <label>Width</label>
              <input
                type="text"
                value={activeCell.width}
                readOnly
                placeholder="(auto)"
              />
            </div>

            <div className={styles.property}>
              <label>Text Preview</label>
              <div className={styles.textPreview}>{activeCell.text || '(empty)'}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
