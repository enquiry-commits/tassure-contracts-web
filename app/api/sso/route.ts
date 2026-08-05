import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const SSO_SHARED_SECRET = process.env.SSO_SHARED_SECRET
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const COMPANY_EMPLOYEES = new Set([
  'esther@tassure.com',
  'chelsea@tassure.com',
  'vincent@tassure.com',
])

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token')

    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 })
    }

    if (!SSO_SHARED_SECRET || !SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
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

    console.log('[SSO] Token verified for email:', email)

    // Step 1: Use admin client to generate magic link
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    })

    if (linkError || !linkData?.properties?.hashed_token) {
      console.error('[SSO] Failed to generate link:', linkError)
      return NextResponse.json(
        {
          error: 'Failed to generate session link',
          detail: linkError?.message || 'Unknown generateLink error',
          code: linkError?.status,
        },
        { status: 500 }
      )
    }

    const hashedToken = linkData.properties.hashed_token

    // Step 2: Use server client to verify the OTP (with cookie handling)
    const supabaseServer = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        },
      },
    })

    const { data: sessionData, error: verifyError } = await supabaseServer.auth.verifyOtp({
      type: 'magiclink',
      token_hash: hashedToken,
    })

    if (verifyError || !sessionData?.session) {
      console.error('[SSO] Failed to verify OTP:', verifyError)
      return NextResponse.json(
        {
          error: 'Failed to create session',
          detail: verifyError?.message || 'Unknown verify error',
          code: verifyError?.status,
        },
        { status: 500 }
      )
    }

    console.log('[SSO] Session created successfully')

    // Return complete session data for client-side storage
    return NextResponse.json({
      success: true,
      email,
      session: sessionData.session,
    })
  } catch (err) {
    console.error('[SSO] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
