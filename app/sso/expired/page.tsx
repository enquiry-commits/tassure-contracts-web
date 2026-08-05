'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export default function SsoExpiredPage() {
  useEffect(() => {
    // Clear SSO markers when user lands here
    sessionStorage.removeItem('sso_entry')
  }, [])

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-block p-3 bg-yellow-100 rounded-full mb-4">
            <svg className="w-8 h-8 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Session Expired</h1>
          <p className="text-sm text-gray-500 mt-2">Your SSO session has expired</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-6">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3">
            <p className="text-sm text-yellow-800">
              Your session has expired. Please return to <span className="font-semibold">Tassure Invoice</span> and access this tool via SSO link again.
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              <span className="font-medium">Next steps:</span>
            </p>
            <ol className="text-sm text-gray-600 space-y-2 list-decimal list-inside">
              <li>Go back to Tassure Invoice</li>
              <li>Click the SSO link again</li>
              <li>You will be automatically logged in</li>
            </ol>
          </div>

          <Link
            href="/login"
            className="block w-full bg-gray-900 hover:bg-gray-800 text-white font-medium py-3 rounded-lg transition-colors text-sm text-center"
          >
            Back to Login
          </Link>
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          Tassure Proposal Generator
        </p>
      </div>
    </main>
  )
}
