import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { readVisualQaJob, VISUAL_QA_BUCKET } from '@/lib/visual-qa'
import { getAuthorizedProposalUser } from '@/lib/proposal-auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    if (!await getAuthorizedProposalUser(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const requestedLimit = Number(request.nextUrl.searchParams.get('limit') ?? '40')
    const limit = Math.max(1, Math.min(100, Number.isFinite(requestedLimit) ? requestedLimit : 40))
    const supabase = createSupabaseAdminClient()
    const { data: files, error } = await supabase.storage
      .from(VISUAL_QA_BUCKET)
      .list('qa/jobs', { limit, sortBy: { column: 'created_at', order: 'desc' } })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const jobs = (await Promise.all(
      (files ?? [])
        .filter((file) => file.name.endsWith('.json'))
        .map((file) => readVisualQaJob(supabase, file.name.replace(/\.json$/i, ''))),
    )).filter((job) => job !== null)

    let worker: { workerId?: string; updatedAt?: string } | null = null
    const { data: heartbeat } = await supabase.storage
      .from(VISUAL_QA_BUCKET)
      .download('qa/worker/heartbeat.json')
    if (heartbeat) worker = JSON.parse(await heartbeat.text())
    const workerOnline = worker?.updatedAt
      ? Date.now() - new Date(worker.updatedAt).getTime() < 90_000
      : false

    return NextResponse.json({ jobs, worker: { ...worker, online: workerOnline } }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error('Visual QA list error:', error)
    return NextResponse.json({ error: 'Unable to list visual QA jobs' }, { status: 500 })
  }
}
