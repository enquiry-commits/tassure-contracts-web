'use client'

import { useState } from 'react'

interface Props {
  contractId: string
  initialValue: boolean
  onToggle?: (newValue: boolean) => void
}

export default function DeliveryToggle({ contractId, initialValue, onToggle }: Props) {
  const [isDelivered, setIsDelivered] = useState(initialValue)
  const [loading, setLoading] = useState(false)

  async function handleToggle() {
    const newValue = !isDelivered
    setLoading(true)

    try {
      const res = await fetch(`/api/contracts/${contractId}/delivery`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_delivered: newValue }),
      })

      if (res.ok) {
        setIsDelivered(newValue)
        onToggle?.(newValue)
      } else {
        // revert on failure
        console.error('Toggle failed')
      }
    } catch {
      console.error('Toggle error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleToggle}
      disabled={loading}
      title={isDelivered ? 'Mark as not delivered' : 'Mark as delivered'}
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
        isDelivered
          ? 'bg-green-100 text-green-700 hover:bg-green-200'
          : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
      } ${loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      {isDelivered ? (
        <>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
          Delivered
        </>
      ) : (
        <>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Pending
        </>
      )}
    </button>
  )
}
