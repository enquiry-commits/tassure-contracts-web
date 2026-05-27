import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { remarks } = body

    if (typeof remarks !== 'string' && remarks !== null) {
      return NextResponse.json({ error: 'remarks must be a string or null' }, { status: 400 })
    }

    const supabase = createSupabaseAdminClient()

    const { data, error } = await supabase
      .from('contracts')
      .update({ remarks: remarks?.trim() || null })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, contract: data })
  } catch (err) {
    console.error('Remarks update error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
