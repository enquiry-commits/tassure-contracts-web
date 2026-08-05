import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

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

    if (!SSO_SHARED_SECRET) {
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

    // Token is valid, client will proceed with Google OAuth
    return NextResponse.json({
      success: true,
      email,
      message: 'Token verified, proceed with Google authentication',
    })
  } catch (err) {
    console.error('[SSO] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
