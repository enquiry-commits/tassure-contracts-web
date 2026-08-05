'use client'

import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'

export default function SsoCallbackContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const ssoToken = searchParams.get('token')
  const handledRef = useRef(false)

  useEffect(() => {
    if (handledRef.current) return
    handledRef.current = true

    const handleCallback = async () => {
      const callbackStartedAt = performance.now()

      if (!ssoToken) {
        router.push('/login?error=no_token')
        return
      }

      try {
        console.log('[SSO Callback] Starting SSO callback...')

        // Step 1: Fetch hashed_token from server
        const apiFetchStartedAt = performance.now()
        const res = await fetch(`/api/sso?token=${encodeURIComponent(ssoToken)}`)
        const apiFetchMs = Math.round(performance.now() - apiFetchStartedAt)

        const parseStartedAt = performance.now()
        const data = await res.json()
        const parseMs = Math.round(performance.now() - parseStartedAt)

        if (!res.ok || !data.success || !data.hashedToken) {
          console.error('[SSO Callback] Token verification failed:', data.error)
          router.push(`/login?error=${data.error || 'verification_failed'}`)
          return
        }

        const { hashedToken, email, timings: serverTimings } = data

        console.log('[SSO Performance - Server]', {
          tokenValidationMs: serverTimings?.tokenValidationMs,
          generateLinkMs: serverTimings?.generateLinkMs,
          totalApiMs: serverTimings?.totalApiMs,
          region: serverTimings?.region,
        })

        console.log('[SSO Performance - Network]', {
          apiFetchMs,
          parseMs,
        })

        // Step 2: Verify OTP on client side
        // This reduces server load and network latency by doing OTP verification locally
        const verifyOtpStartedAt = performance.now()
        const supabase = createSupabaseBrowserClient()

        const {
          data: verifyData,
          error: verifyError,
        } = await supabase.auth.verifyOtp({
          type: 'magiclink',
          token_hash: hashedToken,
        })

        const verifyOtpMs = Math.round(performance.now() - verifyOtpStartedAt)

        if (verifyError || !verifyData?.session) {
          console.error(
            '[SSO Callback] OTP verification failed in', verifyOtpMs, 'ms:',
            verifyError?.message
          )

          router.push(
            `/login?error=${encodeURIComponent(
              verifyError?.message || 'otp_verification_failed'
            )}`
          )
          return
        }

        const totalMs = Math.round(performance.now() - callbackStartedAt)

        console.log('[SSO Performance - Total]', {
          apiFetchMs,
          parseMs,
          verifyOtpMs,
          totalMs,
        })

        console.log('[SSO Callback] OTP verified successfully, redirecting to generator')

        // Supabase client automatically saved session to sessionStorage via the verifyOtp call
        // Use router.replace for client-side navigation (faster than full page reload)
        router.replace('/proposal/generator')
      } catch (err) {
        console.error('[SSO Callback] Error:', err)
        router.push('/login?error=callback_error')
      }
    }

    handleCallback()
  }, [ssoToken, router])

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
        <p className="text-gray-600">Verifying SSO token and creating session...</p>
      </div>
    </div>
  )
}
