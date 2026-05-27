import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

const PIC_ORDER = ['Cindy', 'Hoe Chyi', 'Seng Xin', 'Jenny', 'Shi Ming', 'Kah Ye', 'Vincent']

export async function GET() {
  try {
    const supabase = createSupabaseAdminClient()

    const { data, error } = await supabase
      .from('pic_list')
      .select('id, name')
      .eq('is_active', true)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const sorted = [...(data ?? [])].sort((a, b) => {
      const ai = PIC_ORDER.indexOf(a.name)
      const bi = PIC_ORDER.indexOf(b.name)
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
    })

    return NextResponse.json({ pics: sorted })
  } catch (err) {
    console.error('PIC list error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
