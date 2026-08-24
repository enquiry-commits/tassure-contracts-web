'use client'

import { useState } from 'react'
import { TableEditor } from './components/TableEditor'
import styles from './page.module.css'

interface Table {
  index: number
  rows: any[]
}

export default function TemplateEditorPage() {
  const [tables, setTables] = useState<Table[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedTableIndex, setSelectedTableIndex] = useState(0)
  const [fileName, setFileName] = useState<string>('template.docx')

  const handleLoadTemplate = async () => {
    try {
      setLoading(true)
      setError(null)

      // Load from template file on server
      const response = await fetch('/api/template-editor/load-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        throw new Error(`Failed to load template: ${response.statusText}`)
      }

      const data = await response.json()
      setTables(data.tables)
      setFileName('Tassure_Proposal_EN.docx')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      setLoading(true)
      setError(null)

      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/template-editor/parse-docx', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error(`Failed to parse file: ${response.statusText}`)
      }

      const data = await response.json()
      setTables(data.tables)
      setFileName(file.name)
      setSelectedTableIndex(0)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleUpdate = async (
    tableIndex: number,
    rowIndex: number,
    property: string,
    value: any,
    cellIndex?: number
  ) => {
    try {
      // Optimistic update for UI
      setTables((prev) => {
        const newTables = [...prev]
        const row = newTables[tableIndex].rows[rowIndex]

        if (property === 'rowHeight') {
          row.height = value
        } else if (cellIndex !== undefined) {
          const cell = row.cells[cellIndex]
          if (property === 'vMerge') {
            cell.vMerge = value
          } else if (property === 'vAlign') {
            cell.vAlign = value
          }
        }

        return newTables
      })

      // Send update to server
      const response = await fetch('/api/template-editor/update-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableIndex,
          rowIndex,
          property,
          value,
          cellIndex,
        }),
      })

      if (!response.ok) {
        throw new Error(`Failed to update: ${response.statusText}`)
      }

      // Optionally auto-download or show success
      console.log('Update applied successfully')
    } catch (err: any) {
      setError(err.message)
      // Revert optimistic update on error
      handleLoadTemplate()
    }
  }

  const handleDownload = async () => {
    try {
      const response = await fetch('/api/template-editor/update-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ download: true }),
      })

      if (!response.ok) throw new Error('Download failed')

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'Tassure_Proposal_EN_modified.docx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      setError(err.message)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>📄 Template Editor</h1>
        <p>Click on cells to edit row height, vertical merge, and alignment</p>
      </div>

      <div className={styles.controls}>
        <button onClick={handleLoadTemplate} disabled={loading} className={styles.btn}>
          {loading ? 'Loading...' : 'Load Default Template'}
        </button>

        <label className={styles.uploadBtn}>
          Upload DOCX
          <input
            type="file"
            accept=".docx"
            onChange={handleFileUpload}
            disabled={loading}
            style={{ display: 'none' }}
          />
        </label>

        {tables.length > 0 && (
          <button onClick={handleDownload} className={`${styles.btn} ${styles.primary}`}>
            Download Modified
          </button>
        )}

        {fileName && <span className={styles.fileName}>📄 {fileName}</span>}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {tables.length > 0 && (
        <div className={styles.content}>
          <div className={styles.sidebar}>
            <h3>Tables ({tables.length})</h3>
            <div className={styles.tableList}>
              {tables.map((table, idx) => (
                <button
                  key={idx}
                  className={`${styles.tableItem} ${
                    selectedTableIndex === idx ? styles.active : ''
                  }`}
                  onClick={() => setSelectedTableIndex(idx)}
                >
                  Table {idx + 1}
                  <span className={styles.rowCount}>{table.rows.length} rows</span>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.main}>
            {tables[selectedTableIndex] && (
              <TableEditor
                table={tables[selectedTableIndex]}
                onUpdate={handleUpdate}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
