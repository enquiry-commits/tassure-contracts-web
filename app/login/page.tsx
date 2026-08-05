'use client'

import { Suspense } from 'react'
import LoginContent from './content'

export const dynamic = 'force-dynamic'

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
          <div className="w-full max-w-sm">
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold text-gray-900">Sign In</h1>
              <p className="text-sm text-gray-500 mt-1">Tassure Proposal Generator</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
            </div>
          </div>
        </main>
      }
    >
      <LoginContent />
    </Suspense>
  )
}
