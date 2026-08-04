import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SSO_SHARED_SECRET = process.env.SSO_SHARED_SECRET

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

    if (!SSO_SHARED_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      )
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
      return NextResponse.json(
        { error: 'Email not authorized' },
        { status: 403 }
      )
    }

    console.log('[SSO] Token verified for email:', email)

    const supabaseAdmin = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY
    )

    // Step 1: Ensure user exists (create or get existing)
    let userId: string
    const { data: existingUser } = await supabaseAdmin.auth.admin.listUsers()
    const user = existingUser?.users?.find((u: any) => u.email === email)

    if (user) {
      userId = user.id
      console.log('[SSO] User exists:', userId)
    } else {
      const { data: newUser, error: createError } =
        await supabaseAdmin.auth.admin.createUser({
          email: email,
          email_confirm: true,
          user_metadata: {
            sso_login: true,
            sso_timestamp: new Date().toISOString(),
          },
        })

      if (createError) {
        console.error('[SSO] Failed to create user:', createError)
        return NextResponse.json(
          { error: 'Failed to create user account' },
          { status: 500 }
        )
      }

      userId = newUser?.user?.id || ''
      console.log('[SSO] User created:', userId)
    }

    // Step 2: Generate magic link for creating session
    const { data: linkData, error: linkError } =
      await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email: email,
      })

    if (linkError || !linkData) {
      console.error('[SSO] Failed to generate link:', linkError)
      return NextResponse.json(
        { error: 'Failed to generate auth link' },
        { status: 500 }
      )
    }

    const token_hash = (linkData as any)?.properties?.hashed_token
    if (!token_hash) {
      console.error('[SSO] No token in link data')
      return NextResponse.json(
        { error: 'Failed to extract token' },
        { status: 500 }
      )
    }

    // Step 3: Verify the magic link token to create session
    const { data: sessionData, error: verifyError } =
      await supabaseAdmin.auth.verifyOtp({
        type: 'email',
        token_hash: token_hash,
      })

    if (verifyError) {
      console.error('[SSO] verifyOtp failed:', verifyError)
      return NextResponse.json(
        { error: 'Failed to create session: ' + verifyError.message },
        { status: 500 }
      )
    }

    if (!sessionData?.session?.access_token) {
      console.error('[SSO] No access token in session:', sessionData)
      return NextResponse.json(
        { error: 'No session created' },
        { status: 500 }
      )
    }

    // Step 4: Set cookies and redirect
    const { access_token, refresh_token } = sessionData.session

    console.log('[SSO] Session created successfully, setting cookies')

    const response = NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/proposal/generator`,
      { status: 302 }
    )

    response.cookies.set('sb-access-token', access_token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 3600 * 24 * 7,
      path: '/',
    })

    response.cookies.set('sb-refresh-token', refresh_token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 3600 * 24 * 30,
      path: '/',
    })

    console.log('[SSO] Redirecting to proposal generator')
    return response
  } catch (err) {
    console.error('[SSO] Error:', err)
    return NextResponse.json(
      { error: 'Internal server error', details: String(err) },
      { status: 500 }
    )
  }
}
