'use client'

import { useState, useRef } from 'react'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'

interface Org {
  id: string
  name: string
  slug: string
  plan: string
  logo_url?: string
  is_admin_org: boolean
}

interface Member {
  id: string
  email: string
  full_name?: string
  role: string
  created_at: string
}

interface Invite {
  id: string
  token: string
  email?: string
  role: string
  used_at?: string
  expires_at: string
  created_at: string
}

interface Props {
  org: Org
  members: Member[]
  invites: Invite[]
  currentUserId: string
  isOwner: boolean
  isAdmin: boolean
}

const HERMES = '#E8632A'
const BASE = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.sentimetrx.ai'

export default function TeamClient({ org, members: initialMembers, invites: initialInvites, currentUserId, isOwner, isAdmin }: Props) {
  const [members, setMembers]   = useState(initialMembers)
  const [invites, setInvites]   = useState(initialInvites)
  const [logoUrl, setLogoUrl]   = useState(org.logo_url || '')
  const [busy, setBusy]         = useState(false)
  const [msg, setMsg]           = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole]   = useState('owner')
  const [newLink, setNewLink]   = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 4000) }

  async function generateInvite() {
    setBusy(true)
    const res = await fetch('/api/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: org.id, email: inviteEmail || undefined, role: inviteRole }),
    })
    const data = await res.json()
    setBusy(false)
    if (data.error) { flash('Error: ' + data.error); return }
    const link = `${BASE}/invite/${data.token}`
    setNewLink(link)
    setInviteEmail('')
    setInvites(prev => [{ ...data, created_at: new Date().toISOString() }, ...prev])
  }

  function copyLink(token: string) {
    navigator.clipboard.writeText(`${BASE}/invite/${token}`)
    flash('Link copied to clipboard')
  }

  async function changeRole(memberId: string, newRole: string) {
    const res = await fetch('/api/settings/team', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: memberId, role: newRole }),
    })
    if (res.ok) {
      setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role: newRole } : m))
      flash('Role updated')
    }
  }

  async function removeMember(memberId: string) {
    if (!confirm('Remove this member from the org?')) return
    const res = await fetch('/api/settings/team', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: memberId }),
    })
    if (res.ok) {
      setMembers(prev => prev.filter(m => m.id !== memberId))
      flash('Member removed')
    }
  }

  async function uploadLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    const form = new FormData()
    form.append('file', file)
    form.append('org_id', org.id)
    const res = await fetch('/api/org/logo', { method: 'POST', body: form })
    const data = await res.json()
    setBusy(false)
    if (data.logo_url) { setLogoUrl(data.logo_url); flash('Logo updated') }
    else flash('Error: ' + (data.error || 'Upload failed'))
  }

  async function removeLogo() {
    setBusy(true)
    const res = await fetch('/api/org/logo', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: org.id }),
    })
    setBusy(false)
    if (res.ok) { setLogoUrl(''); flash('Logo removed') }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav
        logoUrl={logoUrl}
        orgName={org.name}
        isAdmin={isAdmin}
        currentPage='team'
      />
      <SubHeader crumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Team Settings' }]} />

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-10">
        {msg && (
          <div className="bg-gray-100 border border-gray-200 text-sm text-gray-700 px-4 py-3 rounded-lg">{msg}</div>
        )}

        {/* Org Logo */}
        <section>
          <h2 className="text-lg font-semibold mb-1">Organisation Logo</h2>
          <p className="text-gray-400 text-sm mb-4">Appears top-left on all pages and on the survey widget. PNG or JPG, max 2MB.</p>
          <div className="flex items-center gap-4">
            <div className="w-24 h-12 rounded-lg bg-slate-800 border border-gray-200 flex items-center justify-center overflow-hidden">
              {logoUrl
                ? <img src={logoUrl} alt="logo" className="h-full w-full object-contain p-1" />
                : <span className="text-xs font-bold" style={{ color: HERMES }}>sentimetrx.ai</span>
              }
            </div>
            <div className="flex gap-2">
              <button onClick={() => fileRef.current?.click()} disabled={busy}
                className="text-sm px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-gray-200 transition-colors">
                {logoUrl ? 'Change Logo' : 'Upload Logo'}
              </button>
              {logoUrl && (
                <button onClick={removeLogo} disabled={busy}
                  className="text-sm px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-red-900 border border-gray-200 text-red-400 transition-colors">
                  Remove
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={uploadLogo} />
          </div>
        </section>

        {/* Members */}
        <section>
          <h2 className="text-lg font-semibold mb-4">Team Members</h2>
          <div className="space-y-2">
            {members.map(m => (
              <div key={m.id} className="flex items-center justify-between bg-white rounded-lg px-4 py-3 border border-gray-200">
                <div>
                  <p className="text-sm font-medium">{m.full_name || m.email}</p>
                  {m.full_name && <p className="text-xs text-gray-500">{m.email}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {isOwner && m.id !== currentUserId ? (
                    <>
                      <select value={m.role} onChange={e => changeRole(m.id, e.target.value)}
                        className="text-xs bg-slate-800 border border-gray-200 rounded px-2 py-1 text-gray-300">
                        <option value="owner">Owner</option>
                        <option value="member">Member</option>
                      </select>
                      <button onClick={() => removeMember(m.id)}
                        className="text-xs text-red-400 hover:text-red-300 px-2 py-1 rounded hover:bg-slate-800 transition-colors">
                        Remove
                      </button>
                    </>
                  ) : (
                    <span className="text-xs text-gray-500 capitalize">{m.role}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Invite */}
        {isOwner && (
          <section>
            <h2 className="text-lg font-semibold mb-1">Invite Member</h2>
            <p className="text-gray-400 text-sm mb-4">Generate an invite link to share with a new team member.</p>
            <div className="flex gap-2 flex-wrap">
              <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                placeholder="Email (optional)"
                className="flex-1 min-w-[180px] bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-slate-500" />
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <option value="owner">Owner</option>
                <option value="member">Member</option>
              </select>
              <button onClick={generateInvite} disabled={busy}
                style={{ backgroundColor: HERMES }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50">
                Generate Link
              </button>
            </div>

            {newLink && (
              <div className="mt-3 flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2">
                <span className="text-xs text-gray-400 flex-1 truncate">{newLink}</span>
                <button onClick={() => copyLink(newLink.split('/invite/')[1])}
                  className="text-xs text-white px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 flex-shrink-0">
                  Copy
                </button>
              </div>
            )}

            {invites.length > 0 && (
              <div className="mt-4">
                <p className="text-xs text-gray-500 mb-2">Pending invites</p>
                <div className="space-y-1.5">
                  {invites.map(inv => (
                    <div key={inv.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-gray-200">
                      <div>
                        <span className="text-xs text-gray-400">{inv.email || 'Open invite'}</span>
                        <span className="text-xs text-gray-600 ml-2">expires {new Date(inv.expires_at).toLocaleDateString()}</span>
                      </div>
                      <button onClick={() => copyLink(inv.token)}
                        className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-slate-700 transition-colors">
                        Copy Link
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
