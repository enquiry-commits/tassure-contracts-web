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

        // Call server to verify token
        const res = await fetch(`/api/sso?token=${encodeURIComponent(ssoToken)}`)
        const data = await res.json()

        if (!res.ok || !data.success) {
          console.error('[SSO Callback] Token verification failed:', data.error)
          router.push(`/login?error=${data.error || 'verification_failed'}`)
          return
        }

        console.log('[SSO Callback] Token verified, starting Google OAuth...')

        // Token is valid, start Google OAuth login
        const supabase = createSupabaseBrowserClient()
        const redirectUrl = `${window.location.origin}/proposal/generator`

        const { error: authError } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: redirectUrl,
          },
        })

        if (authError) {
          console.error('[SSO Callback] OAuth error:', authError)
          router.push(`/login?error=${authError.message || 'oauth_failed'}`)
        }
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
        <p className="text-gray-600">Verifying SSO token and starting Google login...</p>
      </div>
    </div>
  )
}
