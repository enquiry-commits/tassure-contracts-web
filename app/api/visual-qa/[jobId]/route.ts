import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import {
  readVisualQaJob,
  VISUAL_QA_BUCKET,
  visualQaArtifactPath,
} from '@/lib/visual-qa'
import { getAuthorizedProposalUser } from '@/lib/proposal-auth'

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    if (!await getAuthorizedProposalUser(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { jobId } = await params
    const supabase = createSupabaseAdminClient()
    const job = await readVisualQaJob(supabase, jobId)
    if (!job) return NextResponse.json({ error: 'Visual QA job not found' }, { status: 404 })

    let downloadUrl: string | null = null
    let previewUrl: string | null = null
    if (job.status === 'passed') {
      const { data } = await supabase.storage
        .from(VISUAL_QA_BUCKET)
        .createSignedUrl(job.finalPath, 60 * 60 * 24 * 7, { download: job.displayFileName })
      downloadUrl = data?.signedUrl ?? null
    }
    if (job.report) {
      const { data } = await supabase.storage
        .from(VISUAL_QA_BUCKET)
        .createSignedUrl(visualQaArtifactPath(job.id, 'contact-sheet.png'), 60 * 60)
      previewUrl = data?.signedUrl ?? null
    }

    return NextResponse.json({
      id: job.id,
      referenceId: job.referenceId,
      clientName: job.clientName,
      status: job.status,
      failure: job.failure ?? null,
      report: job.report ?? null,
      downloadUrl,
      previewUrl,
      approvalMode: job.approvalMode ?? null,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('Visual QA status error:', error)
    return NextResponse.json({ error: 'Unable to read visual QA status' }, { status: 500 })
  }
}
