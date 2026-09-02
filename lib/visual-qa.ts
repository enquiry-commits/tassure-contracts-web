import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

export const VISUAL_QA_CONTRACT_VERSION = '2026-08-31.1'
export const VISUAL_QA_BUCKET = 'contracts'

export type VisualQaStatus =
  | 'pending'
  | 'rendering'
  | 'review_required'
  | 'passed'
  | 'failed'
  | 'rejected'

export interface VisualQaPageResult {
  page: number
  bodyInkRatio: number
  brandPixels: number
  footerInkPixels: number
  edgeInkPixels: number
  errors: string[]
  warnings: string[]
}

export interface VisualQaReport {
  renderer: 'microsoft-word'
  pageCount: number
  errors: string[]
  warnings: string[]
  pages: VisualQaPageResult[]
  renderedAt: string
}

export interface VisualQaJob {
  id: string
  status: VisualQaStatus
  referenceId: string
  clientName: string
  pic: string
  replaceId: string | null
  oldFilePath: string | null
  draftPath: string
  finalPath: string
  displayFileName: string
  languageMode: 'bilingual' | 'english-only'
  selected: string[]
  generatorContractVersion: string
  generatorCommit: string
  qaContractVersion: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string
  workerId?: string
  contractId?: string
  approvalMode?: 'automatic' | 'human'
  approvedBy?: string
  failure?: string
  report?: VisualQaReport
}

function safeJobId(jobId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
    throw new Error('Invalid visual QA job id')
  }
  return jobId
}

export function visualQaJobPath(jobId: string): string {
  return `qa/jobs/${safeJobId(jobId)}.json`
}

export function visualQaPendingPath(jobId: string): string {
  return `qa/pending/${safeJobId(jobId)}.json`
}

export function visualQaDraftPath(jobId: string): string {
  return `qa/drafts/${safeJobId(jobId)}.docx`
}

export function visualQaArtifactPath(jobId: string, fileName: string): string {
  const safeFile = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `qa/artifacts/${safeJobId(jobId)}/${safeFile}`
}

async function uploadJson(
  supabase: SupabaseClient,
  path: string,
  value: unknown,
): Promise<void> {
  const { error } = await supabase.storage
    .from(VISUAL_QA_BUCKET)
    .upload(path, Buffer.from(JSON.stringify(value, null, 2)), {
      contentType: 'application/json; charset=utf-8',
      cacheControl: '0',
      upsert: true,
    })
  if (error) throw new Error(`Visual QA storage write failed (${path}): ${error.message}`)
}

export async function readVisualQaJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<VisualQaJob | null> {
  const { data, error } = await supabase.storage
    .from(VISUAL_QA_BUCKET)
    .createSignedUrl(visualQaJobPath(jobId), 60)
  if (error || !data?.signedUrl) return null

  const freshUrl = new URL(data.signedUrl)
  freshUrl.searchParams.set('qa_read', `${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const response = await fetch(freshUrl, { cache: 'no-store' })
  if (!response.ok) return null
  return JSON.parse(await response.text()) as VisualQaJob
}

export async function writeVisualQaJob(
  supabase: SupabaseClient,
  job: VisualQaJob,
): Promise<VisualQaJob> {
  const updated = { ...job, updatedAt: new Date().toISOString() }
  await uploadJson(supabase, visualQaJobPath(updated.id), updated)
  return updated
}

export async function enqueueVisualQaJob(
  supabase: SupabaseClient,
  input: Omit<VisualQaJob, 'id' | 'status' | 'draftPath' | 'qaContractVersion' | 'createdAt' | 'updatedAt'>,
  docBuffer: Buffer,
): Promise<VisualQaJob> {
  const id = randomUUID()
  const now = new Date().toISOString()
  const job: VisualQaJob = {
    ...input,
    id,
    status: 'pending',
    draftPath: visualQaDraftPath(id),
    qaContractVersion: VISUAL_QA_CONTRACT_VERSION,
    createdAt: now,
    updatedAt: now,
  }

  const storage = supabase.storage.from(VISUAL_QA_BUCKET)
  const { error: draftError } = await storage.upload(job.draftPath, docBuffer, {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    upsert: false,
  })
  if (draftError) throw new Error(`Visual QA draft upload failed: ${draftError.message}`)

  try {
    await writeVisualQaJob(supabase, job)
    await uploadJson(supabase, visualQaPendingPath(id), { id, createdAt: now })
    return job
  } catch (error) {
    await storage.remove([job.draftPath, visualQaJobPath(id), visualQaPendingPath(id)])
    throw error
  }
}

export async function clearVisualQaPendingMarker(
  supabase: SupabaseClient,
  jobId: string,
): Promise<void> {
  await supabase.storage.from(VISUAL_QA_BUCKET).remove([visualQaPendingPath(jobId)])
}

export async function retryVisualQaJob(
  supabase: SupabaseClient,
  originalJob: VisualQaJob,
): Promise<VisualQaJob> {
  const latest = await readVisualQaJob(supabase, originalJob.id)
  const job = latest ?? originalJob
  if (job.status !== 'failed') throw new Error(`Cannot retry visual QA job in ${job.status} state`)

  const retried = await writeVisualQaJob(supabase, {
    ...job,
    status: 'pending',
    startedAt: undefined,
    completedAt: undefined,
    workerId: undefined,
    failure: undefined,
    report: undefined,
  })
  await uploadJson(supabase, visualQaPendingPath(job.id), {
    id: job.id,
    retriedAt: new Date().toISOString(),
  })
  return retried
}

// Publishes a generated proposal immediately: uploads it to its final,
// user-facing storage path and creates/updates its `contracts` row, then
// returns a download URL. This is the fast path -- it runs synchronously
// in the generate API route right after generateDocx() succeeds, gated
// only by that function's own structural audit (buildProposalPlan's input
// validation + assertGeneratedProposalContract's row/header/section
// checks), not by a Word render on any particular machine.
//
// Word-based visual QA (enqueueVisualQaJob + the worker pipeline) still
// runs after this, queued separately, as a non-blocking secondary audit --
// see the generate route for how the two are wired together. This
// function intentionally does NOT touch draftPath/oldFilePath cleanup or
// job records; finalizeApprovedVisualQaJob still owns that when the async
// audit eventually completes, and its own `existing` lookup by
// referenceId means it will find and reuse the contract row created here
// rather than creating a duplicate.
export async function publishProposalNow(
  supabase: SupabaseClient,
  params: {
    referenceId: string
    clientName: string
    pic: string
    replaceId: string | null
    finalPath: string
    displayFileName: string
  },
  docBuffer: Buffer,
): Promise<{ contractId: string; downloadUrl: string }> {
  const storage = supabase.storage.from(VISUAL_QA_BUCKET)
  const { error: uploadError } = await storage.upload(params.finalPath, docBuffer, {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    upsert: true,
  })
  if (uploadError) throw new Error(`Proposal upload failed: ${uploadError.message}`)

  const { data: signedUrlData, error: signedUrlError } = await storage.createSignedUrl(
    params.finalPath,
    60 * 60 * 24 * 7,
    { download: params.displayFileName },
  )
  if (signedUrlError || !signedUrlData) throw new Error('Proposal signed URL creation failed')

  let contractId: string
  if (params.replaceId) {
    const { data, error } = await supabase
      .from('contracts')
      .update({
        client_name: params.clientName,
        pic: params.pic,
        file_path: params.finalPath,
        file_url: signedUrlData.signedUrl,
      })
      .eq('id', params.replaceId)
      .select('id')
      .single()
    if (error || !data) throw new Error(`Proposal record update failed: ${error?.message ?? 'missing record'}`)
    contractId = data.id
  } else {
    const { data: existing } = await supabase
      .from('contracts')
      .select('id')
      .eq('reference_id', params.referenceId)
      .maybeSingle()

    if (existing) {
      contractId = existing.id
    } else {
      const { data, error } = await supabase
        .from('contracts')
        .insert({
          reference_id: params.referenceId,
          client_name: params.clientName,
          pic: params.pic,
          remarks: null,
          file_path: params.finalPath,
          file_url: signedUrlData.signedUrl,
          is_delivered: false,
        })
        .select('id')
        .single()
      if (error || !data) throw new Error(`Proposal record insert failed: ${error?.message ?? 'missing record'}`)
      contractId = data.id
    }
  }

  return { contractId, downloadUrl: signedUrlData.signedUrl }
}

export async function finalizeApprovedVisualQaJob(
  supabase: SupabaseClient,
  originalJob: VisualQaJob,
  approval: { mode: 'automatic' | 'human'; approvedBy?: string },
): Promise<VisualQaJob> {
  const latest = await readVisualQaJob(supabase, originalJob.id)
  const job = latest ?? originalJob
  if (job.status === 'passed' && job.contractId) return job
  if (!job.report) throw new Error('Cannot approve visual QA job without a render report')
  if (job.report.errors.length > 0) throw new Error('Cannot approve visual QA job with render errors')

  const storage = supabase.storage.from(VISUAL_QA_BUCKET)
  const { data: draft, error: draftError } = await storage.download(job.draftPath)
  if (draftError || !draft) throw new Error(`Visual QA draft download failed: ${draftError?.message ?? 'missing file'}`)

  const { error: finalUploadError } = await storage.upload(
    job.finalPath,
    Buffer.from(await draft.arrayBuffer()),
    {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: true,
    },
  )
  if (finalUploadError) throw new Error(`Approved proposal upload failed: ${finalUploadError.message}`)

  const { data: signedUrlData, error: signedUrlError } = await storage.createSignedUrl(
    job.finalPath,
    60 * 60 * 24 * 7,
    { download: job.displayFileName },
  )
  if (signedUrlError || !signedUrlData) throw new Error('Approved proposal signed URL creation failed')

  let contractId = job.contractId
  if (job.replaceId) {
    const { data, error } = await supabase
      .from('contracts')
      .update({
        client_name: job.clientName,
        pic: job.pic,
        file_path: job.finalPath,
        file_url: signedUrlData.signedUrl,
      })
      .eq('id', job.replaceId)
      .select('id')
      .single()
    if (error || !data) throw new Error(`Approved proposal record update failed: ${error?.message ?? 'missing record'}`)
    contractId = data.id
  } else {
    const { data: existing } = await supabase
      .from('contracts')
      .select('id')
      .eq('reference_id', job.referenceId)
      .maybeSingle()

    if (existing) {
      contractId = existing.id
    } else {
      const { data, error } = await supabase
        .from('contracts')
        .insert({
          reference_id: job.referenceId,
          client_name: job.clientName,
          pic: job.pic,
          remarks: null,
          file_path: job.finalPath,
          file_url: signedUrlData.signedUrl,
          is_delivered: false,
        })
        .select('id')
        .single()
      if (error || !data) throw new Error(`Approved proposal record insert failed: ${error?.message ?? 'missing record'}`)
      contractId = data.id
    }
  }

  if (job.oldFilePath && job.oldFilePath !== job.finalPath) {
    await storage.remove([job.oldFilePath])
  }
  await storage.remove([job.draftPath])

  const passed = await writeVisualQaJob(supabase, {
    ...job,
    status: 'passed',
    contractId,
    approvalMode: approval.mode,
    approvedBy: approval.approvedBy,
    completedAt: new Date().toISOString(),
    failure: undefined,
  })
  await clearVisualQaPendingMarker(supabase, job.id)
  return passed
}

export async function failVisualQaJob(
  supabase: SupabaseClient,
  job: VisualQaJob,
  status: 'failed' | 'rejected',
  failure: string,
): Promise<VisualQaJob> {
  const failed = await writeVisualQaJob(supabase, {
    ...job,
    status,
    failure,
    completedAt: new Date().toISOString(),
  })
  await clearVisualQaPendingMarker(supabase, job.id)
  return failed
}
