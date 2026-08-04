'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase'

export default function SsoVerifyContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const email = searchParams.get('email')

  useEffect(() => {
    const handleVerification = async () => {
      if (!token || !email) {
        router.push('/login?error=missing_params')
        return
      }

      try {
        const supabase = createSupabaseBrowserClient()

        // Verify the OTP token to get session
        const { data, error } = await supabase.auth.verifyOtp({
          email,
          token,
          type: 'magiclink',
        })

        if (error || !data?.session) {
          console.error('[SSO Verify] Verification failed:', error)
          router.push(`/login?error=${error?.message || 'verification_failed'}`)
          return
        }

        console.log('[SSO Verify] Session verified, redirecting to generator')

        // Session is automatically stored in sessionStorage by Supabase client
        // Redirect to proposal generator
        router.push('/proposal/generator')
      } catch (err) {
        console.error('[SSO Verify] Error:', err)
        router.push('/login?error=verify_error')
      }
    }

    handleVerification()
  }, [token, email, router])

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
        <p className="text-gray-600">Verifying login...</p>
      </div>
    </div>
  )
}
