import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SSO_SHARED_SECRET = process.env.SSO_SHARED_SECRET

// Employee list - add your company employees here
const COMPANY_EMPLOYEES = new Set([
  'esther@tassure.com',
  'chelsea@tassure.com',
  'vincent@tassure.com',
  // Add more employees as needed
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

    // Decode token: format is "email:exp:signature"
    const parts = token.split(':')
    if (parts.length !== 3) {
      return NextResponse.json({ error: 'Invalid token format' }, { status: 400 })
    }

    const [email, expStr, signature] = parts

    // Check expiration (60 seconds only)
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

    // Verify email is in company employee list
    if (!COMPANY_EMPLOYEES.has(email)) {
      return NextResponse.json(
        { error: 'Email not authorized' },
        { status: 403 }
      )
    }

    // Create Supabase admin client for generating auth link
    const supabaseAdmin = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY
    )

    // Generate a sign-in link
    const { data, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: email,
    })

    if (linkError || !data) {
      console.error('Failed to generate link:', linkError)
      return NextResponse.json(
        { error: 'Failed to generate auth link' },
        { status: 500 }
      )
    }

    // Log the actual response structure for debugging
    console.log('generateLink response:', JSON.stringify(data, null, 2))
    console.log('generateLink response type:', typeof data, 'keys:', Object.keys(data || {}))

    // Extract hashed_token from properties (confirmed location from logs)
    const token_hash = (data as any)?.properties?.hashed_token

    if (!token_hash) {
      console.error('No token found in response. Data structure:', data)
      return NextResponse.json(
        { error: 'Failed to extract session token - check logs for response structure' },
        { status: 500 }
      )
    }

    // Verify OTP to get session
    console.log('Calling verifyOtp with token_hash:', token_hash?.substring(0, 20) + '...')
    const { data: sessionData, error: verifyError } =
      await supabaseAdmin.auth.verifyOtp({
        type: 'magiclink',
        email: email,
        token_hash: token_hash,
      })

    if (verifyError) {
      console.error('Failed to verify OTP error:', verifyError)
      return NextResponse.json(
        { error: 'Failed to verify OTP: ' + (verifyError?.message || 'unknown error') },
        { status: 500 }
      )
    }

    if (!sessionData?.session) {
      console.error('No session in verifyOtp response:', sessionData)
      return NextResponse.json(
        { error: 'No session created after OTP verification' },
        { status: 500 }
      )
    }

    // Create response with redirect
    const response = NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/proposal/generator`,
      { status: 302 }
    )

    // Set auth cookies
    const { access_token, refresh_token } = sessionData.session
    response.cookies.set('sb-access-token', access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 3600 * 24 * 7, // 7 days
    })

    response.cookies.set('sb-refresh-token', refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 3600 * 24 * 30, // 30 days
    })

    return response
  } catch (err) {
    console.error('SSO error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
