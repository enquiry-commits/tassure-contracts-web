import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const SSO_SHARED_SECRET = process.env.SSO_SHARED_SECRET
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
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

    console.log('[SSO] Token verified for email:', email)

    // Use admin client to create session directly
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Get or create user
    const { data: userData } = await supabase.auth.admin.listUsers()
    let user = userData?.users?.find((u: any) => u.email === email)

    if (!user) {
      // Create user if doesn't exist
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { sso_login: true },
      })
      if (createError || !newUser?.user?.id) {
        console.error('[SSO] Failed to create user:', createError)
        return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
      }
      user = newUser.user
    }

    // Generate magic link to create session
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/sso/verify`,
      },
    })

    if (linkError || !linkData?.properties?.hashed_token) {
      console.error('[SSO] Failed to generate link:', linkError)
      return NextResponse.json({ error: 'Failed to generate session link' }, { status: 500 })
    }

    console.log('[SSO] Magic link generated, returning verification token')

    // Return the hashed token for client-side verification
    return NextResponse.json({
      success: true,
      email,
      token: linkData.properties.hashed_token,
      redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/sso/verify`,
    })
  } catch (err) {
    console.error('[SSO] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
