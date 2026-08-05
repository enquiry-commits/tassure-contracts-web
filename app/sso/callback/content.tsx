'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function SsoCallbackContent() {
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
        console.log('[SSO Callback] Verifying token on server...')

        // Call server to verify token and create session
        const res = await fetch(`/api/sso?token=${encodeURIComponent(ssoToken)}`)
        const data = await res.json()

        if (!res.ok || !data.success || !data.session) {
          console.error('[SSO Callback] Token verification failed:', data.error)
          router.push(`/login?error=${data.error || 'verification_failed'}`)
          return
        }

        console.log('[SSO Callback] Session created, storing to sessionStorage...')

        // Store session in sessionStorage
        const session = data.session
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const ref = supabaseUrl?.split('/').pop()
        window.sessionStorage.setItem(
          `sb-${ref}-auth-token`,
          JSON.stringify(session)
        )

        // Mark this as SSO entry to prevent fallback to login
        window.sessionStorage.setItem('sso_entry', 'true')

        console.log('[SSO Callback] Session stored, redirecting to generator')

        // Redirect to proposal generator
        router.push('/proposal/generator')
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
