'use client'

import { useState } from 'react'

const HERMES = '#E8632A'

interface Props {
  type: 'study' | 'campaign'
  targetId: string
}

export default function ShareButton({ type, targetId }: Props) {
  const [open, setOpen] = useState(false)
  const [expiry, setExpiry] = useState('7d')
  const [creating, setCreating] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const create = async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, target_id: targetId, expires_in: expiry }),
      })
      if (res.ok) {
        const data = await res.json()
        setShareUrl(data.url)
      }
    } finally { setCreating(false) }
  }

  const copy = () => {
    if (shareUrl) {
      void navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="text-xs px-3 py-1.5 rounded-lg font-medium transition-all"
        style={{ background: '#f3f4f6', color: '#4b5563', border: '1px solid #e5e7eb' }}>
        Share
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { setOpen(false); setShareUrl(null) }}>
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-gray-800 text-sm">Share Dashboard</h3>
          <button onClick={() => { setOpen(false); setShareUrl(null) }} className="text-gray-400 hover:text-gray-600 text-lg">&times;</button>
        </div>

        {!shareUrl ? (
          <>
            <p className="text-xs text-gray-500 mb-3">Create a read-only link that anyone can view without logging in.</p>
            <div className="mb-4">
              <label className="text-xs font-medium text-gray-600 block mb-1">Link expires in</label>
              <div className="flex gap-2">
                {[{ key: '24h', label: '24 hours' }, { key: '7d', label: '7 days' }, { key: '30d', label: '30 days' }].map(opt => (
                  <button key={opt.key} onClick={() => setExpiry(opt.key)}
                    className={'text-xs px-3 py-1.5 rounded-lg font-medium transition-all ' +
                      (expiry === opt.key ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200')}
                    style={expiry === opt.key ? { background: HERMES } : {}}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={() => { void create() }} disabled={creating}
              className="w-full py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50"
              style={{ background: HERMES }}>
              {creating ? 'Creating...' : 'Create Share Link'}
            </button>
          </>
        ) : (
          <>
            <div className="bg-gray-50 rounded-lg p-3 break-all text-xs text-gray-700 mb-3 border border-gray-200">
              {shareUrl}
            </div>
            <button onClick={copy}
              className="w-full py-2 rounded-lg text-white text-sm font-medium"
              style={{ background: HERMES }}>
              {copied ? '✓ Copied!' : 'Copy Link'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
