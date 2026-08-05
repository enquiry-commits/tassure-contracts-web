'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'

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

        console.log('[SSO Callback] Session received, persisting with Supabase...')

        const session = data.session
        const supabase = createSupabaseBrowserClient()

        const {
          data: sessionResult,
          error: sessionError,
        } = await supabase.auth.setSession({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        })

        if (sessionError || !sessionResult.session) {
          console.error(
            '[SSO Callback] Failed to persist Supabase session:',
            sessionError
          )

          router.push(
            `/login?error=${encodeURIComponent(
              sessionError?.message || 'session_persist_failed'
            )}`
          )
          return
        }

        console.log('[SSO Callback] Supabase session persisted successfully')

        // Use window.location.replace to fully reload and initialize Supabase client
        window.location.replace('/proposal/generator')
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
