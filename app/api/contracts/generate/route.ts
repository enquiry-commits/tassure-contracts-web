import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateDocx, PROPOSAL_GENERATOR_CONTRACT_VERSION } from '@/lib/docGenerator'
import { enqueueVisualQaJob } from '@/lib/visual-qa'
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

    if (!companyName || !/[\p{L}\p{N}]/u.test(String(companyName).trim()) || !pic) {
      return NextResponse.json({ error: 'companyName and pic are required' }, { status: 400 })
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
        companyName,
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
    const safeName = companyName.replace(/[^a-zA-Z0-9 _-]/g, '_').trim()
    const storageFileName = `Tassure_Proposal_${safeName.replace(/\s+/g, '_')}_${referenceId}.docx`
    const displayFileName = storageFileName
    const filePath = `contracts/${year}/${month}/${storageFileName}`

    // Fail closed: the generated file is a private draft until a Windows
    // worker opens it in Microsoft Word, renders every page and passes the
    // visual gate. Existing proposals are left untouched until approval.
    const qaJob = await enqueueVisualQaJob(supabase, {
      referenceId,
      clientName: companyName.trim(),
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

    return NextResponse.json({
      success: true,
      referenceId,
      qaRequired: true,
      qaJobId: qaJob.id,
      qaStatus: qaJob.status,
      qaStatusUrl: `/api/visual-qa/${qaJob.id}`,
      replaced: !!existingId,
      generatorContractVersion: PROPOSAL_GENERATOR_CONTRACT_VERSION,
      generatorCommit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'local',
    })
  } catch (err) {
    console.error('Generate error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
