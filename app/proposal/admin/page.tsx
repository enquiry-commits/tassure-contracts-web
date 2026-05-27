import ContractTable from '@/components/ContractTable'
import Link from 'next/link'

export default function AdminPage() {
  return (
    <div className="flex flex-col min-h-screen" style={{ fontFamily: 'system-ui, sans-serif' }}>

      {/* Header — matches generate page */}
      <header
        className="h-16 flex items-center px-6 gap-3 shrink-0 border-b border-[#B0C8E0]"
        style={{ backgroundColor: '#C8E0F4' }}
      >
        {/* Logo */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/tassure-logo.png" alt="Tassure" className="h-10 w-auto" />
        <span className="text-sm text-[#1A3F6F] opacity-70">Admin Dashboard</span>

        <div className="ml-auto flex items-center gap-3">
          <Link
            href="/proposal/generator"
            className="inline-flex items-center gap-2 text-sm font-bold text-white px-5 py-2 rounded-lg transition-colors"
            style={{ backgroundColor: '#1A3F6F' }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            New Proposal
          </Link>
        </div>
      </header>

      {/* Body */}
      <main className="flex-1 px-6 py-6" style={{ backgroundColor: '#F2F6FA' }}>

        {/* Page title */}
        <div className="mb-5">
          <h1 className="text-xl font-bold text-[#1A3F6F]">Contract Records</h1>
          <p className="text-sm text-[#6B7FA0] mt-0.5">Track delivery and signature status for all generated proposals</p>
        </div>

        <ContractTable />
      </main>
    </div>
  )
}
