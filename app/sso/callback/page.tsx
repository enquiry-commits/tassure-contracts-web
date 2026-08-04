'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default function SsoCallbackPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const ssoToken = searchParams.get('token')

  useEffect(() => {
    const handleCallback = async () => {
      if (!ssoToken) {
        router.push('/login?error=no_token')
        return
      }

      try {
        // Call the SSO endpoint to verify token and get magic link
        const res = await fetch(`/api/sso?token=${encodeURIComponent(ssoToken)}`)
        const data = await res.json()

        if (!res.ok || !data.success) {
          console.error('[SSO Callback] SSO verification failed:', data.error)
          router.push(`/login?error=${data.error || 'verification_failed'}`)
          return
        }

        if (!data.token || !data.email) {
          console.error('[SSO Callback] Missing verification token or email')
          router.push('/login?error=no_verification_token')
          return
        }

        console.log('[SSO Callback] Redirecting to verify page')

        // Redirect to verify page with the token and email
        router.push(
          `/sso/verify?token=${encodeURIComponent(data.token)}&email=${encodeURIComponent(
            data.email
          )}`
        )
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
        <p className="text-gray-600">Processing SSO token...</p>
      </div>
    </div>
  )
}
