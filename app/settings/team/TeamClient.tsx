'use client'

import { useState, useRef } from 'react'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'
import { MODULE_LABELS, type ModuleFeatures } from '@/lib/types'
import PendingInvitesList, { type PendingInvite } from '@/components/team/PendingInvitesList'

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
  features?: ModuleFeatures | null
  disabled?: boolean
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
  userEmail?: string
  fullName?:  string
  orgFeatures: ModuleFeatures
}

const HERMES = '#E8632A'
const BASE = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.sentimetrx.ai'

export default function TeamClient({ org, members: initialMembers, invites: initialInvites, currentUserId, isOwner, isAdmin, userEmail='', fullName='', orgFeatures }: Props) {
  const [members, setMembers]   = useState(initialMembers)
  const [invites, setInvites]   = useState(initialInvites)
  const [logoUrl, setLogoUrl]   = useState(org.logo_url || '')
  const [busy, setBusy]         = useState(false)
  const [msg, setMsg]           = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole]   = useState('owner')
  const [newLink, setNewLink]   = useState('')
  const [expandedMember, setExpandedMember] = useState<string | null>(null)
  const [savingFeature, setSavingFeature] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const moduleKeys = Object.keys(MODULE_LABELS) as (keyof ModuleFeatures)[]

  async function toggleUserFeature(memberId: string, key: keyof ModuleFeatures) {
    const member = members.find(m => m.id === memberId)
    if (!member) return
    const current = member.features || {}
    const updated = { ...current, [key]: !current[key] }
    setSavingFeature(true)
    try {
      const res = await fetch('/api/settings/team/features', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: memberId, features: updated }),
      })
      if (res.ok) {
        setMembers(prev => prev.map(m => m.id === memberId ? { ...m, features: updated } : m))
        flash('Permissions updated')
      } else {
        const data = await res.json().catch(() => ({}))
        flash('Error: ' + (data.error || 'Failed to save'))
      }
    } catch {
      flash('Error: Network failure')
    } finally {
      setSavingFeature(false)
    }
  }

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
    const sentTo = inviteEmail
    setInviteEmail('')
    setInvites(prev => [{ ...data, created_at: new Date().toISOString() }, ...prev])
    if (data.email_status === 'sent') {
      flash(`Invite emailed to ${sentTo}`)
    } else if (data.email_status === 'failed') {
      flash(`Invite created but email failed — copy the link below and send it manually`)
    }
  }

  function copyLink(token: string) {
    navigator.clipboard.writeText(`${BASE}/invite/${token}`)
    flash('Link copied to clipboard')
  }

  function copyInvite(inv: PendingInvite) {
    navigator.clipboard.writeText(`${BASE}/invite/${inv.token}`)
    flash('Link copied to clipboard')
  }

  async function resendInvite(id: string, email?: string | null) {
    const res = await fetch(`/api/invite/${id}/resend`, { method: 'POST' })
    const data = await res.json()
    if (data.email_status === 'sent')      flash(`Invite re-emailed to ${email || 'invitee'}`)
    else if (data.email_status === 'failed') flash(`Resend failed: ${data.email_error || 'unknown error'}`)
    else                                     flash(`Error: ${data.error || 'Could not resend'}`)
  }

  async function revokeInvite(id: string, email?: string | null) {
    if (!confirm(`Revoke the invite for ${email || 'this user'}?`)) return
    const res = await fetch(`/api/invite/${id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      setInvites(prev => prev.filter(i => i.id !== id))
      flash('Invite revoked')
    } else {
      flash(`Error: ${data.error || 'Could not revoke'}`)
    }
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

  async function toggleDisabled(memberId: string, nextDisabled: boolean) {
    const verb = nextDisabled ? 'Disable login for' : 'Re-enable login for'
    const member = members.find(m => m.id === memberId)
    if (!member) return
    if (!confirm(`${verb} ${member.full_name || member.email}?`)) return
    const res = await fetch('/api/settings/team/disable', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: memberId, disabled: nextDisabled }),
    })
    if (res.ok) {
      setMembers(prev => prev.map(m => m.id === memberId ? { ...m, disabled: nextDisabled } : m))
      flash(nextDisabled ? 'Login disabled' : 'Login re-enabled')
    } else {
      const d = await res.json().catch(() => ({}))
      flash(d?.error || 'Failed to update')
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
        userEmail={userEmail}
        fullName={fullName}
        currentPage='team'
      />
      <SubHeader crumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Team Settings' }]} />

      <div className="max-w-3xl mx-auto px-6 py-10 space-y-10">
        {msg && (
          <div className="bg-amber-50 border border-amber-200 text-sm text-amber-800 px-4 py-3 rounded-lg">{msg}</div>
        )}

        {/* Org Logo */}
        <section>
          <h2 className="text-lg font-semibold mb-1">Organization Logo</h2>
          <p className="text-gray-400 text-sm mb-4">Appears top-left on all pages and on the survey widget. PNG or JPG, max 2MB.</p>
          <div className="flex items-center gap-4">
            <div className="w-24 h-12 rounded-lg bg-white border border-gray-200 flex items-center justify-center overflow-hidden">
              {logoUrl
                ? <img src={logoUrl} alt="logo" className="h-full w-full object-contain p-1" />
                : <span className="text-xs font-bold" style={{ color: HERMES }}>sentimetrx.ai</span>
              }
            </div>
            <div className="flex gap-2">
              <button onClick={() => fileRef.current?.click()} disabled={busy}
                className="text-sm px-3 py-1.5 rounded-lg hover:opacity-80 border transition-colors font-semibold"
                style={{ background: HERMES, color: 'white', borderColor: HERMES }}>
                {logoUrl ? 'Change Logo' : 'Upload Logo'}
              </button>
              {logoUrl && (
                <button onClick={removeLogo} disabled={busy}
                  className="text-sm px-3 py-1.5 rounded-lg hover:bg-red-50 border border-red-300 text-red-500 transition-colors font-semibold">
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
              <div key={m.id} className="bg-white rounded-lg border border-gray-200" style={m.disabled ? { opacity: 0.6 } : undefined}>
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div>
                      <p className="text-sm font-medium">
                        {m.full_name || m.email}
                        {m.disabled && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-gray-200 text-gray-700 font-semibold">Disabled</span>}
                      </p>
                      {m.full_name && <p className="text-xs text-gray-500">{m.email}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isOwner && m.id !== currentUserId ? (
                      <>
                        <button onClick={() => setExpandedMember(expandedMember === m.id ? null : m.id)}
                          className="text-xs px-2 py-1 rounded border transition-colors font-semibold"
                          style={expandedMember === m.id
                            ? { background: HERMES, color: 'white', borderColor: HERMES }
                            : { background: 'white', color: '#6B7280', borderColor: '#D1D5DB' }
                          }>
                          Permissions
                        </button>
                        <select value={m.role} onChange={e => changeRole(m.id, e.target.value)}
                          className="text-xs bg-white border border-gray-300 rounded px-2 py-1 text-gray-600 focus:border-orange-400 outline-none">
                          <option value="owner">Owner</option>
                          <option value="member">Member</option>
                        </select>
                        <button onClick={() => toggleDisabled(m.id, !m.disabled)}
                          className="text-xs px-2 py-1 rounded border transition-colors font-semibold"
                          style={m.disabled
                            ? { color: '#16a34a', borderColor: '#bbf7d0', background: '#f0fdf4' }
                            : { color: '#a16207', borderColor: '#fde68a', background: '#fffbeb' }
                          }>
                          {m.disabled ? 'Re-enable' : 'Disable'}
                        </button>
                        <button onClick={() => removeMember(m.id)}
                          className="text-xs text-red-500 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 border border-transparent hover:border-red-200 transition-colors font-semibold">
                          Remove
                        </button>
                      </>
                    ) : (
                      <span className="text-xs text-gray-500 capitalize">{m.role}</span>
                    )}
                  </div>
                </div>
                {expandedMember === m.id && (
                  <div className="border-t border-gray-100 px-4 py-3">
                    <p className="text-xs text-gray-500 mb-2">Module access for this user</p>
                    <div className="grid grid-cols-2 gap-2">
                      {moduleKeys.map(key => {
                        const orgEnabled = !!orgFeatures[key]
                        const userEnabled = !!(m.features || {})[key]
                        return (
                          <div key={key} className="flex items-center justify-between py-1.5 px-2 rounded"
                            style={{ opacity: orgEnabled ? 1 : 0.5 }}>
                            <span className="text-sm text-gray-700">{MODULE_LABELS[key]}</span>
                            {orgEnabled ? (
                              <ToggleSwitch
                                enabled={userEnabled}
                                onToggle={() => toggleUserFeature(m.id, key)}
                                disabled={savingFeature}
                              />
                            ) : (
                              <span className="text-xs text-gray-400 italic">Not available</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                    {savingFeature && <p className="text-xs text-gray-400 mt-2">Saving...</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Invite */}
        {isOwner && (
          <section>
            <h2 className="text-lg font-semibold mb-1">Invite Member</h2>
            <p className="text-gray-400 text-sm mb-4">Enter an email to send a branded invitation. The link is also shown below as a backup.</p>
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
                <PendingInvitesList
                  invites={invites as PendingInvite[]}
                  onResend={resendInvite}
                  onCopy={copyInvite}
                  onRevoke={revokeInvite}
                />
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

function ToggleSwitch({ enabled, onToggle, disabled }: { enabled: boolean; onToggle: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      style={{
        display:     'inline-flex',
        alignItems:  'center',
        width:       44,
        height:      24,
        borderRadius: 9999,
        padding:     2,
        background:  enabled ? '#E8632A' : '#D1D5DB',
        transition:  'background 0.2s',
        border:      'none',
        cursor:      disabled ? 'not-allowed' : 'pointer',
        opacity:     disabled ? 0.6 : 1,
        flexShrink:  0,
      }}>
      <span style={{
        display:      'inline-block',
        width:        20,
        height:       20,
        borderRadius: 9999,
        background:   'white',
        boxShadow:    '0 1px 3px rgba(0,0,0,0.2)',
        transform:    enabled ? 'translateX(20px)' : 'translateX(0)',
        transition:   'transform 0.2s',
      }} />
    </button>
  )
}
