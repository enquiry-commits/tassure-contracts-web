import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import {
  failVisualQaJob,
  finalizeApprovedVisualQaJob,
  readVisualQaJob,
  retryVisualQaJob,
} from '@/lib/visual-qa'
import { getAuthorizedProposalUser } from '@/lib/proposal-auth'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const authorizedUser = await getAuthorizedProposalUser(request)
    if (!authorizedUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { jobId } = await params
    const body = await request.json()
    const decision = body?.decision
    const reviewer = typeof body?.reviewer === 'string' && body.reviewer.trim()
      ? body.reviewer.trim()
      : authorizedUser.email
    if (decision !== 'approve' && decision !== 'reject' && decision !== 'retry') {
      return NextResponse.json({ error: 'decision must be approve, reject or retry' }, { status: 400 })
    }

    const supabase = createSupabaseAdminClient()
    const job = await readVisualQaJob(supabase, jobId)
    if (!job) return NextResponse.json({ error: 'Visual QA job not found' }, { status: 404 })
    if (decision === 'retry') {
      if (job.status !== 'failed') {
        return NextResponse.json({ error: `Job is ${job.status}, not failed` }, { status: 409 })
      }
      const updated = await retryVisualQaJob(supabase, job)
      return NextResponse.json({ success: true, status: updated.status })
    }
    if (job.status !== 'review_required') {
      return NextResponse.json({ error: `Job is ${job.status}, not review_required` }, { status: 409 })
    }

    const updated = decision === 'approve'
      ? await finalizeApprovedVisualQaJob(supabase, job, { mode: 'human', approvedBy: reviewer })
      : await failVisualQaJob(supabase, job, 'rejected', `Rejected by ${reviewer}`)

    return NextResponse.json({ success: true, status: updated.status })
  } catch (error) {
    console.error('Visual QA decision error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
