import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const SSO_SHARED_SECRET = process.env.SSO_SHARED_SECRET
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const COMPANY_EMPLOYEES = new Set([
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
])

export async function GET(req: NextRequest) {
  const requestStartedAt = performance.now()

  try {
    const token = req.nextUrl.searchParams.get('token')

    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 })
    }

    if (!SSO_SHARED_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }

    // Decode SSO token: format is "email:exp:signature"
    const parts = token.split(':')
    if (parts.length !== 3) {
      return NextResponse.json({ error: 'Invalid token format' }, { status: 400 })
    }

    const [email, expStr, signature] = parts

    // Verify token expiration
    const exp = parseInt(expStr, 10)
    const now = Math.floor(Date.now() / 1000)
    if (isNaN(exp) || now > exp) {
      return NextResponse.json({ error: 'Token expired' }, { status: 401 })
    }

    // Verify HMAC signature
    const payload = `${email}:${expStr}`
    const expectedSignature = crypto
      .createHmac('sha256', SSO_SHARED_SECRET)
      .update(payload)
      .digest('hex')

    if (signature !== expectedSignature) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
    }

    // Verify email is authorized
    if (!COMPANY_EMPLOYEES.has(email)) {
      return NextResponse.json({ error: 'Email not authorized' }, { status: 403 })
    }

    const tokenValidationMs = Math.round(performance.now() - requestStartedAt)
    console.log('[SSO] Token validated in', tokenValidationMs, 'ms for email:', email)

    // Generate magic link (client will handle OTP verification)
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    const generateLinkStartedAt = performance.now()
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    })
    const generateLinkMs = Math.round(performance.now() - generateLinkStartedAt)

    if (linkError || !linkData?.properties?.hashed_token) {
      console.error('[SSO] generateLink failed in', generateLinkMs, 'ms:', linkError?.message)
      return NextResponse.json(
        {
          error: 'Failed to generate session link',
          detail: linkError?.message || 'Unknown error',
          code: linkError?.status,
        },
        { status: 500 }
      )
    }

    const totalApiMs = Math.round(performance.now() - requestStartedAt)
    const hashedToken = linkData.properties.hashed_token

    console.log('[SSO] API completed in', totalApiMs, 'ms (validation:', tokenValidationMs, 'ms, generateLink:', generateLinkMs, 'ms)')

    // Return hashed_token for client-side OTP verification
    // This optimizes by letting the client handle OTP verification,
    // reducing server-side Supabase calls and network latency
    const response = NextResponse.json({
      success: true,
      email,
      hashedToken,
      timings: {
        tokenValidationMs,
        generateLinkMs,
        totalApiMs,
        region: process.env.VERCEL_REGION || 'unknown',
      },
    })

    // Prevent caching
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')

    return response
  } catch (err) {
    console.error('[SSO] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
