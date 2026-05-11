'use client'

import { useState } from 'react'

export interface PendingInvite {
  id:         string
  token:      string
  email:      string | null
  used_at?:   string | null
  expires_at: string
}

interface Props {
  invites:   PendingInvite[]
  onResend:  (id: string, email: string | null) => void | Promise<void>
  onCopy:    (invite: PendingInvite) => void | Promise<void>
  onRevoke:  (id: string, email: string | null) => void | Promise<void>
  emptyText?: string
}

function inviteStatus(inv: PendingInvite) {
  if (inv.used_at)                           return { label: 'Used',    cls: 'bg-green-100 text-green-700' }
  if (new Date(inv.expires_at) < new Date()) return { label: 'Expired', cls: 'bg-red-100 text-red-700' }
  return { label: 'Pending', cls: 'bg-yellow-100 text-yellow-700' }
}

export default function PendingInvitesList({ invites, onResend, onCopy, onRevoke, emptyText = 'No pending invites' }: Props) {
  const [copiedId, setCopiedId] = useState<string | null>(null)

  if (invites.length === 0) {
    return <p className="text-xs text-gray-400">{emptyText}</p>
  }

  const handleCopy = async (inv: PendingInvite) => {
    await onCopy(inv)
    setCopiedId(inv.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div className="flex flex-col divide-y divide-gray-200">
      {invites.map(inv => {
        const status     = inviteStatus(inv)
        const accepted   = !!inv.used_at
        const expired    = new Date(inv.expires_at) < new Date()
        const actionable = !accepted && !expired
        return (
          <div key={inv.id} className="flex items-center justify-between py-3 gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={'text-xs px-2 py-0.5 rounded-full font-medium ' + status.cls}>{status.label}</span>
                <span className="text-xs text-gray-700 truncate">{inv.email || 'Open invite'}</span>
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                Expires {new Date(inv.expires_at).toLocaleDateString()}
                {inv.used_at && ' · Accepted ' + new Date(inv.used_at).toLocaleDateString()}
              </div>
            </div>
            {actionable && (
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  onClick={() => onResend(inv.id, inv.email)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-slate-700 hover:text-white text-slate-700 transition-colors"
                >
                  Resend
                </button>
                <button
                  onClick={() => handleCopy(inv)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-slate-700 hover:text-white text-slate-700 transition-colors"
                >
                  {copiedId === inv.id ? 'Copied!' : 'Copy Link'}
                </button>
                <button
                  onClick={() => onRevoke(inv.id, inv.email)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-600 hover:text-white text-red-600 transition-colors"
                >
                  Revoke
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
