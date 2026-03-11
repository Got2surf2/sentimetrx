'use client'

import { useState, useRef } from 'react'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'
import OrgFeatureToggles from '@/components/analyze/OrgFeatureToggles'
import Link from 'next/link'

interface Member  { id: string; email: string; full_name: string | null; role: string; created_at: string }
interface Study   { id: string; guid: string; name: string; bot_name: string; bot_emoji: string; status: string; visibility: string; created_at: string; response_count: number }
interface Invite  { id: string; token: string; email: string | null; role: string; used_at: string | null; expires_at: string; created_at: string; invite_url: string }
interface Org     { id: string; name: string; slug: string; plan: string; is_admin_org: boolean; logo_url?: string; features?: { analyze?: boolean } }

interface Props {
  org:           Org
  members:       Member[]
  studies:       Study[]
  invites:       Invite[]
  baseUrl:       string
  currentUserId: string
  userEmail?:    string
}

export default function AdminClientDetail({ org, members, studies: initialStudies, invites: initialInvites, baseUrl, currentUserId, userEmail='' }: Props) {
  const [studies,       setStudies]       = useState(initialStudies)
  const [invites,       setInvites]       = useState(initialInvites)
  const [togglingStudy, setTogglingStudy] = useState<string | null>(null)
  const [copiedInvite,  setCopiedInvite]  = useState<string | null>(null)
  const [generatingInv, setGeneratingInv] = useState(false)
  const [inviteEmail,   setInviteEmail]   = useState('')
  const [showInvForm,   setShowInvForm]   = useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [orgPlan,       setOrgPlan]       = useState(org.plan)
  const [togglingPlan,  setTogglingPlan]  = useState(false)
  const [logoUrl,       setLogoUrl]       = useState(org.logo_url || '')
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoMsg,       setLogoMsg]       = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const statusColor = (s: string) => {
    if (s === 'active')  return 'bg-green-500/15 text-green-400'
    if (s === 'draft')   return 'bg-slate-700/50 text-gray-500'
    if (s === 'paused')  return 'bg-yellow-500/15 text-yellow-400'
    if (s === 'closed')  return 'bg-red-500/15 text-red-400'
    return 'bg-slate-700 text-gray-500'
  }

  const handleToggleStudyStatus = async (study: Study) => {
    const newStatus = study.status === 'closed' ? 'active' : 'closed'
    setTogglingStudy(study.id)
    setError(null)
    try {
      const res = await fetch('/api/studies/' + study.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) throw new Error('Failed to update status')
      setStudies(prev => prev.map(s => s.id === study.id ? { ...s, status: newStatus } : s))
    } catch {
      setError('Failed to update study status.')
    } finally {
      setTogglingStudy(null)
    }
  }

  const handleTogglePlan = async () => {
    const newPlan = orgPlan === 'suspended' ? 'active' : 'suspended'
    setTogglingPlan(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/clients/' + org.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: newPlan }),
      })
      if (!res.ok) throw new Error('Failed')
      setOrgPlan(newPlan)
    } catch {
      setError('Failed to update organization plan.')
    } finally {
      setTogglingPlan(false)
    }
  }

  const handleGenerateInvite = async () => {
    setGeneratingInv(true)
    setError(null)
    try {
      const res = await fetch('/api/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: org.id, email: inviteEmail || undefined, role: 'owner' }),
      })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      const inviteUrl = baseUrl + '/invite/' + data.token
      setInvites(prev => [{ ...data, invite_url: inviteUrl }, ...prev])
      setInviteEmail('')
      setShowInvForm(false)
    } catch {
      setError('Failed to generate invite link.')
    } finally {
      setGeneratingInv(false)
    }
  }

  const handleCopyInvite = async (url: string, id: string) => {
    await navigator.clipboard.writeText(url)
    setCopiedInvite(id)
    setTimeout(() => setCopiedInvite(null), 2000)
  }

  const inviteStatus = (inv: Invite) => {
    if (inv.used_at)                           return { label: 'Used',    cls: 'bg-green-500/15 text-green-400' }
    if (new Date(inv.expires_at) < new Date()) return { label: 'Expired', cls: 'bg-red-500/15 text-red-400' }
    return { label: 'Pending', cls: 'bg-yellow-500/15 text-yellow-400' }
  }

  const uploadLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingLogo(true)
    setLogoMsg('')
    const form = new FormData()
    form.append('file', file)
    form.append('org_id', org.id)
    const res = await fetch('/api/org/logo', { method: 'POST', body: form })
    const data = await res.json()
    setUploadingLogo(false)
    if (data.logo_url) { setLogoUrl(data.logo_url); setLogoMsg('Logo updated') }
    else setLogoMsg('Error: ' + (data.error || 'Upload failed'))
    setTimeout(() => setLogoMsg(''), 3000)
  }

  const removeLogo = async () => {
    setUploadingLogo(true)
    const res = await fetch('/api/org/logo', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: org.id }),
    })
    setUploadingLogo(false)
    if (res.ok) { setLogoUrl(''); setLogoMsg('Logo removed') }
    else setLogoMsg('Error removing logo')
    setTimeout(() => setLogoMsg(''), 3000)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav isAdmin={true} userEmail={userEmail} currentPage='admin' />
      <SubHeader crumbs={[{label: 'Admin', href: '/admin'}, {label: org.name}]} />

      <main className="max-w-4xl mx-auto px-6 py-10 flex flex-col gap-8">

        {error && (
          <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Org header */}
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5 mb-1 flex-wrap">
                <h1 className="text-xl font-bold text-gray-800">{org.name}</h1>
                <span className={'text-xs px-2 py-0.5 rounded-full font-medium ' + (orgPlan === 'active' ? 'bg-green-500/15 text-green-400' : orgPlan === 'suspended' ? 'bg-red-500/15 text-red-400' : 'bg-blue-500/15 text-blue-400')}>
                  {orgPlan}
                </span>
                {org.is_admin_org && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-500/15 text-purple-400">admin org</span>
                )}
              </div>
              <div className="text-gray-400 text-sm">slug: {org.slug}</div>
            </div>
            {!org.is_admin_org && (
              <button
                onClick={handleTogglePlan}
                disabled={togglingPlan}
                className={'text-sm px-4 py-2 rounded-xl transition-all disabled:opacity-50 ' + (orgPlan === 'suspended' ? 'bg-green-500/15 hover:bg-green-500/25 text-green-400' : 'bg-red-500/15 hover:bg-red-500/25 text-red-400')}
              >
                {togglingPlan ? '...' : orgPlan === 'suspended' ? 'Reactivate Org' : 'Suspend Org'}
              </button>
            )}
          </div>

          {/* Logo upload */}
          <div className="mt-5 pt-5 border-t border-gray-200">
            <p className="text-xs text-gray-400 mb-3">Organisation Logo</p>
            {logoMsg && <p className="text-xs text-green-400 mb-2">{logoMsg}</p>}
            <div className="flex items-center gap-3">
              <div className="w-20 h-10 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center overflow-hidden">
                {logoUrl
                  ? <img src={logoUrl} alt="logo" className="h-full w-full object-contain p-1" />
                  : <span className="text-xs text-gray-400">No logo</span>
                }
              </div>
              <button onClick={() => fileRef.current?.click()} disabled={uploadingLogo}
                className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-slate-700 border border-gray-200 transition-colors">
                {uploadingLogo ? 'Uploading...' : logoUrl ? 'Change' : 'Upload Logo'}
              </button>
              {logoUrl && (
                <button onClick={removeLogo} disabled={uploadingLogo}
                  className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-red-900 border border-gray-200 text-red-400 transition-colors">
                  Remove
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={uploadLogo} />
            </div>
          </div>
        </div>

        {/* Features */}
        <Section title="Features">
          <OrgFeatureToggles
            orgId={org.id}
            initialFeatures={org.features || {}}
          />
        </Section>

        {/* Members */}
        <Section title={'Members (' + members.length + ')'}>
          {members.length === 0 ? (
            <Empty text="No members yet" />
          ) : (
            <div className="flex flex-col divide-y divide-slate-800">
              {members.map(m => (
                <div key={m.id} className="flex items-center justify-between py-3 gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-white truncate">{m.full_name || m.email}</div>
                    {m.full_name && <div className="text-xs text-gray-400 truncate">{m.email}</div>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-gray-400 capitalize">{m.role}</span>
                    <span className="text-xs text-slate-600">{new Date(m.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Studies */}
        <Section title={'Studies (' + studies.length + ')'}>
          {studies.length === 0 ? (
            <Empty text="No studies yet" />
          ) : (
            <div className="flex flex-col divide-y divide-slate-800">
              {studies.map(study => (
                <div key={study.id} className="flex items-center justify-between py-3 gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span>{study.bot_emoji}</span>
                      <span className="text-sm font-medium text-white truncate">{study.name}</span>
                      <span className={'text-xs px-2 py-0.5 rounded-full font-medium ' + statusColor(study.status)}>
                        {study.status}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">{study.bot_name} &middot; {study.response_count} responses</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Link href={'/studies/' + study.id + '/responses'} className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 hover:bg-slate-700 text-slate-300 transition-colors">
                      Responses
                    </Link>
                    <button
                      onClick={() => handleToggleStudyStatus(study)}
                      disabled={togglingStudy === study.id}
                      className={'text-xs px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 ' + (study.status === 'closed' ? 'bg-green-500/15 hover:bg-green-500/25 text-green-400' : 'bg-red-500/15 hover:bg-red-500/25 text-red-400')}
                    >
                      {togglingStudy === study.id ? '...' : study.status === 'closed' ? 'Reopen' : 'Close'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Invite Links */}
        <Section title="Invite Links">
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs text-gray-400">Generate links to invite new members to this organisation.</p>
            <button
              onClick={() => setShowInvForm(f => !f)}
              className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-slate-700 text-slate-300 transition-colors"
            >
              {showInvForm ? 'Cancel' : '+ New Invite'}
            </button>
          </div>

          {showInvForm && (
            <div className="flex gap-2 mb-4 flex-wrap">
              <input
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="Email (optional)"
                className="flex-1 min-w-[200px] bg-gray-100 border border-gray-200 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-slate-500"
              />
              <button
                onClick={handleGenerateInvite}
                disabled={generatingInv}
                className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-900 font-semibold text-sm transition-all"
              >
                {generatingInv ? 'Generating...' : 'Generate'}
              </button>
            </div>
          )}

          {invites.length === 0 ? (
            <Empty text="No invite links yet" />
          ) : (
            <div className="flex flex-col divide-y divide-slate-800">
              {invites.map(inv => {
                const status = inviteStatus(inv)
                return (
                  <div key={inv.id} className="flex items-center justify-between py-3 gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={'text-xs px-2 py-0.5 rounded-full font-medium ' + status.cls}>{status.label}</span>
                        {inv.email && <span className="text-xs text-gray-500 truncate">{inv.email}</span>}
                      </div>
                      <div className="text-xs text-slate-600 mt-0.5">
                        Expires {new Date(inv.expires_at).toLocaleDateString()}
                        {inv.used_at && ' · Used ' + new Date(inv.used_at).toLocaleDateString()}
                      </div>
                    </div>
                    {!inv.used_at && new Date(inv.expires_at) > new Date() && (
                      <button
                        onClick={() => handleCopyInvite(inv.invite_url, inv.id)}
                        className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-slate-700 text-slate-300 transition-colors flex-shrink-0"
                      >
                        {copiedInvite === inv.id ? 'Copied!' : 'Copy Link'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </Section>
      </main>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6">
      <h2 className="font-semibold text-white mb-4">{title}</h2>
      {children}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="text-gray-400 text-sm py-4 text-center">{text}</p>
}
