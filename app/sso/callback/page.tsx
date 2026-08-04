'use client'

import { Suspense } from 'react'
import SsoCallbackContent from './content'

export const dynamic = 'force-dynamic'

export default function SsoCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
            <p className="text-gray-600">Processing SSO token...</p>
          </div>
        </div>
      }
    >
      <SsoCallbackContent />
    </Suspense>
  )
}
