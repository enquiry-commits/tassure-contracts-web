'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { SERVICES, CATEGORIES, DEFAULT_MAPPING, ROW_DEFS, type Service } from '@/lib/services'
import { CC_ITEMS, type CcItem } from '@/lib/company-changes'
import { createSupabaseBrowserClient } from '@/lib/supabase'

// ── types ────────────────────────────────────────────────────────────────────

type FocMode = 'F.O.C.' | 'SGD'
type QuoteMode = 'On Quote' | 'SGD'
type Tab = 'qb' | 'cc' | 'st'

// ── helpers ──────────────────────────────────────────────────────────────────

function parseFee(s: string): number {
  const v = parseFloat(s.replace(/,/g, ''))
  return isNaN(v) || v < 0 ? 0 : v
}

function fmtAmt(n: number): string {
  if (n <= 0) return 'SGD —'
  const [int, dec] = n.toFixed(2).split('.')
  return 'SGD ' + int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + dec
}

function getEffectiveFee(
  svc: Service,
  feeValues: Record<string, string>,
  focModes: Record<string, FocMode>,
  quoteModes: Record<string, QuoteMode>,
): number {
  if (svc.fee_type === 'discount') return parseFee(feeValues[svc.key] ?? '0')
  if (focModes[svc.key] === 'F.O.C.') return 0
  if (svc.fee_type === 'foc' || svc.fee_type === 'bundled') {
    return focModes[svc.key] === 'SGD' ? parseFee(feeValues[svc.key] ?? '0') : 0
  }
  if (svc.fee_type === 'quote') {
    return quoteModes[svc.key] === 'SGD' ? parseFee(feeValues[svc.key] ?? '0') : 0
  }
  const raw = feeValues[svc.key]
  return raw !== undefined ? parseFee(raw) : (svc.fee ?? 0)
}

function initFeeValues(): Record<string, string> {
  const m: Record<string, string> = {}
  for (const svc of SERVICES) {
    if (svc.fee !== null && svc.fee_type !== 'foc' && svc.fee_type !== 'bundled' && svc.fee_type !== 'quote') {
      m[svc.key] = svc.fee.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    } else {
      m[svc.key] = '0.00'
    }
  }
  m['ND_DEPOSIT'] = '3,000.00'
  return m
}

// ── main page ─────────────────────────────────────────────────────────────────

function GeneratePageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const prefilledCompany = searchParams.get('company') ?? ''
  const prefilledPic = searchParams.get('pic') ?? ''
  const replaceId = searchParams.get('replaceId') ?? ''        // existing contract id to overwrite
  const replaceRef = searchParams.get('replaceRef') ?? ''      // display only

  // client info
  const [companyName, setCompanyName] = useState(prefilledCompany)
  const [proposalDate, setProposalDate] = useState(() => {
    return new Date().toLocaleDateString('en-SG', { day: '2-digit', month: 'long', year: 'numeric' }).replace(/^0/, '')
  })
  const [salEn, setSalEn] = useState('Dear Management,')
  const [salCn, setSalCn] = useState('尊敬的领导，')
  const [picList, setPicList] = useState<string[]>([])
  const [selectedPic, setSelectedPic] = useState('')

  // quote builder
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(SERVICES.filter(s => s.default).map(s => s.key))
  )
  const [feeValues, setFeeValues] = useState<Record<string, string>>(initFeeValues)
  const [focModes, setFocModes] = useState<Record<string, FocMode>>(() => {
    const m: Record<string, FocMode> = {}
    for (const svc of SERVICES) {
      if (svc.fee_type === 'foc' || svc.fee_type === 'bundled') m[svc.key] = 'F.O.C.'
      else if (svc.fee !== null && svc.fee_type !== 'quote' && svc.fee_type !== 'discount') m[svc.key] = 'SGD'
    }
    return m
  })
  const [quoteModes, setQuoteModes] = useState<Record<string, QuoteMode>>(() => {
    const m: Record<string, QuoteMode> = {}
    for (const svc of SERVICES) {
      if (svc.fee_type === 'quote') m[svc.key] = 'On Quote'
    }
    return m
  })

  // company changes
  const [ccFeeValues, setCcFeeValues] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {}
    for (const item of CC_ITEMS) {
      m[item.key] = item.is_foc
        ? '0.00'
        : item.default.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }
    return m
  })
  const [ccFocModes, setCcFocModes] = useState<Record<string, FocMode>>(() => {
    const m: Record<string, FocMode> = {}
    for (const item of CC_ITEMS) {
      if (item.is_foc) m[item.key] = 'F.O.C.'
    }
    return m
  })

  // settings
  const [sectionMapping, setSectionMapping] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(Object.entries(DEFAULT_MAPPING).map(([k, v]) => [k, [...v]]))
  )
  const [settingsSection, setSettingsSection] = useState<string | null>(SERVICES[0]?.key ?? null)
  const [settingsFilter, setSettingsFilter] = useState(false)

  // ui
  const [activeTab, setActiveTab] = useState<Tab>('qb')
  const [collapsedCats, setCollapsedCats] = useState<Record<string, boolean>>(() => {
    const m: Record<string, boolean> = {}
    for (const [k] of CATEGORIES) m[k] = k !== 'setup'
    return m
  })
  const [generating, setGenerating] = useState(false)
  const [showPopup, setShowPopup] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    createSupabaseBrowserClient().auth.getSession().then(({ data: { session } }) => {
      if (!session) router.replace('/login')
    })
  }, [router])

  useEffect(() => {
    fetch('/api/pic')
      .then(r => r.json())
      .then(data => {
        const arr: string[] = Array.isArray(data)
          ? data.map((p: unknown) => (typeof p === 'string' ? p : (p as { name: string }).name))
          : Array.isArray(data?.pics)
            ? data.pics.map((p: { name: string }) => p.name)
            : []
        setPicList(arr)
        // pre-fill from URL param if present, else default to first
        if (prefilledPic && arr.includes(prefilledPic)) setSelectedPic(prefilledPic)
      })
      .catch(() => {})
  }, [])

  // totals
  const { mainTotal, optTotal, epTotal, extraTotal, grand } = (() => {
    let mainRaw = 0, optTotal = 0, epTotal = 0, extraTotal = 0, goodwillDisc = 0
    for (const svc of SERVICES) {
      if (!selected.has(svc.key)) continue
      if (svc.fee_type === 'discount') {
        goodwillDisc = getEffectiveFee(svc, feeValues, focModes, quoteModes)
        continue
      }
      const fee = getEffectiveFee(svc, feeValues, focModes, quoteModes)
      if (fee <= 0) continue
      if (svc.table === 'main') mainRaw += fee
      else if (svc.table === 'optional') {
        optTotal += fee
        if (svc.cat === 'extra') extraTotal += fee
      }
      else if (svc.table === 'ep') epTotal += fee
    }
    if (selected.has('ND')) {
      const dep = parseFee(feeValues['ND_DEPOSIT'] ?? '0')
      if (dep > 0) mainRaw += dep
    }
    const mainTotal = Math.max(0, mainRaw - goodwillDisc)
    return { mainTotal, optTotal, epTotal, extraTotal, grand: mainTotal + optTotal }
  })()

  const toggleService = useCallback((key: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const selectAllInCat = useCallback((keys: string[], checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev)
      for (const k of keys) checked ? next.add(k) : next.delete(k)
      return next
    })
  }, [])

  const handleGenerate = async (mode: 'full' | 'selected') => {
    if (!companyName.trim()) { setError('Please enter a Company Name'); return }
    if (!selectedPic) { setError('Please select a PIC'); return }
    setGenerating(true)
    setError(null)

    const feeOverrides: Record<string, number> = {}
    for (const svc of SERVICES) {
      const k = svc.key
      if (svc.fee_type === 'discount') {
        const v = parseFee(feeValues[k] ?? '0')
        if (v > 0) feeOverrides[k] = v
        continue
      }
      if (svc.fee_type === 'foc' || svc.fee_type === 'bundled') {
        if (focModes[k] === 'SGD') {
          const v = parseFee(feeValues[k] ?? '0')
          if (v >= 0) feeOverrides[k] = v
        }
      } else if (svc.fee_type === 'quote') {
        if (quoteModes[k] === 'SGD') {
          const v = parseFee(feeValues[k] ?? '0')
          if (v >= 0) feeOverrides[k] = v
        }
      } else {
        const v = parseFee(feeValues[k] ?? String(svc.fee ?? 0))
        if (v >= 0) feeOverrides[k] = v
      }
    }
    if (selected.has('ND')) {
      const dep = parseFee(feeValues['ND_DEPOSIT'] ?? '0')
      if (dep >= 0) feeOverrides['ND_DEPOSIT'] = dep
    }

    const ccOverrides: Record<string, number> = {}
    for (const item of CC_ITEMS) {
      if (item.is_foc) {
        if (ccFocModes[item.key] === 'SGD') {
          const v = parseFee(ccFeeValues[item.key] ?? '0')
          if (v >= 0) ccOverrides[item.key] = v
        }
      } else {
        const v = parseFee(ccFeeValues[item.key] ?? String(item.default))
        if (v >= 0) ccOverrides[item.key] = v
      }
    }

    const focServices: string[] = []
    for (const svc of SERVICES) {
      if (svc.fee !== null && svc.fee_type !== 'foc' && svc.fee_type !== 'bundled' && svc.fee_type !== 'quote' && focModes[svc.key] === 'F.O.C.') {
        focServices.push(svc.key)
      }
    }

    try {
      const resp = await fetch('/api/contracts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: companyName.trim(),
          date: proposalDate,
          salutationEn: salEn,
          salutationCn: salCn,
          pic: selectedPic,
          mode,
          selected: [...selected],
          feeOverrides,
          ccOverrides,
          sectionMapping,
          focServices,
          ...(replaceId ? { existingId: replaceId } : {}),
        }),
      })
      const data = await resp.json()
      if (data.success) {
        const a = document.createElement('a')
        a.href = data.downloadUrl
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      } else {
        setError(data.error || 'Generation failed')
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ fontFamily: 'system-ui, sans-serif' }}>
      {/* ── Header ────────────────────────────────────────── */}
      <header className="h-16 flex items-center px-4 gap-3 shrink-0 border-b border-[#B0C8E0]"
        style={{ backgroundColor: '#C8E0F4' }}>
        {/* Logo */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/tassure-logo.png" alt="Tassure" className="h-10 w-auto" />
        <span className="text-sm text-[#1A3F6F] opacity-80">Proposal Generator</span>
        <div className="ml-auto flex gap-2 items-center">
          <a href="/proposal/admin"
            className="inline-flex items-center gap-2 text-sm font-bold text-white px-4 py-2 rounded-lg transition-colors hover:opacity-90"
            style={{ backgroundColor: '#1A3F6F' }}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
            </svg>
            Admin Dashboard
          </a>
        </div>
      </header>

      {/* Regenerate banner */}
      {prefilledCompany && (
        <div className="shrink-0 flex items-center gap-2 px-5 py-2 text-sm font-medium"
          style={{ backgroundColor: replaceId ? '#EDF7ED' : '#FFF8E6', borderBottom: `1px solid ${replaceId ? '#8BC48B' : '#F0D080'}`, color: replaceId ? '#1E5C1E' : '#7A5800' }}>
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {replaceId ? (
            <>
              Replacing <span className="font-mono font-bold mx-1 px-1.5 py-0.5 rounded" style={{ backgroundColor: '#C8E8C8' }}>{replaceRef}</span>
              for <strong className="mx-1">{prefilledCompany}</strong> — the same reference number will be kept, old file replaced.
            </>
          ) : (
            <>
              Pre-filled for <strong className="mx-1">{prefilledCompany}</strong> — a new reference number will be assigned.
            </>
          )}
          <a href="/proposal/admin" className="ml-auto underline font-bold text-xs">← Back to Admin</a>
        </div>
      )}

      {/* ── Main area ─────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left sidebar */}
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-gray-200 p-5"
          style={{ backgroundColor: '#EAEAEA' }}>
          <div className="text-[10px] font-bold text-gray-400 tracking-widest mb-4">CLIENT INFORMATION</div>

          {[
            { label: 'Company Name  企业名字', val: companyName, set: setCompanyName, ph: 'Enter company name' },
            { label: 'Proposal Date', val: proposalDate, set: setProposalDate, ph: '' },
            { label: 'Salutation (English)', val: salEn, set: setSalEn, ph: '' },
            { label: 'Salutation (Chinese)', val: salCn, set: setSalCn, ph: '' },
          ].map(({ label, val, set, ph }) => (
            <div key={label} className="mb-3">
              <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
              <input
                className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#1A3F6F]"
                value={val}
                onChange={e => set(e.target.value)}
                placeholder={ph}
              />
            </div>
          ))}

          <div className="border-t border-gray-300 my-4" />

          <div className="text-[10px] font-bold text-gray-400 tracking-widest mb-3">PERSON IN CHARGE</div>
          <select
            className={`w-full border rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#1A3F6F] ${
              !selectedPic ? 'border-gray-300 text-gray-400' : 'border-gray-300 text-gray-900'
            }`}
            value={selectedPic}
            onChange={e => setSelectedPic(e.target.value)}
          >
            <option value="" disabled hidden>Please select a PIC</option>
            {picList.length === 0
              ? <option value="" disabled>Loading…</option>
              : picList.map(p => <option key={p} value={p}>{p}</option>)
            }
          </select>
        </aside>

        {/* Right area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
          {/* Tab bar */}
          <div className="h-16 bg-white border-b border-[#C8D8EC] flex items-center px-4 gap-2 shrink-0">
            {(['qb', 'cc', 'st'] as Tab[]).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`px-5 py-2 rounded-lg text-sm font-bold transition-colors ${
                  activeTab === tab ? 'bg-[#1A3F6F] text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}>
                {tab === 'qb' ? 'Quote Builder' : tab === 'cc' ? 'Company Changes' : 'Settings'}
              </button>
            ))}
            <span className="ml-auto text-xs text-gray-400 hidden lg:block">
              {activeTab === 'qb' ? 'Select services and generate a proposal document' :
               activeTab === 'cc' ? 'Edit post-incorporation fee schedule (Table 3) — does not affect Grand Total' :
               'Configure which fee rows appear for each service'}
            </span>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'qb' && (
              <QuoteBuilderTab
                selected={selected}
                feeValues={feeValues}
                focModes={focModes}
                quoteModes={quoteModes}
                collapsedCats={collapsedCats}
                onToggleService={toggleService}
                onSelectAllCat={selectAllInCat}
                onToggleCat={cat => setCollapsedCats(p => ({ ...p, [cat]: !p[cat] }))}
                onFeeChange={(k, v) => setFeeValues(p => ({ ...p, [k]: v }))}
                onFocModeChange={(k, m) => setFocModes(p => ({ ...p, [k]: m }))}
                onQuoteModeChange={(k, m) => setQuoteModes(p => ({ ...p, [k]: m }))}
              />
            )}
            {activeTab === 'cc' && (
              <CompanyChangesTab
                ccFeeValues={ccFeeValues}
                ccFocModes={ccFocModes}
                onCcFeeChange={(k, v) => setCcFeeValues(p => ({ ...p, [k]: v }))}
                onCcFocModeChange={(k, m) => setCcFocModes(p => ({ ...p, [k]: m }))}
              />
            )}
            {activeTab === 'st' && (
              <SettingsTab
                sectionMapping={sectionMapping}
                currentSection={settingsSection}
                selected={selected}
                filterSelected={settingsFilter}
                onFilterChange={setSettingsFilter}
                onSectionSelect={setSettingsSection}
                onMappingChange={(section, rowId, checked) => {
                  setSectionMapping(prev => {
                    const linked = [...(prev[section] ?? [])]
                    if (checked && !linked.includes(rowId)) linked.push(rowId)
                    else if (!checked) linked.splice(linked.indexOf(rowId), 1)
                    return { ...prev, [section]: linked }
                  })
                }}
                onReset={() => setSectionMapping(
                  Object.fromEntries(Object.entries(DEFAULT_MAPPING).map(([k, v]) => [k, [...v]]))
                )}
              />
            )}
          </div>
        </div>
      </div>

      {/* ── Footer ────────────────────────────────────────── */}
      <footer className="shrink-0 bg-white border-t border-[#C8D8EC]"
        style={{ minHeight: '112px' }}>
        <div className="flex items-center h-full px-5 gap-6 py-3">
          {/* Totals */}
          <div className="flex items-center gap-0">
            {[
              { label: 'Year 1', val: mainTotal },
              { label: 'Annual Maintenance', val: optTotal },
              { label: 'EP / Work Pass', val: epTotal },
            ].map(({ label, val }, i) => (
              <div key={label} className="flex items-center">
                {i > 0 && <div className="w-px bg-gray-200 mx-4 self-stretch" />}
                <div>
                  <div className="text-xs text-gray-500 mb-1">{label}</div>
                  <div className="text-base font-bold text-[#2A4F7F]">{fmtAmt(val)}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex-1" />

          {error && <span className="text-sm text-red-500">{error}</span>}

          {/* Grand Total */}
          <div
            className="rounded-xl px-5 py-3 cursor-pointer select-none"
            style={{ backgroundColor: '#8B1A2A' }}
            onClick={() => setShowPopup(true)}
          >
            <div className="flex items-center gap-3 mb-1">
              <span className="text-xs text-red-300">Grand Total —</span>
              <span className="text-xs text-white border border-white rounded-full px-2 py-0.5">
                READ MORE ›
              </span>
            </div>
            <div className="text-lg font-bold text-white">{fmtAmt(grand)}</div>
          </div>

          {/* Generate buttons */}
          <div className="flex flex-col gap-1.5">
            <button
              onClick={() => handleGenerate('full')}
              disabled={generating}
              className="bg-[#0A2D5A] hover:bg-[#1A4A7F] disabled:opacity-50 text-white text-sm font-bold px-5 py-2.5 rounded-lg transition-colors"
            >
              {generating ? 'Generating…' : 'Generate / Full Details  →'}
            </button>
            <button
              onClick={() => handleGenerate('selected')}
              disabled={generating}
              className="bg-[#2D5A0A] hover:bg-[#3F7F1A] disabled:opacity-50 text-white text-sm font-bold px-5 py-2.5 rounded-lg transition-colors"
            >
              Generate / Selected Only  →
            </button>
          </div>
        </div>
      </footer>

      {/* Popup */}
      {showPopup && (
        <SelectedServicesPopup
          services={SERVICES
            .filter(s => selected.has(s.key) && (s.cat === 'table1' || s.cat === 'extra'))
            .sort((a, b) => (a.fee_type === 'discount' ? 1 : 0) - (b.fee_type === 'discount' ? 1 : 0))}
          feeValues={feeValues}
          focModes={focModes}
          quoteModes={quoteModes}
          onClose={() => setShowPopup(false)}
        />
      )}
    </div>
  )
}

export default function GeneratePage() {
  return (
    <Suspense>
      <GeneratePageContent />
    </Suspense>
  )
}

// ── Category icons (white SVG paths) ─────────────────────────────────────────

const CAT_ICONS: Record<string, React.ReactNode> = {
  table1: (
    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 21V8l9-6 9 6v13M9 21v-6h6v6" />
    </svg>
  ),
  table2: (
    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  table3: (
    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 4H7a2 2 0 01-2-2V6a2 2 0 012-2h5l2 2h3a2 2 0 012 2v12a2 2 0 01-2 2z" />
    </svg>
  ),
  extra: (
    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  ),
}

// ── Quote Builder Tab ─────────────────────────────────────────────────────────

interface QBProps {
  selected: Set<string>
  feeValues: Record<string, string>
  focModes: Record<string, FocMode>
  quoteModes: Record<string, QuoteMode>
  collapsedCats: Record<string, boolean>
  onToggleService: (key: string) => void
  onSelectAllCat: (keys: string[], checked: boolean) => void
  onToggleCat: (cat: string) => void
  onFeeChange: (key: string, val: string) => void
  onFocModeChange: (key: string, mode: FocMode) => void
  onQuoteModeChange: (key: string, mode: QuoteMode) => void
}

function QuoteBuilderTab({
  selected, feeValues, focModes, quoteModes, collapsedCats,
  onToggleService, onSelectAllCat, onToggleCat,
  onFeeChange, onFocModeChange, onQuoteModeChange,
}: QBProps) {
  const groups: Record<string, Service[]> = {}
  for (const svc of SERVICES) {
    groups[svc.cat] = groups[svc.cat] ?? []
    groups[svc.cat].push(svc)
  }
  // Explicitly build table2 in template order; SECRETARIAL2/ADDRESS2 are the Table-2-only versions
  const svcByKey = Object.fromEntries(SERVICES.map(s => [s.key, s]))
  groups['table2'] = ['ACCOUNTS', 'SECRETARIAL2', 'ADDRESS2', 'AR', 'UNAUDITEDFS', 'COMPANYTAX', 'PERSONALTAX', 'PAYROLL']
    .map(k => svcByKey[k]).filter(Boolean)

  return (
    <div className="p-4">
      <div className="text-[10px] font-bold text-gray-400 tracking-widest mb-3 px-2">SELECT SERVICES</div>
      {CATEGORIES.map(([catKey, catLabel]) => {
        const catSvcs = groups[catKey] ?? []
        if (catSvcs.length === 0) return null
        const allChecked = catSvcs.every(s => selected.has(s.key))
        const collapsed = collapsedCats[catKey]
        return (
          <div key={catKey} className="mb-3 rounded-xl overflow-hidden border border-[#C8D8EC] bg-white shadow-sm">
            {/* Header */}
            <div
              className="flex items-center h-11 cursor-pointer select-none"
              style={{ backgroundColor: '#1A3F6F' }}
              onClick={() => onToggleCat(catKey)}
            >
              <span className="text-white text-xs w-8 text-center ml-1">{collapsed ? '▶' : '▼'}</span>
              <span className="text-white mr-2">{CAT_ICONS[catKey]}</span>
              <span className="text-white text-sm font-bold flex-1">{catLabel}</span>
              <div className="mr-4" onClick={e => e.stopPropagation()}>
                <label className="flex items-center gap-2 cursor-pointer">
                  <span className="text-[11px] font-bold text-[#A8C8E8]">Select All</span>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={e => onSelectAllCat(catSvcs.map(s => s.key), e.target.checked)}
                    className="w-4 h-4 accent-[#5BA3D9]"
                  />
                </label>
              </div>
            </div>

            {/* Body */}
            {!collapsed && (() => {
              const regularSvcs = catSvcs.filter(s => s.fee_type !== 'discount')
              const discountSvcs = catSvcs.filter(s => s.fee_type === 'discount')
              return (
                <div>
                  {/* Column subheader */}
                  <div className="flex items-center h-6 bg-[#EBF1F8]">
                    <span className="text-[9px] font-bold text-[#4A6F9A] ml-12">Service</span>
                    <span className="text-[9px] font-bold text-[#4A6F9A] ml-auto mr-4">Fee</span>
                  </div>
                  {regularSvcs.map((svc, i) => (
                    <div key={svc.key}>
                      <ServiceRow
                        svc={svc}
                        checked={selected.has(svc.key)}
                        feeValue={feeValues[svc.key] ?? '0.00'}
                        ndDepositValue={feeValues['ND_DEPOSIT'] ?? '3,000.00'}
                        focMode={focModes[svc.key]}
                        quoteMode={quoteModes[svc.key]}
                        onToggle={() => onToggleService(svc.key)}
                        onFeeChange={v => onFeeChange(svc.key, v)}
                        onNdDepositChange={v => onFeeChange('ND_DEPOSIT', v)}
                        onFocModeChange={m => onFocModeChange(svc.key, m)}
                        onQuoteModeChange={m => onQuoteModeChange(svc.key, m)}
                        rowBg={i % 2 === 0 ? '#FFFFFF' : '#F5F9FF'}
                        showNdDeposit={svc.key === 'ND' && selected.has('ND')}
                      />
                      {i < regularSvcs.length - 1 && (
                        <div className="h-px bg-[#E0EAF5] mx-4" />
                      )}
                    </div>
                  ))}
                  {/* Discount sub-card */}
                  {discountSvcs.length > 0 && (
                    <div className="mx-3 my-3 rounded-lg overflow-hidden border-2 border-[#E8A0A8]">
                      <div className="flex items-center h-7 px-3" style={{ backgroundColor: '#8B1A2A' }}>
                        <span className="text-[10px] font-bold text-[#FFCDD5] tracking-widest">DISCOUNT  折扣</span>
                      </div>
                      {discountSvcs.map(svc => (
                        <ServiceRow
                          key={svc.key}
                          svc={svc}
                          checked={selected.has(svc.key)}
                          feeValue={feeValues[svc.key] ?? '0.00'}
                          ndDepositValue={feeValues['ND_DEPOSIT'] ?? '3,000.00'}
                          focMode={focModes[svc.key]}
                          quoteMode={quoteModes[svc.key]}
                          onToggle={() => onToggleService(svc.key)}
                          onFeeChange={v => onFeeChange(svc.key, v)}
                          onNdDepositChange={v => onFeeChange('ND_DEPOSIT', v)}
                          onFocModeChange={m => onFocModeChange(svc.key, m)}
                          onQuoteModeChange={m => onQuoteModeChange(svc.key, m)}
                          rowBg='#FFF5F6'
                          showNdDeposit={false}
                        />
                      ))}
                    </div>
                  )}
                  <div className="h-1.5" />
                </div>
              )
            })()}
          </div>
        )
      })}
    </div>
  )
}

// ── Service Row ───────────────────────────────────────────────────────────────

interface SvcRowProps {
  svc: Service
  checked: boolean
  feeValue: string
  ndDepositValue: string
  focMode?: FocMode
  quoteMode?: QuoteMode
  onToggle: () => void
  onFeeChange: (v: string) => void
  onNdDepositChange: (v: string) => void
  onFocModeChange: (m: FocMode) => void
  onQuoteModeChange: (m: QuoteMode) => void
  rowBg: string
  showNdDeposit: boolean
}

function ServiceRow({
  svc, checked, feeValue, ndDepositValue, focMode, quoteMode,
  onToggle, onFeeChange, onNdDepositChange, onFocModeChange, onQuoteModeChange,
  rowBg, showNdDeposit,
}: SvcRowProps) {
  const isDiscount = svc.fee_type === 'discount'
  const isFocType = svc.fee_type === 'foc' || svc.fee_type === 'bundled'
  const isQuote = svc.fee_type === 'quote'

  const isFoc = isFocType && focMode === 'F.O.C.'
  const isNumericFoc = isFocType && focMode === 'SGD'
  const isNumeric = !isDiscount && !isFocType && !isQuote && svc.fee !== null

  const discountRowBg = isDiscount ? '#FFF5F6' : rowBg
  const discountBorder = isDiscount ? '2px solid #E8A0A8' : undefined

  return (
    <>
      <div className="flex items-center" style={{ backgroundColor: discountRowBg, borderTop: isDiscount ? discountBorder : undefined, borderBottom: isDiscount ? discountBorder : undefined }}>
        {/* Checkbox */}
        <div className="w-10 flex justify-center shrink-0">
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            className={`w-5 h-5 cursor-pointer ${isDiscount ? 'accent-[#8B1A2A]' : 'accent-[#1A3F6F]'}`}
          />
        </div>

        {/* Name */}
        <div className="flex-1 py-2.5 pr-3">
          <div className={`text-sm font-bold ${isDiscount ? 'text-[#8B1A2A]' : 'text-[#1A1A2E]'}`}>{svc.en}</div>
          <div className={`text-xs mt-0.5 ${isDiscount ? 'text-[#C06070]' : 'text-[#6B7FA0]'}`}>{svc.cn}</div>
        </div>

        {/* Fee badge */}
        <div className="shrink-0 mr-4">
          {isDiscount && (
            <DiscountBadge
              value={feeValue}
              onChange={onFeeChange}
            />
          )}
          {isFoc && (
            <FocBadge
              mode={focMode ?? 'F.O.C.'}
              value={feeValue}
              onModeChange={onFocModeChange}
              onValueChange={onFeeChange}
            />
          )}
          {isQuote && (
            <QuoteBadge
              mode={quoteMode ?? 'On Quote'}
              value={feeValue}
              onModeChange={onQuoteModeChange}
              onValueChange={onFeeChange}
            />
          )}
          {(isNumeric || isNumericFoc) && (
            <NumericFocBadge
              mode={focMode ?? 'SGD'}
              value={feeValue}
              onModeChange={onFocModeChange}
              onValueChange={onFeeChange}
            />
          )}
        </div>
      </div>

      {/* ND deposit sub-row */}
      {showNdDeposit && (
        <div className="flex items-center bg-[#EEF5FF]">
          <div className="w-10 flex justify-center shrink-0 text-[#4A6F9A] text-sm">↳</div>
          <div className="flex-1 py-2 pr-3">
            <div className="text-sm font-bold text-[#1A1A2E]">Additional Deposit</div>
            <div className="text-xs text-[#6B7FA0]">另付押金</div>
          </div>
          <div className="shrink-0 mr-4">
            <NumericBadge value={ndDepositValue} onChange={onNdDepositChange} />
          </div>
        </div>
      )}
    </>
  )
}

// ── Fee Badges ────────────────────────────────────────────────────────────────

function FocBadge({ mode, value, onModeChange, onValueChange }: {
  mode: FocMode; value: string;
  onModeChange: (m: FocMode) => void; onValueChange: (v: string) => void
}) {
  const isSgd = mode === 'SGD'
  const normalizedValue = (value ?? '0.00').includes('.') ? value : `${value}.00`
  return (
    <div className={`flex items-center rounded-lg px-2 py-1.5 gap-1.5 ${isSgd ? 'bg-[#E8F0FB]' : 'bg-[#E6F4EC]'}`}>
      <select
        value={mode}
        onChange={e => onModeChange(e.target.value as FocMode)}
        className={`text-xs font-bold rounded px-1 py-0.5 border-0 cursor-pointer ${
          isSgd ? 'bg-[#1A3F6F] text-white' : 'bg-[#2D7D4E] text-white'
        }`}
      >
        <option>F.O.C.</option>
        <option>SGD</option>
      </select>
      {isSgd && (
        <div className="flex items-center gap-1">
          <span className="text-xs font-bold text-[#1A3F6F]">SGD</span>
          <input
            type="text"
            value={(parseInt(normalizedValue.split('.')[0].replace(/,/g, ''), 10) || 0).toLocaleString('en-US')}
            onChange={e => {
              const rawNum = e.target.value.replace(/,/g, '')
              if (rawNum === '' || /^\d+$/.test(rawNum)) {
                onValueChange(rawNum ? `${rawNum}.00` : '0.00')
              }
            }}
            onKeyDown={e => {
              const key = e.key
              const isNumber = /^\d$/.test(key)
              const isDelete = key === 'Backspace' || key === 'Delete'
              const isNav = ['ArrowLeft', 'ArrowRight', 'Tab'].includes(key)
              if (!isNumber && !isDelete && !isNav && key !== 'Control' && key !== 'Meta' && key !== 'Shift') e.preventDefault()
            }}
            className="w-16 text-xs font-bold text-right bg-transparent border-0 outline-none text-[#1A3F6F]"
          />
          <span className="text-xs font-bold text-[#1A3F6F]">.00</span>
        </div>
      )}
    </div>
  )
}

function QuoteBadge({ mode, value, onModeChange, onValueChange }: {
  mode: QuoteMode; value: string;
  onModeChange: (m: QuoteMode) => void; onValueChange: (v: string) => void
}) {
  const isSgd = mode === 'SGD'
  return (
    <div className={`flex items-center rounded-lg px-2 py-1.5 gap-1.5 ${isSgd ? 'bg-[#E8F0FB]' : 'bg-[#EFEFEF]'}`}>
      <select
        value={mode}
        onChange={e => onModeChange(e.target.value as QuoteMode)}
        className={`text-xs font-bold rounded px-1 py-0.5 border-0 cursor-pointer ${
          isSgd ? 'bg-[#1A3F6F] text-white' : 'bg-[#888888] text-white'
        }`}
      >
        <option>On Quote</option>
        <option>SGD</option>
      </select>
      {isSgd && (
        <div className="flex items-center gap-1">
          <span className="text-xs font-bold text-[#1A3F6F]">SGD</span>
          <input
            type="text"
            value={(parseInt(value.split('.')[0].replace(/,/g, ''), 10) || 0).toLocaleString('en-US')}
            onChange={e => {
              const rawNum = e.target.value.replace(/,/g, '')
              if (rawNum === '' || /^\d+$/.test(rawNum)) {
                onValueChange(rawNum ? `${rawNum}.00` : '0.00')
              }
            }}
            onKeyDown={e => {
              const key = e.key
              const isNumber = /^\d$/.test(key)
              const isDelete = key === 'Backspace' || key === 'Delete'
              const isNav = ['ArrowLeft', 'ArrowRight', 'Tab'].includes(key)
              if (!isNumber && !isDelete && !isNav && key !== 'Control' && key !== 'Meta' && key !== 'Shift') e.preventDefault()
            }}
            className="w-16 text-xs font-bold text-right bg-transparent border-0 outline-none text-[#1A3F6F]"
          />
          <span className="text-xs font-bold text-[#1A3F6F]">.00</span>
        </div>
      )}
    </div>
  )
}

function DiscountBadge({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const normalizedValue = (value ?? '0.00').includes('.') ? value : `${value}.00`
  const integerPart = parseInt(normalizedValue.split('.')[0].replace(/,/g, ''), 10) || 0
  return (
    <div className="flex items-center gap-1 bg-[#FFF0F2] rounded-lg px-2.5 py-1.5 border border-[#F0C0C8]">
      <span className="text-xs font-bold text-[#8B1A2A]">- SGD</span>
      <input
        type="text"
        value={integerPart.toLocaleString('en-US')}
        onChange={e => {
          const rawNum = e.target.value.replace(/,/g, '')
          if (rawNum === '' || /^\d+$/.test(rawNum)) {
            onChange(rawNum ? `${rawNum}.00` : '0.00')
          }
        }}
        onKeyDown={e => {
          const key = e.key
          const isNumber = /^\d$/.test(key)
          const isDelete = key === 'Backspace' || key === 'Delete'
          const isNav = ['ArrowLeft', 'ArrowRight', 'Tab'].includes(key)
          if (!isNumber && !isDelete && !isNav && key !== 'Control' && key !== 'Meta' && key !== 'Shift') e.preventDefault()
        }}
        className="w-20 text-xs font-bold text-right bg-transparent border-0 outline-none text-[#8B1A2A]"
        placeholder="0.00"
      />
      <span className="text-xs font-bold text-[#8B1A2A]">.00</span>
    </div>
  )
}

function NumericBadge({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const numVal = parseInt(value.split('.')[0].replace(/,/g, ''), 10) || 0
  const displayVal = numVal.toLocaleString('en-US')

  return (
    <div className="flex items-center gap-1 bg-[#E8F0FB] rounded-lg px-2.5 py-1.5">
      <span className="text-xs font-bold text-[#1A3F6F]">SGD</span>
      <input
        type="text"
        value={displayVal}
        onChange={e => {
          const rawNum = e.target.value.replace(/,/g, '')
          if (rawNum === '' || /^\d+$/.test(rawNum)) {
            onChange(rawNum ? `${rawNum}.00` : '0.00')
          }
        }}
        onKeyDown={e => {
          const key = e.key
          const isNumber = /^\d$/.test(key)
          const isDelete = key === 'Backspace' || key === 'Delete'
          const isNav = ['ArrowLeft', 'ArrowRight', 'Tab'].includes(key)
          if (!isNumber && !isDelete && !isNav && key !== 'Control' && key !== 'Meta' && key !== 'Shift') e.preventDefault()
        }}
        className="w-16 text-xs font-bold text-right bg-transparent border-0 outline-none text-[#1A3F6F]"
      />
      <span className="text-xs font-bold text-[#1A3F6F]">.00</span>
    </div>
  )
}

function NumericFocBadge({ mode, value, onModeChange, onValueChange }: {
  mode: FocMode; value: string;
  onModeChange: (m: FocMode) => void; onValueChange: (v: string) => void
}) {
  const isFoc = mode === 'F.O.C.'
  const normalizedValue = (value ?? '0.00').includes('.') ? value : `${value}.00`
  return (
    <div className={`flex items-center rounded-lg px-2 py-1.5 gap-1.5 ${isFoc ? 'bg-[#E6F4EC]' : 'bg-[#E8F0FB]'}`}>
      <select
        value={mode}
        onChange={e => onModeChange(e.target.value as FocMode)}
        className={`text-xs font-bold rounded px-1 py-0.5 border-0 cursor-pointer ${
          isFoc ? 'bg-[#2D7D4E] text-white' : 'bg-[#1A3F6F] text-white'
        }`}
      >
        <option>SGD</option>
        <option>F.O.C.</option>
      </select>
      {!isFoc && (
        <div className="flex items-center gap-1">
          <span className="text-xs font-bold text-[#1A3F6F]">SGD</span>
          <input
            type="text"
            value={(parseInt(normalizedValue.split('.')[0].replace(/,/g, ''), 10) || 0).toLocaleString('en-US')}
            onChange={e => {
              const rawNum = e.target.value.replace(/,/g, '')
              if (rawNum === '' || /^\d+$/.test(rawNum)) {
                onValueChange(rawNum ? `${rawNum}.00` : '0.00')
              }
            }}
            onKeyDown={e => {
              const key = e.key
              const isNumber = /^\d$/.test(key)
              const isDelete = key === 'Backspace' || key === 'Delete'
              const isNav = ['ArrowLeft', 'ArrowRight', 'Tab'].includes(key)
              if (!isNumber && !isDelete && !isNav && key !== 'Control' && key !== 'Meta' && key !== 'Shift') e.preventDefault()
            }}
            className="w-16 text-xs font-bold text-right bg-transparent border-0 outline-none text-[#1A3F6F]"
          />
          <span className="text-xs font-bold text-[#1A3F6F]">.00</span>
        </div>
      )}
    </div>
  )
}

// ── Company Changes Tab ───────────────────────────────────────────────────────

function CompanyChangesTab({ ccFeeValues, ccFocModes, onCcFeeChange, onCcFocModeChange }: {
  ccFeeValues: Record<string, string>
  ccFocModes: Record<string, FocMode>
  onCcFeeChange: (k: string, v: string) => void
  onCcFocModeChange: (k: string, m: FocMode) => void
}) {
  const groups: CcItem[][] = []
  let current: CcItem[] = []
  let prevGroup = -1
  for (const item of CC_ITEMS) {
    if (item.group !== prevGroup) {
      if (current.length) groups.push(current)
      current = []
      prevGroup = item.group
    }
    current.push(item)
  }
  if (current.length) groups.push(current)

  return (
    <div className="p-4">
      <div className="text-[10px] font-bold text-gray-400 tracking-widest mb-1 px-2">
        POST-INCORPORATION FEE SCHEDULE
      </div>
      <div className="text-xs text-gray-500 mb-3 px-2">
        Edit fee values below — changes apply to Table 3 in the generated proposal only (does not affect Grand Total)
      </div>
      {groups.map(groupItems => {
        const { group, group_en, group_cn } = groupItems[0]
        return (
          <div key={group} className="mb-3 rounded-xl overflow-hidden border border-[#C8D8EC] bg-white shadow-sm">
            {/* Group header (dark green) */}
            <div className="flex items-center h-11" style={{ backgroundColor: '#1E5C3A' }}>
              <span className="text-[11px] font-bold text-[#9ACFB0] ml-3 mr-1">Group {group}  ·</span>
              <span className="text-xs font-bold text-white flex-1 mr-4">{group_en}  /  {group_cn}</span>
            </div>
            {/* Column subheader */}
            <div className="flex items-center h-6 bg-[#EBF1F8]">
              <span className="text-[9px] font-bold text-[#4A6F9A] ml-4">Description  服务说明</span>
              <span className="text-[9px] font-bold text-[#4A6F9A] ml-auto mr-4">Fee (SGD)</span>
            </div>
            {groupItems.map((item, i) => (
              <div key={item.key}
                className="flex items-center"
                style={{ backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F5F9FF' }}
              >
                <div className="flex-1 px-4 py-2.5">
                  <div className="text-xs font-bold text-[#1A1A2E]">{item.desc_en}</div>
                  <div className="text-[10px] text-[#6B7FA0]">{item.desc_cn}  ·  {item.pkg}</div>
                </div>
                <div className="mr-4 shrink-0">
                  {item.is_foc ? (
                    <FocBadge
                      mode={ccFocModes[item.key] ?? 'F.O.C.'}
                      value={ccFeeValues[item.key] ?? '0.00'}
                      onModeChange={m => onCcFocModeChange(item.key, m)}
                      onValueChange={v => onCcFeeChange(item.key, v)}
                    />
                  ) : (
                    <NumericBadge
                      value={ccFeeValues[item.key] ?? String(item.default)}
                      onChange={v => onCcFeeChange(item.key, v)}
                    />
                  )}
                </div>
              </div>
            ))}
            <div className="h-1.5" />
          </div>
        )
      })}
    </div>
  )
}

// ── Settings Tab ──────────────────────────────────────────────────────────────

const TABLE_LABELS: Record<string, string> = {
  main: 'Table 1 — Year 1 Initialization  （第一年初始费用）',
  opt:  'Table 2 — Annual Maintenance  （年度维护费用）',
  ep:   'Table 3 — EP / Work Pass  （就业准证服务）',
}

function SettingsTab({ sectionMapping, currentSection, selected, filterSelected,
  onFilterChange, onSectionSelect, onMappingChange, onReset }: {
  sectionMapping: Record<string, string[]>
  currentSection: string | null
  selected: Set<string>
  filterSelected: boolean
  onFilterChange: (v: boolean) => void
  onSectionSelect: (k: string) => void
  onMappingChange: (section: string, rowId: string, checked: boolean) => void
  onReset: () => void
}) {
  const visibleSvcs = SERVICES.filter(s => !filterSelected || selected.has(s.key))
  const linked = currentSection ? (sectionMapping[currentSection] ?? []) : []
  let prevTable = ''

  return (
    <div className="p-4 flex gap-4 h-full">
      {/* Left: section list */}
      <div className="w-56 shrink-0 flex flex-col gap-2">
        <div className="bg-white rounded-xl border border-[#C8D8EC] overflow-hidden shadow-sm flex flex-col flex-1">
          <div className="px-3 py-2 bg-[#EBF1F8] border-b border-[#C8D8EC]">
            <div className="text-xs font-bold text-[#1A3F6F] mb-1">Service Sections</div>
            <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input type="checkbox" checked={filterSelected} onChange={e => onFilterChange(e.target.checked)}
                className="accent-[#1A3F6F]" />
              Show selected only
            </label>
          </div>
          <div className="overflow-y-auto flex-1">
            {visibleSvcs.map(svc => (
              <button
                key={svc.key}
                onClick={() => onSectionSelect(svc.key)}
                className={`w-full text-left px-3 py-2 text-sm border-b border-gray-100 hover:bg-blue-50 transition-colors ${
                  currentSection === svc.key ? 'bg-[#1A3F6F] text-white' : 'text-gray-700'
                }`}
              >
                {svc.key}
              </button>
            ))}
          </div>
          <div className="p-2 border-t border-gray-200 flex flex-col gap-1">
            <button onClick={onReset}
              className="w-full text-xs bg-red-600 hover:bg-red-700 text-white rounded px-2 py-1.5 font-bold">
              Reset Defaults  恢复默认
            </button>
          </div>
        </div>
      </div>

      {/* Right: linked fee rows */}
      <div className="flex-1 bg-white rounded-xl border border-[#C8D8EC] overflow-hidden shadow-sm flex flex-col">
        <div className="px-4 py-3 border-b border-gray-200">
          <div className="text-sm font-bold text-gray-800">
            Linked Fee Rows{currentSection ? ` — ${currentSection}` : ''}
          </div>
        </div>
        <div className="overflow-y-auto flex-1 p-4">
          {Object.entries(ROW_DEFS).map(([rowId, rdef]) => {
            const showHeader = rdef.table !== prevTable
            prevTable = rdef.table
            return (
              <div key={rowId}>
                {showHeader && (
                  <div className="text-xs font-bold text-[#1A3F6F] mt-4 mb-2 first:mt-0">
                    {TABLE_LABELS[rdef.table]}
                  </div>
                )}
                <label className="flex items-center gap-3 py-1.5 cursor-pointer hover:bg-gray-50 rounded px-2">
                  <input
                    type="checkbox"
                    checked={linked.includes(rowId)}
                    disabled={!currentSection}
                    onChange={e => currentSection && onMappingChange(currentSection, rowId, e.target.checked)}
                    className="w-4 h-4 accent-[#1A3F6F]"
                  />
                  <span className="text-sm text-gray-700">{rdef.label}</span>
                </label>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Selected Services Popup ───────────────────────────────────────────────────

function SelectedServicesPopup({ services, feeValues, focModes, quoteModes, onClose }: {
  services: Service[]
  feeValues: Record<string, string>
  focModes: Record<string, FocMode>
  quoteModes: Record<string, QuoteMode>
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-[560px] max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-bold text-[#1A1A2E]">Selected Services  已选服务</h2>
        </div>
        <div className="overflow-y-auto flex-1 px-4 py-3">
          {services.length === 0 ? (
            <div className="text-center text-gray-500 py-8">No services selected  未选择任何服务</div>
          ) : (
            services.map((svc, i) => {
              const isDisc = svc.fee_type === 'discount'
              const fee = getEffectiveFee(svc, feeValues, focModes, quoteModes)
              const isFocDisplay = !isDisc && fee === 0 && (focModes[svc.key] === 'F.O.C.' || svc.fee_type === 'foc' || svc.fee_type === 'bundled')
              const feeDisplay = isDisc
                ? `- SGD ${fee.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
                : fee > 0
                  ? `SGD ${fee.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
                  : isFocDisplay ? 'F.O.C.' : svc.fee_str
              return (
                <div key={svc.key}
                  className="flex items-center rounded-lg mb-2 px-3 py-2"
                  style={{
                    backgroundColor: isDisc ? '#FFF5F6' : i % 2 === 0 ? '#FFFFFF' : '#F5F9FF',
                    border: isDisc ? '1px solid #E8A0A8' : '1px solid #D8E8F4',
                  }}>
                  <span className={`text-sm font-bold w-7 text-right mr-3 ${isDisc ? 'text-[#8B1A2A]' : 'text-[#1A3F6F]'}`}>
                    {isDisc ? '—' : `${i + 1}.`}
                  </span>
                  <div className="flex-1">
                    <div className={`text-sm font-bold ${isDisc ? 'text-[#8B1A2A]' : 'text-[#1A1A2E]'}`}>{svc.en}</div>
                    <div className={`text-xs ${isDisc ? 'text-[#C06070]' : 'text-gray-500'}`}>{svc.cn}</div>
                  </div>
                  <span className={`text-sm font-bold ${isDisc ? 'text-[#8B1A2A]' : isFocDisplay ? 'text-[#2D7D4E]' : 'text-[#1A3F6F]'}`}>
                    {feeDisplay}
                  </span>
                </div>
              )
            })
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
          <button onClick={onClose}
            className="bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold px-5 py-2 rounded-lg text-sm">
            Close  关闭
          </button>
        </div>
      </div>
    </div>
  )
}
