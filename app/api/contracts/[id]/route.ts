import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = createSupabaseAdminClient()

    // Get file_path before deleting
    const { data: contract, error: fetchError } = await supabase
      .from('contracts')
      .select('file_path')
      .eq('id', id)
      .single()

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 404 })
    }

    // Delete file from storage
    if (contract.file_path) {
      await supabase.storage.from('contracts').remove([contract.file_path])
    }

    // Delete DB record
    const { error: dbError } = await supabase.from('contracts').delete().eq('id', id)

    if (dbError) {
      return NextResponse.json({ error: dbError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Delete error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
