import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date')
    const pic = searchParams.get('pic')

    const supabase = createSupabaseAdminClient()

    let query = supabase
      .from('contracts')
      .select('*')
      .order('created_at', { ascending: false })

    if (date) {
      const start = `${date}T00:00:00.000Z`
      const end = `${date}T23:59:59.999Z`
      query = query.gte('created_at', start).lte('created_at', end)
    }

    if (pic) {
      query = query.eq('pic', pic)
    }

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Refresh signed URLs that may have expired
    const refreshed = await Promise.all(
      (data || []).map(async (contract) => {
        const { data: urlData } = await supabase.storage
          .from('contracts')
          .createSignedUrl(contract.file_path, 60 * 60 * 24 * 7)
        return {
          ...contract,
          file_url: urlData?.signedUrl ?? contract.file_url,
        }
      })
    )

    return NextResponse.json({ contracts: refreshed })
  } catch (err) {
    console.error('List error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
