import type { NextRequest } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

export const PROPOSAL_AUTHORIZED_EMAILS = new Set([
  'cindyzhang@tassure.com',
  'samuellng@tassure.com',
  'yeesoon@tassure.com',
  'hoechyi@tassure.com',
  'sengxin@tassure.com',
  'jennylai@tassure.com',
  'shiming@tassure.com',
  'kahye@tassure.com',
  'shemin@tassure.com',
  'minquan@tassure.com',
  'vincent@tassure.com',
  'jaytay@tassure.com',
])

export async function getAuthorizedProposalUser(request: NextRequest): Promise<{ email: string } | null> {
  const authorization = request.headers.get('authorization')
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) return null

  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase.auth.getUser(token)
  const email = data.user?.email?.toLowerCase()
  if (error || !email || !PROPOSAL_AUTHORIZED_EMAILS.has(email)) return null
  return { email }
}
