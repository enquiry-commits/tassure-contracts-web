'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ContractTable from '@/components/ContractTable'
import Link from 'next/link'
import { createSupabaseBrowserClient } from '@/lib/supabase'

export default function AdminPage() {
  const router = useRouter()

  useEffect(() => {
    createSupabaseBrowserClient().auth.getSession().then(({ data: { session } }) => {
      if (!session) router.replace('/login')
    })
  }, [router])

  return (
    <div className="flex flex-col min-h-screen" style={{ fontFamily: 'system-ui, sans-serif' }}>

      {/* Header — matches generate page */}
      <header
        className="flex items-center px-8 gap-3 shrink-0 border-b"
        style={{
          height: '70px',
          background: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)',
          borderColor: 'rgba(30, 58, 95, 0.08)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.04)'
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/tassure-logo.png" alt="Tassure" className="h-[45px] w-auto" />
        <span
          className="flex-1"
          style={{
            fontSize: '18px',
            fontWeight: '800',
            color: '#1e3a5f',
            fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif'
          }}>
          Admin Dashboard
        </span>

        <div className="flex items-center gap-3">
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
