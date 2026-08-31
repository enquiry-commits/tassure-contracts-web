'use client'

import { useCallback, useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase'

type QaStatus = 'pending' | 'rendering' | 'review_required' | 'passed' | 'failed' | 'rejected'

interface QaJob {
  id: string
  referenceId: string
  clientName: string
  status: QaStatus
  failure?: string
  createdAt: string
  report?: { pageCount: number; errors: string[]; warnings: string[] }
}

interface WorkerState {
  online?: boolean
  status?: string
  updatedAt?: string
}

const statusLabel: Record<QaStatus, string> = {
  pending: 'Waiting',
  rendering: 'Word checking',
  review_required: 'Review required',
  passed: 'Passed',
  failed: 'Blocked',
  rejected: 'Rejected',
}

const statusStyle: Record<QaStatus, string> = {
  pending: 'bg-amber-50 text-amber-800 border-amber-200',
  rendering: 'bg-blue-50 text-blue-800 border-blue-200',
  review_required: 'bg-orange-50 text-orange-800 border-orange-300',
  passed: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  failed: 'bg-red-50 text-red-800 border-red-200',
  rejected: 'bg-gray-100 text-gray-700 border-gray-200',
}

async function authorizedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const { data: { session } } = await createSupabaseBrowserClient().auth.getSession()
  if (!session?.access_token) throw new Error('Your session has expired. Please sign in again.')
  return fetch(input, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${session.access_token}`,
    },
  })
}

export default function VisualQaQueue() {
  const [jobs, setJobs] = useState<QaJob[]>([])
  const [worker, setWorker] = useState<WorkerState>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const response = await authorizedFetch('/api/visual-qa?limit=40', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Unable to load visual QA queue')
      setJobs(data.jobs ?? [])
      setWorker(data.worker ?? {})
      setMessage(null)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load visual QA queue')
    }
  }, [])

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0)
    const timer = window.setInterval(() => void refresh(), 7500)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [refresh])

  const decide = async (jobId: string, decision: 'approve' | 'reject' | 'retry') => {
    setBusy(jobId)
    setMessage(null)
    try {
      const response = await authorizedFetch(`/api/visual-qa/${jobId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Decision failed')
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Decision failed')
    } finally {
      setBusy(null)
    }
  }

  const openPreview = async (jobId: string) => {
    setBusy(jobId)
    try {
      const response = await authorizedFetch(`/api/visual-qa/${jobId}`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok || !data.previewUrl) throw new Error(data.error || 'Preview is unavailable')
      window.open(data.previewUrl, '_blank', 'noopener,noreferrer')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Preview is unavailable')
    } finally {
      setBusy(null)
    }
  }

  const attentionJobs = jobs.filter(job => job.status !== 'passed')

  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-[#C8D8EC] bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b border-[#DDE7F2] bg-[#F7FAFD] px-5 py-4">
        <div className="flex-1">
          <h2 className="font-bold text-[#1A3F6F]">Microsoft Word Visual QA</h2>
          <p className="mt-0.5 text-xs text-[#6B7FA0]">Files remain blocked until every page is rendered and approved.</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-bold ${
          worker.online ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'
        }`}>
          {worker.online ? 'Word checker online' : 'Word checker offline'}
        </span>
      </div>

      {worker.online && worker.status === 'waiting:word-in-use' && (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-800">
          Waiting: Microsoft Word is open on the worker. Close Word there or use a dedicated worker computer.
        </div>
      )}

      {message && <div className="border-b border-red-100 bg-red-50 px-5 py-2 text-sm text-red-700">{message}</div>}

      {attentionJobs.length === 0 ? (
        <div className="px-5 py-5 text-sm text-[#6B7FA0]">No proposal is waiting for attention.</div>
      ) : (
        <div className="divide-y divide-[#E7EEF6]">
          {attentionJobs.map(job => (
            <div key={job.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-[#1A2F4B]">{job.clientName}</div>
                <div className="mt-0.5 text-xs text-[#6B7FA0]">
                  {job.referenceId} · {job.report ? `${job.report.pageCount} pages` : 'not rendered yet'}
                </div>
                {job.failure && <div className="mt-1 text-xs text-[#A04A18]">{job.failure}</div>}
              </div>
              <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${statusStyle[job.status]}`}>
                {statusLabel[job.status]}
              </span>
              {job.report && (
                <button
                  type="button"
                  disabled={busy === job.id}
                  onClick={() => void openPreview(job.id)}
                  className="rounded-lg border border-[#B9CAE0] px-3 py-1.5 text-xs font-bold text-[#1A3F6F] hover:bg-[#EEF4FA] disabled:opacity-50"
                >
                  View pages
                </button>
              )}
              {job.status === 'review_required' && (
                <>
                  <button
                    type="button"
                    disabled={busy === job.id}
                    onClick={() => void decide(job.id, 'reject')}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    disabled={busy === job.id}
                    onClick={() => void decide(job.id, 'approve')}
                    className="rounded-lg bg-[#1E6B43] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#155333] disabled:opacity-50"
                  >
                    Approve & release
                  </button>
                </>
              )}
              {job.status === 'failed' && (
                <button
                  type="button"
                  disabled={busy === job.id || !worker.online}
                  onClick={() => void decide(job.id, 'retry')}
                  className="rounded-lg bg-[#1A3F6F] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#123054] disabled:opacity-50"
                >
                  Retry Word QA
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
