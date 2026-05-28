import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { generateDocx } from '@/lib/docGenerator'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      companyName, date, salutationEn, salutationCn,
      pic, mode, selected, feeOverrides, ccOverrides, sectionMapping,
      existingId, // present when replacing an existing record
    } = body

    if (!companyName || !pic) {
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

    const docBuffer = await generateDocx({
      companyName,
      date: date || new Date().toLocaleDateString('en-SG', { day: '2-digit', month: 'long', year: 'numeric' }),
      salutationEn: salutationEn || 'Dear Management,',
      salutationCn: salutationCn || '尊敬的领导，',
      mode: mode || 'full',
      selected: selected || [],
      feeOverrides: feeOverrides || {},
      ccOverrides: ccOverrides || {},
      sectionMapping,
    })

    // Derive year/month from the referenceId itself so replace keeps original date folder
    const refDatePart = referenceId.slice(0, 8) // YYYYMMDD
    const year = refDatePart.slice(0, 4)
    const month = refDatePart.slice(4, 6)
    const safeName = companyName.replace(/[^a-zA-Z0-9 _-]/g, '_').trim()
    const suffix = mode === 'selected' ? '_Selected' : '_Full'
    const fileName = `Tassure_Proposal 报价_${safeName}_${referenceId}${suffix}.docx`
    const filePath = `contracts/${year}/${month}/${fileName}`

    // Delete old file from storage if replacing
    if (oldFilePath && oldFilePath !== filePath) {
      await supabase.storage.from('contracts').remove([oldFilePath])
    }

    const { error: uploadError } = await supabase.storage
      .from('contracts')
      .upload(filePath, docBuffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: true, // overwrite if same path
      })

    if (uploadError) {
      console.error('Upload error:', uploadError)
      return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 })
    }

    const { data: signedUrlData, error: urlError } = await supabase.storage
      .from('contracts')
      .createSignedUrl(filePath, 60 * 60 * 24 * 7)

    if (urlError || !signedUrlData) {
      return NextResponse.json({ error: 'Failed to create download URL' }, { status: 500 })
    }

    let contract
    if (existingId) {
      // UPDATE existing record
      const { data, error: dbError } = await supabase
        .from('contracts')
        .update({
          client_name: companyName,
          pic,
          file_path: filePath,
          file_url: signedUrlData.signedUrl,
        })
        .eq('id', existingId)
        .select()
        .single()

      if (dbError) {
        console.error('DB update error:', dbError)
        return NextResponse.json({ error: 'Failed to update record' }, { status: 500 })
      }
      contract = data
    } else {
      // INSERT new record
      const { data, error: dbError } = await supabase
        .from('contracts')
        .insert({
          reference_id: referenceId,
          client_name: companyName,
          pic,
          remarks: null,
          file_path: filePath,
          file_url: signedUrlData.signedUrl,
          is_delivered: false,
        })
        .select()
        .single()

      if (dbError) {
        console.error('DB insert error:', dbError)
        return NextResponse.json({ error: 'Failed to save record' }, { status: 500 })
      }
      contract = data
    }

    return NextResponse.json({
      success: true,
      referenceId,
      downloadUrl: signedUrlData.signedUrl,
      contract,
      replaced: !!existingId,
    })
  } catch (err) {
    console.error('Generate error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
