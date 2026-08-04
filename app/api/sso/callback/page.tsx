'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function SSOCallback() {
  const router = useRouter()

  useEffect(() => {
    // Extract access token and refresh token from cookies
    const cookies = document.cookie.split(';').reduce((acc: Record<string, string>, cookie) => {
      const [key, value] = cookie.trim().split('=')
      acc[key] = decodeURIComponent(value)
      return acc
    }, {})

    const accessToken = cookies['sb-access-token']
    const refreshToken = cookies['sb-refresh-token']

    console.log('[SSO Callback] Found tokens:', {
      hasAccessToken: !!accessToken,
      hasRefreshToken: !!refreshToken,
    })

    if (accessToken && refreshToken) {
      // Store in sessionStorage so Supabase client can find it
      const session = {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'bearer',
        type: 'signup',
        user: {
          id: '', // Will be populated by Supabase
          email: '', // Will be populated by Supabase
        }
      }

      sessionStorage.setItem('sb-auth-token', JSON.stringify(session))
      console.log('[SSO Callback] Stored session in sessionStorage')

      // Redirect to proposal generator
      router.replace('/proposal/generator')
    } else {
      console.error('[SSO Callback] No tokens found in cookies')
      router.replace('/login')
    }
  }, [router])

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">Completing sign in...</p>
      </div>
    </div>
  )
}
