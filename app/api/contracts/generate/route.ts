import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateDocx, PROPOSAL_GENERATOR_CONTRACT_VERSION } from '@/lib/docGenerator'
import { enqueueVisualQaJob, publishProposalNow } from '@/lib/visual-qa'
import { getAuthorizedProposalUser } from '@/lib/proposal-auth'

export async function POST(request: NextRequest) {
  try {
    if (!await getAuthorizedProposalUser(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = await request.json()
    const {
      companyName, date, salutationEn, salutationCn,
      pic, mode, selected, feeOverrides, ccOverrides, sectionMapping,
      existingId, // present when replacing an existing record
      focServices,
      languageMode,
    } = body
    const normalizedCompanyName = typeof companyName === 'string' ? companyName.trim() : ''

    if (!pic) {
      return NextResponse.json({ error: 'pic is required' }, { status: 400 })
    }

    const supabase = createSupabaseAdminClient()
    const today = new Date().toISOString().split('T')[0]
    const dateStr = today.replace(/-/g, '')

    let referenceId: string
    let oldFilePath: string | null = null

    if (existingId) {
      // ── Replace mode: reuse existing reference_id ──────────────────────────
      const { data: existing, error: fetchErr } = await supabase
        .from('contracts')
        .select('reference_id, file_path')
        .eq('id', existingId)
        .single()

      if (fetchErr || !existing) {
        return NextResponse.json({ error: 'Existing record not found' }, { status: 404 })
      }

      referenceId = existing.reference_id
      oldFilePath = existing.file_path

      // Extract the date portion from the existing reference_id (YYYYMMDD-NNN)
      // so the file path uses the original date, not today's date
    } else {
      // ── New record: get next sequence ──────────────────────────────────────
      const { data: seqData, error: seqError } = await supabase.rpc('get_next_sequence', { today })
      if (seqError) {
        console.error('Sequence error:', seqError)
        return NextResponse.json({ error: 'Failed to generate sequence' }, { status: 500 })
      }
      const seqNumber = String(seqData).padStart(3, '0')
      referenceId = `${dateStr}-${seqNumber}`
    }

    let docBuffer: Buffer
    try {
      docBuffer = await generateDocx({
        companyName: normalizedCompanyName,
        date: date || new Date().toLocaleDateString('en-SG', { day: '2-digit', month: 'long', year: 'numeric' }),
        salutationEn: salutationEn || 'Dear Management,',
        salutationCn: salutationCn || '尊敬的领导，',
        mode: mode || 'full',
        selected: selected || [],
        feeOverrides: feeOverrides || {},
        ccOverrides: ccOverrides || {},
        sectionMapping,
        focServices: focServices || [],
        languageMode: languageMode || 'bilingual',
      })
    } catch (docErr) {
      console.error('Doc generation error:', docErr)
      return NextResponse.json({ error: `Doc error: ${String(docErr)}` }, { status: 500 })
    }

    // Derive year/month from the referenceId itself so replace keeps original date folder
    const refDatePart = referenceId.slice(0, 8) // YYYYMMDD
    const year = refDatePart.slice(0, 4)
    const month = refDatePart.slice(4, 6)
    const safeName = normalizedCompanyName.replace(/[^a-zA-Z0-9 _-]/g, '_').trim().replace(/\s+/g, '_')
    const storageFileName = safeName
      ? `Tassure_Proposal_${safeName}_${referenceId}.docx`
      : `Tassure_Proposal_${referenceId}.docx`
    const displayFileName = storageFileName
    const filePath = `contracts/${year}/${month}/${storageFileName}`

    // Publish immediately. generateDocx() already ran the full structural
    // audit -- buildProposalPlan()'s input validation plus
    // assertGeneratedProposalContract()'s row/duplicate/header/section
    // checks -- entirely on this server, in milliseconds. Every real bug
    // found in this proposal generator (duplicate/phantom rows, missing
    // company name, mis-mapped sections, inconsistent fee formatting) was
    // caught and fixed via those structural checks; none of them ever
    // required an actual Word render to detect. Gating every download on
    // a synchronous Word render tied to one specific physical machine made
    // the whole team's ability to generate proposals depend on that one
    // machine being on, logged in, and not fighting another process for
    // Word -- a real single point of failure with no relation to whether
    // the document is actually correct.
    const { contractId, downloadUrl } = await publishProposalNow(supabase, {
      referenceId,
      clientName: normalizedCompanyName,
      pic,
      replaceId: existingId || null,
      finalPath: filePath,
      displayFileName,
    }, docBuffer)

    // Still queue the Word-rendered visual audit as a secondary, advisory
    // safety net -- it catches things the structural checks fundamentally
    // can't (font substitution, genuinely novel Word-layout edge cases)
    // and gives a concrete, inspectable trail (contact sheets in Admin
    // Dashboard) for tracking down whatever new bug class shows up next as
    // the generator keeps growing. Its result no longer blocks or
    // un-publishes anything: the file above is already live. If enqueuing
    // it fails (e.g. storage hiccup), that must not fail the request the
    // user is waiting on -- log it and move on.
    let qaJobId: string | null = null
    try {
      const qaJob = await enqueueVisualQaJob(supabase, {
        referenceId,
        clientName: normalizedCompanyName,
        pic,
        replaceId: existingId || null,
        oldFilePath,
        finalPath: filePath,
        displayFileName,
        languageMode: languageMode || 'bilingual',
        selected: [...new Set(Array.isArray(selected) ? selected : [])],
        generatorContractVersion: PROPOSAL_GENERATOR_CONTRACT_VERSION,
        generatorCommit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'local',
      }, docBuffer)
      qaJobId = qaJob.id
    } catch (qaError) {
      console.error('Visual QA enqueue failed (non-blocking, proposal already published):', qaError)
    }

    return NextResponse.json({
      success: true,
      referenceId,
      contractId,
      downloadUrl,
      qaRequired: false,
      qaJobId,
      qaStatusUrl: qaJobId ? `/api/visual-qa/${qaJobId}` : null,
      replaced: !!existingId,
      generatorContractVersion: PROPOSAL_GENERATOR_CONTRACT_VERSION,
      generatorCommit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'local',
    })
  } catch (err) {
    console.error('Generate error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
