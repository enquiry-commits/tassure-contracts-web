'use client'

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'

interface Contract {
  id: string
  reference_id: string
  client_name: string
  pic: string
  remarks: string | null
  file_url: string
  is_delivered: boolean
  is_signed: boolean | null
  created_at: string
}

interface PIC {
  id: string
  name: string
}

type StatusFilter = 'all' | 'pending' | 'delivered' | 'signed'

const SG_TZ = 'Asia/Singapore'

function toSgDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-SG', {
    timeZone: SG_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  })
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-SG', {
    timeZone: SG_TZ, hour: '2-digit', minute: '2-digit',
  })
}

// ── Status Checkbox ───────────────────────────────────────────────────────────

function StatusCheckbox({ contractId, field, value, onChange }: {
  contractId: string
  field: 'delivery' | 'signature'
  value: boolean
  onChange?: (newValue: boolean) => void
}) {
  const [state, setState] = useState(value)
  const [loading, setLoading] = useState(false)

  async function handleChange(checked: boolean) {
    setLoading(true)
    try {
      const res = await fetch(`/api/contracts/${contractId}/${field}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(field === 'delivery' ? { is_delivered: checked } : { is_signed: checked }),
      })
      if (res.ok) {
        setState(checked)
        onChange?.(checked)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <input
      type="checkbox"
      checked={state}
      disabled={loading}
      onChange={e => handleChange(e.target.checked)}
      className="w-5 h-5 rounded accent-[#1A3F6F] cursor-pointer disabled:opacity-50"
    />
  )
}

// ── Inline Remarks Editor ─────────────────────────────────────────────────────

function RemarksCell({ contractId, initial }: { contractId: string; initial: string | null }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(initial ?? '')
  const [saved, setSaved] = useState(initial ?? '')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  async function save() {
    if (value === saved) { setEditing(false); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/contracts/${contractId}/remarks`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remarks: value || null }),
      })
      if (res.ok) { setSaved(value); setEditing(false) }
    } finally {
      setSaving(false)
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') save()
    if (e.key === 'Escape') { setValue(saved); setEditing(false) }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={handleKey}
        disabled={saving}
        placeholder="Add remark…"
        className="w-28 text-xs border border-[#1A3F6F] rounded px-2 py-1 outline-none bg-white text-[#1A1A2E]"
      />
    )
  }

  return (
    <button onClick={() => setEditing(true)} title="Click to edit"
      className="group flex items-center gap-1 text-left max-w-[120px]">
      {saved
        ? <span className="text-xs text-[#1A1A2E] truncate">{saved}</span>
        : <span className="text-xs text-[#B0BDD0] italic">Add note…</span>
      }
      <svg className="w-3 h-3 text-[#B0BDD0] group-hover:text-[#1A3F6F] shrink-0 transition-colors"
        fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
      </svg>
    </button>
  )
}

// ── Delete Confirm Modal ──────────────────────────────────────────────────────

function DeleteModal({ referenceId, onConfirm, onCancel, loading }: {
  referenceId: string
  onConfirm: () => void
  onCancel: () => void
  loading: boolean
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
      onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="bg-white rounded-xl shadow-2xl w-80 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </div>
          <div>
            <div className="text-sm font-bold text-[#1A1A2E]">Delete Record</div>
            <div className="text-xs text-[#6B7FA0] mt-0.5">This cannot be undone</div>
          </div>
        </div>
        <p className="text-sm text-[#1A1A2E] mb-5">
          Delete <span className="font-mono font-bold text-[#1A3F6F]">{referenceId}</span> and its .docx file from storage?
        </p>
        <div className="flex gap-2">
          <button onClick={onCancel} disabled={loading}
            className="flex-1 px-4 py-2 text-sm font-bold rounded-lg border border-[#C8D8EC] text-[#6B7FA0] hover:border-[#1A3F6F] transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="flex-1 px-4 py-2 text-sm font-bold rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors disabled:opacity-50">
            {loading ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Stats Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: {
  label: string; value: number; sub?: string; accent?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-[#C8D8EC] px-5 py-4 flex flex-col gap-1 shadow-sm">
      <span className="text-[10px] font-bold text-[#6B7FA0] tracking-widest uppercase">{label}</span>
      <span className="text-2xl font-bold" style={{ color: accent ?? '#1A3F6F' }}>{value}</span>
      {sub && <span className="text-xs text-[#6B7FA0]">{sub}</span>}
    </div>
  )
}

// ── Month Group Header ────────────────────────────────────────────────────────

function MonthGroupHeader({ monthKey, count, collapsed, onToggle }: {
  monthKey: string; count: number; collapsed: boolean; onToggle: () => void
}) {
  const [yyyy, mm] = monthKey.split('-')
  const d = new Date(parseInt(yyyy), parseInt(mm) - 1, 1)
  const monthYear = d.toLocaleDateString('en-SG', { month: 'long', year: 'numeric' })

  return (
    <tr>
      <td colSpan={9} className="px-0 py-0">
        <div className="flex items-center gap-3 px-5 py-3 cursor-pointer select-none"
          style={{ backgroundColor: '#1A3F6F' }} onClick={onToggle}>
          <svg className={`w-4 h-4 text-white transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
          <span className="text-white font-black text-base tracking-wide">{monthYear}</span>
          <span className="ml-auto text-xs font-bold px-2.5 py-0.5 rounded-full"
            style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.9)' }}>
            {count} proposal{count !== 1 ? 's' : ''}
          </span>
        </div>
      </td>
    </tr>
  )
}

// ── Date Group Header ─────────────────────────────────────────────────────────

function DateGroupHeader({ sgDate, count, collapsed, onToggle }: {
  sgDate: string; count: number; collapsed: boolean; onToggle: () => void
}) {
  const [dd, mm, yyyy] = sgDate.split('/')
  const d = new Date(`${yyyy}-${mm}-${dd}`)
  const weekday = d.toLocaleDateString('en-SG', { weekday: 'long' })
  const dayNum = d.toLocaleDateString('en-SG', { day: 'numeric' })

  return (
    <tr>
      <td colSpan={9} className="px-0 py-0">
        <div className="flex items-center gap-3 px-9 py-2 cursor-pointer select-none"
          style={{ backgroundColor: '#4B6278' }} onClick={onToggle}>
          <svg className={`w-3.5 h-3.5 text-white transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
          <svg className="w-3.5 h-3.5 text-white opacity-60 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span className="text-white opacity-70 text-xs font-medium">{weekday}</span>
          <span className="text-white font-black text-base leading-none">{dayNum}</span>
          <span className="ml-auto text-xs font-bold px-2.5 py-0.5 rounded-full"
            style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.9)' }}>
            {count} proposal{count !== 1 ? 's' : ''}
          </span>
        </div>
      </td>
    </tr>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ContractTable() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [pics, setPics] = useState<PIC[]>([])
  const [filterDate, setFilterDate] = useState('')
  const [filterPic, setFilterPic] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<Contract | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set())
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set())

  const fetchContracts = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filterDate) params.set('date', filterDate)
    if (filterPic) params.set('pic', filterPic)
    const res = await fetch(`/api/contracts?${params.toString()}`)
    const data = await res.json()
    setContracts(data.contracts || [])
    setLoading(false)
  }, [filterDate, filterPic])

  useEffect(() => {
    fetch('/api/pic').then(r => r.json())
      .then(d => setPics(Array.isArray(d?.pics) ? d.pics : []))
  }, [])

  useEffect(() => { fetchContracts() }, [fetchContracts])

  function toggleMonth(monthKey: string) {
    setCollapsedMonths(prev => {
      const next = new Set(prev)
      if (next.has(monthKey)) next.delete(monthKey); else next.add(monthKey)
      return next
    })
  }

  function toggleDate(sgDate: string) {
    setCollapsedDates(prev => {
      const next = new Set(prev)
      if (next.has(sgDate)) next.delete(sgDate); else next.add(sgDate)
      return next
    })
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleteLoading(true)
    try {
      const res = await fetch(`/api/contracts/${deleteTarget.id}`, { method: 'DELETE' })
      if (res.ok) {
        setContracts(prev => prev.filter(c => c.id !== deleteTarget.id))
        setDeleteTarget(null)
      }
    } finally {
      setDeleteLoading(false)
    }
  }

  // Filtered list
  const filtered = useMemo(() => contracts.filter(c => {
    if (search) {
      const q = search.toLowerCase()
      if (!c.client_name.toLowerCase().includes(q) && !c.reference_id.toLowerCase().includes(q)) return false
    }
    if (statusFilter === 'delivered') return c.is_delivered
    if (statusFilter === 'signed') return c.is_signed
    if (statusFilter === 'pending') return !c.is_delivered || !c.is_signed
    return true
  }), [contracts, search, statusFilter])

  // Group by month → date (3-level hierarchy)
  const monthGroups = useMemo(() => {
    const monthMap = new Map<string, Map<string, Contract[]>>()
    for (const c of filtered) {
      const sgDate = toSgDate(c.created_at) // dd/mm/yyyy
      const [dd, mm, yyyy] = sgDate.split('/')
      const monthKey = `${yyyy}-${mm}`
      if (!monthMap.has(monthKey)) monthMap.set(monthKey, new Map())
      const dateMap = monthMap.get(monthKey)!
      if (!dateMap.has(sgDate)) dateMap.set(sgDate, [])
      dateMap.get(sgDate)!.push(c)
    }
    return monthMap
  }, [filtered])

  const total = contracts.length
  const deliveredCount = contracts.filter(c => c.is_delivered).length
  const signedCount = contracts.filter(c => c.is_signed).length
  const pendingCount = contracts.filter(c => !c.is_delivered || !c.is_signed).length
  const pct = (n: number) => total === 0 ? '—' : `${Math.round(n / total * 100)}% of total`
  const hasFilters = filterDate || filterPic || search || statusFilter !== 'all'
  const clearFilters = () => { setFilterDate(''); setFilterPic(''); setSearch(''); setStatusFilter('all') }

  return (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total Proposals" value={total} />
        <StatCard label="Delivered" value={deliveredCount} sub={pct(deliveredCount)} accent="#4B6278" />
        <StatCard label="Signed" value={signedCount} sub={pct(signedCount)} accent="#1A3F6F" />
        <StatCard label="Pending" value={pendingCount} sub={pendingCount > 0 ? 'Need attention' : 'All done!'} accent="#8B1A2A" />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-[#C8D8EC] p-4 mb-4 shadow-sm">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#6B7FA0]"
              fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" placeholder="Search client / ref…" value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-7 pr-3 py-1.5 text-sm border border-[#C8D8EC] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#1A3F6F] w-44" />
          </div>
          <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)}
            className="border border-[#C8D8EC] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#1A3F6F]" />
          <select value={filterPic} onChange={e => setFilterPic(e.target.value)}
            className="border border-[#C8D8EC] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#1A3F6F] bg-white">
            <option value="">All PIC</option>
            {pics.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
          <div className="flex gap-1.5 flex-wrap">
            {(['all', 'delivered', 'signed', 'pending'] as StatusFilter[]).map(key => (
              <button key={key} onClick={() => setStatusFilter(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all capitalize ${
                  statusFilter === key
                    ? 'bg-[#1A3F6F] text-white border-[#1A3F6F]'
                    : 'bg-white text-[#6B7FA0] border-[#C8D8EC] hover:border-[#1A3F6F] hover:text-[#1A3F6F]'
                }`}>
                {key}
              </button>
            ))}
          </div>
          <div className="ml-auto flex gap-2">
            <button onClick={fetchContracts} title="Refresh"
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-[#C8D8EC] text-[#6B7FA0] hover:border-[#1A3F6F] hover:text-[#1A3F6F] transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            {hasFilters && (
              <button onClick={clearFilters}
                className="text-xs text-[#6B7FA0] hover:text-[#1A3F6F] px-3 py-1.5 rounded-lg border border-[#C8D8EC] hover:border-[#1A3F6F] transition-colors">
                Clear all
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#C8D8EC] overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ backgroundColor: '#EBF1F8' }}>
                {['Reference', 'Time', 'Client', 'PIC', 'Delivery', 'Signature', 'Remarks', 'File', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-[10px] font-bold text-[#4A6F9A] tracking-widest uppercase whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-[#6B7FA0] text-sm">
                    <div className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Loading…
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-[#6B7FA0] text-sm">
                    No contracts found
                    {hasFilters && <button onClick={clearFilters} className="ml-2 text-[#1A3F6F] underline text-xs">Clear filters</button>}
                  </td>
                </tr>
              ) : (
                Array.from(monthGroups.entries()).map(([monthKey, dateMap]) => {
                  const monthCount = Array.from(dateMap.values()).reduce((s, g) => s + g.length, 0)
                  const monthCollapsed = collapsedMonths.has(monthKey)
                  return (
                    <React.Fragment key={monthKey}>
                      <MonthGroupHeader
                        monthKey={monthKey}
                        count={monthCount}
                        collapsed={monthCollapsed}
                        onToggle={() => toggleMonth(monthKey)}
                      />
                      {!monthCollapsed && Array.from(dateMap.entries()).map(([sgDate, group]) => {
                        const dateCollapsed = collapsedDates.has(sgDate)
                        return (
                          <React.Fragment key={sgDate}>
                            <DateGroupHeader
                              sgDate={sgDate}
                              count={group.length}
                              collapsed={dateCollapsed}
                              onToggle={() => toggleDate(sgDate)}
                            />
                            {!dateCollapsed && group.map((c, rowIdx) => (
                              <tr
                                key={c.id}
                                className="border-t border-[#EBF1F8] hover:bg-[#F5F9FF] transition-colors"
                                style={{ backgroundColor: rowIdx % 2 === 0 ? '#FFFFFF' : '#FAFCFF' }}
                              >
                                <td className="px-4 py-3">
                                  <span className="font-mono text-xs font-bold text-[#1A3F6F] bg-[#EBF1F8] px-2 py-1 rounded">
                                    {c.reference_id}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-xs text-[#6B7FA0] whitespace-nowrap">
                                  {formatDateTime(c.created_at)}
                                </td>
                                <td className="px-4 py-3">
                                  <span className="text-sm font-bold text-[#1A1A2E]">{c.client_name}</span>
                                </td>
                                <td className="px-4 py-3">
                                  <span className="text-xs font-bold text-[#2A4F7F] bg-[#EBF1F8] px-2 py-0.5 rounded-full">{c.pic}</span>
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <StatusCheckbox
                                    contractId={c.id} field="delivery" value={c.is_delivered}
                                    onChange={v => setContracts(prev => prev.map(x => x.id === c.id ? { ...x, is_delivered: v } : x))}
                                  />
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <StatusCheckbox
                                    contractId={c.id} field="signature" value={c.is_signed ?? false}
                                    onChange={v => setContracts(prev => prev.map(x => x.id === c.id ? { ...x, is_signed: v } : x))}
                                  />
                                </td>
                                <td className="px-4 py-3">
                                  <RemarksCell contractId={c.id} initial={c.remarks} />
                                </td>
                                <td className="px-4 py-3">
                                  <a href={c.file_url} target="_blank" rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs font-bold text-[#1A3F6F] hover:text-[#2A6FC0] transition-colors">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                        d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                    </svg>
                                    .docx
                                  </a>
                                </td>
                                <td className="px-3 py-3">
                                  <div className="flex items-center gap-1">
                                    <a
                                      href={`/proposal/generator?company=${encodeURIComponent(c.client_name)}&pic=${encodeURIComponent(c.pic)}&replaceId=${c.id}&replaceRef=${encodeURIComponent(c.reference_id)}`}
                                      title="Regenerate — open Generate page pre-filled"
                                      className="w-7 h-7 flex items-center justify-center rounded-lg border border-[#C8D8EC] text-[#6B7FA0] hover:border-[#1A3F6F] hover:text-[#1A3F6F] hover:bg-[#EBF1F8] transition-colors"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                      </svg>
                                    </a>
                                    <button
                                      onClick={() => setDeleteTarget(c)}
                                      title="Delete record"
                                      className="w-7 h-7 flex items-center justify-center rounded-lg border border-[#C8D8EC] text-[#6B7FA0] hover:border-red-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                      </svg>
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </React.Fragment>
                        )
                      })}
                    </React.Fragment>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-[#EBF1F8] flex items-center justify-between">
          <span className="text-xs text-[#6B7FA0]">
            {filtered.length} record{filtered.length !== 1 ? 's' : ''}
            {hasFilters && filtered.length !== total && ` (filtered from ${total})`}
          </span>
        </div>
      </div>

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <DeleteModal
          referenceId={deleteTarget.reference_id}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          loading={deleteLoading}
        />
      )}
    </div>
  )
}
