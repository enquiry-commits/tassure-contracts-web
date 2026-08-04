'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'

export default function SsoCallbackPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')

  useEffect(() => {
    const handleCallback = async () => {
      if (!token) {
        router.push('/login?error=no_token')
        return
      }

      try {
        // Call the SSO endpoint with the token
        const res = await fetch(`/api/sso?token=${encodeURIComponent(token)}`)
        const data = await res.json()

        if (!res.ok || !data.success) {
          console.error('SSO verification failed:', data.error)
          router.push(`/login?error=${data.error || 'verification_failed'}`)
          return
        }

        // Extract session data
        const session = data.session
        if (!session || !session.access_token) {
          console.error('No session in response')
          router.push('/login?error=no_session')
          return
        }

        // Store session in sessionStorage (Supabase will auto-use it)
        const supabase = createSupabaseBrowserClient()

        // Manually set session in Supabase client
        window.sessionStorage.setItem(
          `sb-${process.env.NEXT_PUBLIC_SUPABASE_URL?.split('/').pop()}-auth-token`,
          JSON.stringify(session)
        )

        console.log('[SSO] Session stored, redirecting to generator')

        // Redirect to proposal generator
        router.push('/proposal/generator')
      } catch (err) {
        console.error('[SSO Callback] Error:', err)
        router.push('/login?error=callback_error')
      }
    }

    handleCallback()
  }, [token, router])

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
        <p className="text-gray-600">Verifying SSO token...</p>
      </div>
    </div>
  )
}
