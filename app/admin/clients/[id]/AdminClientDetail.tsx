'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'
import OrgFeatureToggles from '@/components/analyze/OrgFeatureToggles'
import OrgAiKeyPanel from '@/components/admin/OrgAiKeyPanel'
import Link from 'next/link'
import PendingInvitesList, { type PendingInvite } from '@/components/team/PendingInvitesList'

interface Member  { id: string; email: string; full_name: string | null; role: string; created_at: string; disabled?: boolean; last_login_at?: string | null; logins_30d?: number }
interface Study   { id: string; guid: string; name: string; bot_name: string; bot_emoji: string; status: string; visibility: string; created_at: string; response_count: number }
interface Invite  { id: string; token: string; email: string | null; role: string; used_at: string | null; expires_at: string; created_at: string; invite_url: string }
interface Org     { id: string; name: string; slug: string; plan: string; is_admin_org: boolean; logo_url?: string; features?: Record<string, boolean | unknown>; limits?: Record<string, unknown> }

interface OrgOption { id: string; name: string }

interface ReviewBudget { cap: number | null; used: number; remaining: number | null }

interface Props {
  org:           Org
  members:       Member[]
  studies:       Study[]
  allOrgs:       OrgOption[]
  invites:       Invite[]
  baseUrl:       string
  currentUserId: string
  userEmail?:    string
  reviewBudget:  ReviewBudget
}

export default function AdminClientDetail({ org, members: initialMembers, studies: initialStudies, allOrgs, invites: initialInvites, baseUrl, currentUserId, userEmail='', reviewBudget }: Props) {
  const [studies,       setStudies]       = useState(initialStudies)
  const [invites,       setInvites]       = useState(initialInvites)
  const [togglingStudy, setTogglingStudy] = useState<string | null>(null)
  const [transferring,  setTransferring]  = useState<string | null>(null)
  const [generatingInv, setGeneratingInv] = useState(false)
  const [inviteEmail,   setInviteEmail]   = useState('')
  const [showInvForm,   setShowInvForm]   = useState(false)
  const [bulkPaste,     setBulkPaste]     = useState('')
  const [bulkMessage,   setBulkMessage]   = useState('')
  const [showBulkForm,  setShowBulkForm]  = useState(false)
  const [bulkSending,   setBulkSending]   = useState(false)
  const [bulkResults,   setBulkResults]   = useState<Array<{ email: string; status: 'sent' | 'created' | 'duplicate' | 'failed' | 'already_user'; error?: string; invite_url?: string }> | null>(null)
  const [bulkSendEmail, setBulkSendEmail] = useState(true)
  const [previewHtml,   setPreviewHtml]   = useState<string | null>(null)
  const [previewSubject,setPreviewSubject]= useState('')
  const [previewLoading,setPreviewLoading]= useState(false)
  const [error,         setError]         = useState<string | null>(null)
  const [orgPlan,       setOrgPlan]       = useState(org.plan)
  const [togglingPlan,  setTogglingPlan]  = useState(false)
  const [logoUrl,       setLogoUrl]       = useState(org.logo_url || '')
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoMsg,       setLogoMsg]       = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Review-download monthly cap. Empty string = unlimited.
  const initialCap = typeof org.limits?.review_records_monthly === 'number'
    ? String(org.limits.review_records_monthly) : ''
  const [reviewCap,   setReviewCap]   = useState(initialCap)
  const [savingLimit, setSavingLimit] = useState(false)
  const [limitMsg,    setLimitMsg]    = useState('')

  // Delete-org modal — robust confirmation flow. Operator must type the
  // org name exactly. Preview counts are fetched on open so they see
  // what's about to vanish.
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deletePreview,   setDeletePreview]   = useState<Record<string, number> | null>(null)
  const [deleteTyped,     setDeleteTyped]     = useState('')
  const [deleting,        setDeleting]        = useState(false)
  const router = useRouter()

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

  const handleTransferStudy = async (studyId: string, newOrgId: string) => {
    setTransferring(studyId)
    setError(null)
    try {
      const res = await fetch('/api/studies/' + studyId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: newOrgId }),
      })
      if (!res.ok) throw new Error('Failed to transfer study')
      setStudies(prev => prev.filter(s => s.id !== studyId))
    } catch {
      setError('Failed to transfer study.')
    } finally {
      setTransferring(null)
    }
  }

  const [transferringUser, setTransferringUser] = useState<string | null>(null)
  const [members, setMembers] = useState<Member[]>(initialMembers)
  const handleTransferUser = async (userId: string, newOrgId: string) => {
    setTransferringUser(userId)
    setError(null)
    try {
      const res = await fetch('/api/admin/users/' + userId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: newOrgId }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d?.error || 'Failed to transfer user')
      }
      // User is no longer in this org — remove from list
      setMembers(prev => prev.filter(m => m.id !== userId))
    } catch (e: any) {
      setError(e?.message || 'Failed to transfer user.')
    } finally {
      setTransferringUser(null)
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

  // Save the monthly review-download cap. Blank input clears the cap
  // (unlimited); a number sets organizations.limits.review_records_monthly.
  const handleSaveReviewLimit = async () => {
    const trimmed = reviewCap.trim()
    let parsed: number | null = null
    if (trimmed !== '') {
      const n = Number(trimmed)
      if (!Number.isFinite(n) || n < 0) {
        setLimitMsg('Enter a whole number, or leave blank for unlimited.')
        setTimeout(() => setLimitMsg(''), 4000)
        return
      }
      parsed = Math.floor(n)
    }
    setSavingLimit(true)
    setLimitMsg('')
    try {
      const nextLimits: Record<string, unknown> = { ...(org.limits || {}) }
      if (parsed === null) delete nextLimits.review_records_monthly
      else nextLimits.review_records_monthly = parsed
      const res = await fetch('/api/admin/clients/' + org.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limits: nextLimits }),
      })
      if (!res.ok) throw new Error('Failed')
      setLimitMsg(parsed === null ? '✓ Cap removed — unlimited' : '✓ Saved')
    } catch {
      setLimitMsg('Failed to save limit.')
    } finally {
      setSavingLimit(false)
      setTimeout(() => setLimitMsg(''), 3000)
    }
  }

  // Open the delete modal — fetch the preview (row counts) so the user
  // sees what's about to be erased before they type the org name.
  const openDeleteModal = async () => {
    setShowDeleteModal(true)
    setDeleteTyped('')
    setDeletePreview(null)
    try {
      const res = await fetch('/api/admin/orgs/' + org.id)
      if (res.ok) {
        const data = await res.json()
        setDeletePreview(data.counts || {})
      }
    } catch { /* preview is informational, ignore */ }
  }

  const handleDeleteOrg = async () => {
    if (deleteTyped.trim().toLowerCase() !== org.name.trim().toLowerCase()) return
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/orgs/' + org.id, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm_name: deleteTyped }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Delete failed')
      // Org is gone — back to the admin client list.
      router.push('/admin')
    } catch (e: any) {
      setError(e.message || 'Delete failed')
      setDeleting(false)
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
      const sentTo = inviteEmail
      setInviteEmail('')
      setShowInvForm(false)
      if (data.email_status === 'sent')        setError(`✓ Invite emailed to ${sentTo}`)
      else if (data.email_status === 'failed') setError(`Invite created but email failed (${data.email_error || 'unknown'}) — copy the link manually`)
      setTimeout(() => setError(null), 5000)
    } catch {
      setError('Failed to generate invite link.')
    } finally {
      setGeneratingInv(false)
    }
  }

  const copyInviteFromList = async (inv: PendingInvite) => {
    const url = baseUrl + '/invite/' + inv.token
    await navigator.clipboard.writeText(url)
  }

  // Parses lines like:
  //   Lori Van Duyne <lvanduyne@darden.com>
  //   lvanduyne@darden.com
  //   "Lori Van Duyne", lvanduyne@darden.com
  // Skips blank lines and dedupes by email.
  const parseBulk = (raw: string): Array<{ email: string; name?: string }> => {
    const out: Array<{ email: string; name?: string }> = []
    const seen = new Set<string>()
    for (const line of raw.split(/\r?\n/)) {
      const s = line.trim()
      if (!s) continue
      const angle = s.match(/^(.*?)<([^>]+)>\s*$/)
      let email = ''
      let name: string | undefined
      if (angle) {
        name  = angle[1].replace(/[",]/g, '').trim() || undefined
        email = angle[2].trim().toLowerCase()
      } else {
        const tokenMatch = s.match(/[^\s,;<>]+@[^\s,;<>]+/)
        if (!tokenMatch) continue
        email = tokenMatch[0].trim().toLowerCase()
        const before = s.slice(0, tokenMatch.index).replace(/[",]/g, '').trim()
        name = before || undefined
      }
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue
      if (seen.has(email)) continue
      seen.add(email)
      out.push({ email, name })
    }
    return out
  }

  const handlePreviewEmail = async () => {
    setPreviewLoading(true)
    try {
      const res = await fetch('/api/admin/invite-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: org.id, message: bulkMessage.trim() || undefined, role: 'owner' }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Preview failed'); return }
      setPreviewHtml(data.html || '')
      setPreviewSubject(data.subject || '')
    } catch (e) {
      setError('Preview failed: ' + ((e as Error)?.message || 'network'))
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleBulkInvite = async () => {
    const users = parseBulk(bulkPaste)
    if (users.length === 0) { setError('No valid emails detected — paste one per line.'); return }
    setBulkSending(true)
    setBulkResults(null)
    setError(null)
    try {
      const res = await fetch('/api/admin/bulk-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: org.id,
          users,
          role: 'owner',
          message: bulkMessage.trim() || undefined,
          sendEmail: bulkSendEmail,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || 'Bulk invite failed')
        return
      }
      setBulkResults(data.results || [])
      // Refresh pending invites list with the freshly created ones
      const inviteRows: Invite[] = (data.results as Array<{ email: string; status: string; token?: string }>)
        .filter(r => r.token && (r.status === 'sent' || r.status === 'failed'))
        .map(r => ({
          id: r.token!, token: r.token!, email: r.email, role: 'owner',
          used_at: null,
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          created_at: new Date().toISOString(),
          invite_url: baseUrl + '/invite/' + r.token,
        }))
      if (inviteRows.length > 0) setInvites(prev => [...inviteRows, ...prev])
    } catch (e) {
      setError('Bulk invite failed: ' + ((e as Error)?.message || 'network'))
    } finally {
      setBulkSending(false)
    }
  }

  const handleResendInvite = async (id: string) => {
    try {
      const res = await fetch(`/api/invite/${id}/resend`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (data.email_status === 'sent')   return { ok: true,  message: '✓ Sent' }
      if (data.email_status === 'failed') return { ok: false, message: `Failed: ${data.email_error || 'email error'}` }
      return { ok: false, message: data.error || 'Could not resend' }
    } catch {
      return { ok: false, message: 'Network error' }
    }
  }

  const handleRevokeInvite = async (id: string, email: string | null) => {
    if (!confirm(`Revoke the invite for ${email || 'this user'}?`)) return
    const res = await fetch(`/api/invite/${id}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (res.ok) {
      setInvites(prev => prev.filter(i => i.id !== id))
      setError('✓ Invite revoked')
    } else {
      setError(`Error: ${data.error || 'Could not revoke'}`)
    }
    setTimeout(() => setError(null), 5000)
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

<main className="max-w-4xl mx-auto px-6 pt-28 pb-10 flex flex-col gap-8">
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
              <div className="flex items-center gap-2">
                <button
                  onClick={handleTogglePlan}
                  disabled={togglingPlan}
                  className={'text-sm px-4 py-2 rounded-xl transition-all disabled:opacity-50 ' + (orgPlan === 'suspended' ? 'bg-green-500/15 hover:bg-green-500/25 text-green-400' : 'bg-red-500/15 hover:bg-red-500/25 text-red-400')}
                >
                  {togglingPlan ? '...' : orgPlan === 'suspended' ? 'Reactivate Org' : 'Suspend Org'}
                </button>
                {orgPlan === 'suspended' && (
                  <button
                    onClick={openDeleteModal}
                    className="text-sm px-4 py-2 rounded-xl transition-all bg-red-600 text-white hover:bg-red-700"
                    title="Delete org permanently (already suspended, ready for hard delete)"
                  >
                    Delete Org…
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Logo upload */}
          <div className="mt-5 pt-5 border-t border-gray-200">
            <p className="text-xs text-gray-400 mb-3">Organization Logo</p>
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

        {/* AI Key */}
        <Section title="AI Key">
          <OrgAiKeyPanel orgId={org.id} />
        </Section>

        {/* Review Downloads */}
        <Section title="Review Downloads">
          <p className="text-xs text-gray-400 mb-4">
            Monthly cap on review records downloadable from Google &amp; Tripadvisor.
            Blank = unlimited. When the cap is hit, new downloads pause until the next
            calendar month — in-flight tasks still finish.
          </p>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Monthly record cap</label>
              <input
                type="number"
                min={0}
                value={reviewCap}
                onChange={e => setReviewCap(e.target.value)}
                placeholder="Unlimited"
                className="w-44 bg-gray-100 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gray-400"
              />
            </div>
            <button
              onClick={handleSaveReviewLimit}
              disabled={savingLimit}
              className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-900 font-semibold text-sm transition-all"
            >
              {savingLimit ? 'Saving…' : 'Save cap'}
            </button>
            {limitMsg && <span className="text-xs text-gray-500 pb-2">{limitMsg}</span>}
          </div>
          <div className="mt-4 pt-4 border-t border-gray-200 text-sm text-gray-600">
            {(() => {
              const trimmed = reviewCap.trim()
              const n = trimmed === '' ? null : Number(trimmed)
              const capNum = (n !== null && Number.isFinite(n) && n >= 0) ? Math.floor(n) : null
              const used = reviewBudget.used
              if (capNum === null) {
                return <span><strong>{used.toLocaleString()}</strong> records downloaded this month · <span className="text-gray-400">no cap</span></span>
              }
              const over = used >= capNum
              return (
                <span>
                  <strong className={over ? 'text-red-600' : ''}>{used.toLocaleString()}</strong>
                  {' / ' + capNum.toLocaleString()} records this month ·{' '}
                  <span className={over ? 'text-red-600 font-semibold' : 'text-green-700'}>
                    {over ? 'limit reached' : Math.max(0, capNum - used).toLocaleString() + ' remaining'}
                  </span>
                </span>
              )
            })()}
          </div>
        </Section>

        {/* Members */}
        <Section title={'Members (' + members.length + ')'}>
          {members.length === 0 ? (
            <Empty text="No members yet" />
          ) : (
            <div className="flex flex-col divide-y divide-gray-200">
              {members.map(m => {
                const last = m.last_login_at ? new Date(m.last_login_at) : null
                const daysSince = last ? Math.floor((Date.now() - last.getTime()) / (1000 * 60 * 60 * 24)) : null
                const activity = last == null ? { label: 'never logged in', cls: 'text-red-600' }
                  : daysSince! > 30 ? { label: `last login ${daysSince}d ago`, cls: 'text-red-600' }
                  : daysSince! > 7  ? { label: `last login ${daysSince}d ago`, cls: 'text-amber-600' }
                  :                   { label: `last login ${daysSince}d ago`, cls: 'text-green-700' }
                return (
                <div key={m.id} className="flex items-center justify-between py-3 gap-3" style={m.disabled ? { opacity: 0.6 } : undefined}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-800 truncate">
                      {m.full_name || m.email}
                      {m.disabled && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-gray-200 text-gray-700 font-semibold">Disabled</span>}
                    </div>
                    {m.full_name && <div className="text-xs text-gray-400 truncate">{m.email}</div>}
                    <div className={'text-xs mt-0.5 ' + activity.cls} title={last ? last.toLocaleString() : 'No login recorded'}>
                      {activity.label}{m.logins_30d != null && m.logins_30d > 0 ? ` · ${m.logins_30d} login${m.logins_30d !== 1 ? 's' : ''} in 30d` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-gray-400 capitalize">{m.role}</span>
                    <span className="text-xs text-slate-600">{new Date(m.created_at).toLocaleDateString()}</span>
                    {allOrgs.length > 0 && m.id !== currentUserId && (
                      <select
                        disabled={transferringUser === m.id}
                        value=""
                        onChange={e => {
                          if (e.target.value) {
                            const targetName = allOrgs.find(o => o.id === e.target.value)?.name || 'another org'
                            if (confirm('Transfer ' + (m.full_name || m.email) + ' to ' + targetName + '? Their per-user feature overrides will be cleared.')) {
                              handleTransferUser(m.id, e.target.value)
                            } else {
                              e.target.value = ''
                            }
                          }
                        }}
                        className="text-xs px-2.5 py-1.5 rounded-lg bg-blue-500/15 text-blue-400 border-none cursor-pointer transition-colors disabled:opacity-50 appearance-none"
                      >
                        <option value="">{transferringUser === m.id ? 'Transferring...' : 'Transfer'}</option>
                        {allOrgs.map(o => (
                          <option key={o.id} value={o.id}>{o.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
                )
              })}
            </div>
          )}
        </Section>

        {/* Studies */}
        <Section title={'Studies (' + studies.length + ')'}>
          {studies.length === 0 ? (
            <Empty text="No studies yet" />
          ) : (
            <div className="flex flex-col divide-y divide-gray-200">
              {studies.map(study => (
                <div key={study.id} className="flex items-center justify-between py-3 gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span>{study.bot_emoji}</span>
                      <span className="text-sm font-medium text-gray-800 truncate">{study.name}</span>
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
                    {allOrgs.length > 0 && (
                      <select
                        disabled={transferring === study.id}
                        value=""
                        onChange={e => {
                          if (e.target.value && confirm('Transfer "' + study.name + '" to another organization?')) {
                            handleTransferStudy(study.id, e.target.value)
                          } else {
                            e.target.value = ''
                          }
                        }}
                        className="text-xs px-2.5 py-1.5 rounded-lg bg-blue-500/15 text-blue-400 border-none cursor-pointer transition-colors disabled:opacity-50 appearance-none"
                      >
                        <option value="">{transferring === study.id ? 'Transferring...' : 'Transfer'}</option>
                        {allOrgs.map(o => (
                          <option key={o.id} value={o.id}>{o.name}</option>
                        ))}
                      </select>
                    )}
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
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <p className="text-xs text-gray-500">Add new members to this organization — generate a link or send an invite email.</p>
            <div className="flex gap-2">
              <button
                onClick={() => { setShowBulkForm(f => !f); if (!showBulkForm) setShowInvForm(false) }}
                className={'text-sm font-semibold px-4 py-2 rounded-lg transition-colors ' + (showBulkForm
                  ? 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                  : 'bg-gray-200 hover:bg-gray-300 text-gray-800')}
              >
                {showBulkForm ? 'Cancel bulk' : '+ Bulk Invite'}
              </button>
              <button
                onClick={() => { setShowInvForm(f => !f); if (!showInvForm) setShowBulkForm(false) }}
                className={'text-sm font-semibold px-4 py-2 rounded-lg transition-colors ' + (showInvForm
                  ? 'bg-gray-100 hover:bg-gray-200 text-gray-600'
                  : 'bg-cyan-500 hover:bg-cyan-400 text-slate-900')}
              >
                {showInvForm ? 'Cancel' : '+ New Invite'}
              </button>
            </div>
          </div>

          {showInvForm && (
            <div className="flex gap-2 mb-4 flex-wrap">
              <input
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="Email (optional)"
                className="flex-1 min-w-[200px] bg-gray-100 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gray-400"
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

          {showBulkForm && (
            <div className="mb-4 p-3 rounded-xl bg-gray-50 border border-gray-200">
              <div className="text-xs text-gray-500 mb-2">
                Paste one per line. Accepts <code>Name &lt;email@example.com&gt;</code> or bare emails. Already-registered users and pending invites are skipped automatically.
              </div>
              <textarea
                value={bulkPaste}
                onChange={e => setBulkPaste(e.target.value)}
                rows={8}
                placeholder={'Lori Van Duyne <lvanduyne@darden.com>\nAditya Rajpal <arajpal@darden.com>\n…'}
                className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gray-400 font-mono"
              />
              <div className="mt-3">
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none mb-2">
                  <input type="checkbox" checked={bulkSendEmail} onChange={e => setBulkSendEmail(e.target.checked)} />
                  <span><strong>Send invite emails from Sentimetrx</strong> — if off, links are just generated and you can email them yourself with your own message.</span>
                </label>
                {bulkSendEmail && (
                  <>
                    <label className="text-xs text-gray-500 block mb-1">Custom message <span className="text-gray-400">(optional — rendered as a quoted note above the Accept button)</span></label>
                    <textarea
                      value={bulkMessage}
                      onChange={e => setBulkMessage(e.target.value)}
                      rows={4}
                      maxLength={2000}
                      placeholder={"Hi team — your Sentimetrx accounts are ready. Click Accept to set a password and sign in. Reach out with any questions.\n\n— Sanjay"}
                      className="w-full bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gray-400"
                    />
                  </>
                )}
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs text-gray-500">{parseBulk(bulkPaste).length} valid email(s) detected</span>
                <div className="flex-1" />
                {bulkSendEmail && (
                  <button
                    onClick={handlePreviewEmail}
                    disabled={previewLoading}
                    className="px-3 py-2 rounded-xl bg-gray-200 hover:bg-gray-300 disabled:opacity-50 text-gray-800 font-semibold text-sm transition-all"
                  >
                    {previewLoading ? 'Loading…' : 'Preview email'}
                  </button>
                )}
                <button
                  onClick={handleBulkInvite}
                  disabled={bulkSending || parseBulk(bulkPaste).length === 0}
                  className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-900 font-semibold text-sm transition-all"
                >
                  {bulkSending ? (bulkSendEmail ? 'Sending…' : 'Creating…') : (bulkSendEmail ? 'Send invites' : 'Create invite links')}
                </button>
              </div>
              {bulkResults && (
                <div className="mt-3">
                  {(() => {
                    const withUrl = bulkResults.filter(r => r.invite_url && (r.status === 'sent' || r.status === 'created' || r.status === 'failed'))
                    if (withUrl.length === 0) return null
                    const lines = withUrl.map(r => r.email + '\t' + r.invite_url).join('\n')
                    return (
                      <div className="mb-2 flex items-center gap-2">
                        <button
                          onClick={() => { navigator.clipboard.writeText(lines).catch(() => {}); setError('✓ Copied ' + withUrl.length + ' email/link pairs to clipboard'); setTimeout(() => setError(null), 3000) }}
                          className="text-xs px-3 py-1.5 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold"
                        >Copy email/link pairs ({withUrl.length})</button>
                        <span className="text-[10px] text-gray-400">tab-separated, paste into Sheets or your mail client</span>
                      </div>
                    )
                  })()}
                  <div className="text-xs space-y-1 max-h-64 overflow-y-auto">
                    {bulkResults.map(r => (
                      <div key={r.email} className="flex items-start gap-2 flex-wrap">
                        <span className={
                          r.status === 'sent'         ? 'text-green-600 font-semibold' :
                          r.status === 'created'      ? 'text-blue-600 font-semibold' :
                          r.status === 'duplicate'    ? 'text-amber-600 font-semibold' :
                          r.status === 'already_user' ? 'text-gray-500 font-semibold' :
                                                         'text-red-600 font-semibold'
                        } style={{ minWidth: 100 }}>
                          {r.status === 'sent' ? '✓ Sent' :
                           r.status === 'created' ? '✓ Link' :
                           r.status === 'duplicate' ? '⏭ Pending' :
                           r.status === 'already_user' ? '⏭ Registered' :
                           '✗ Failed'}
                        </span>
                        <span className="text-gray-800">{r.email}</span>
                        {r.invite_url && (r.status === 'created' || r.status === 'failed') && (
                          <button
                            onClick={() => { navigator.clipboard.writeText(r.invite_url!).catch(() => {}) }}
                            className="text-[10px] px-2 py-0.5 rounded bg-gray-200 hover:bg-gray-300 text-gray-700"
                            title={r.invite_url}
                          >Copy link</button>
                        )}
                        {r.error && <span className="text-red-500 text-[10px]">({r.error})</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <PendingInvitesList
            invites={invites as PendingInvite[]}
            onResend={handleResendInvite}
            onCopy={copyInviteFromList}
            onRevoke={handleRevokeInvite}
            emptyText="No invite links yet"
          />
        </Section>
      </main>

      {/* Email preview modal — opens from the bulk-invite "Preview email"
          button. Renders the rendered HTML inside an iframe so the
          modal style can't interfere with the email's table-based
          layout. */}
      {previewHtml !== null && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={() => { setPreviewHtml(null); setPreviewSubject('') }}
        >
          <div
            style={{ background: 'white', borderRadius: 12, width: '100%', maxWidth: 720, maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,.28)' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '14px 18px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Email preview</div>
                <div style={{ fontSize: 13, color: '#111827', fontWeight: 600, marginTop: 2 }}>{previewSubject || '(no subject)'}</div>
              </div>
              <button
                onClick={() => { setPreviewHtml(null); setPreviewSubject('') }}
                style={{ fontSize: 18, color: '#9ca3af', background: 'transparent', border: 'none', cursor: 'pointer', lineHeight: 1 }}
              >&times;</button>
            </div>
            <iframe
              title="Invite email preview"
              srcDoc={previewHtml}
              sandbox=""
              style={{ flex: 1, border: 'none', width: '100%', minHeight: 480, background: '#f5f5f4' }}
            />
            <div style={{ padding: '10px 18px', borderTop: '1px solid #e5e7eb', background: '#fafafa', fontSize: 11, color: '#6b7280' }}>
              This is exactly what recipients will see. The Accept button links to a sample <code>PREVIEW-TOKEN</code> in this preview; real invites generate one per recipient.
            </div>
          </div>
        </div>
      )}

      {/* Delete-org modal — robust confirmation flow.
          - Opens after the operator has already suspended the org.
          - Shows a preview of what will be deleted.
          - Delete button stays disabled until the typed name matches
            the org's name exactly (case-insensitive). */}
      {showDeleteModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => { if (!deleting) setShowDeleteModal(false) }}
        >
          <div
            style={{ background: 'white', borderRadius: 16, width: '100%', maxWidth: 520, padding: 24, boxShadow: '0 24px 64px rgba(0,0,0,.32)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#7f1d1d', marginBottom: 6 }}>Permanently delete {org.name}?</h2>
            <p style={{ fontSize: 13, color: '#374151', marginBottom: 16 }}>
              This <strong>cannot be undone.</strong> Every member, dataset, study, agent, campaign, and PulseIQ session in this org will be erased.
            </p>

            {deletePreview && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: 12, marginBottom: 16 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: '#7f1d1d', marginBottom: 6 }}>What will be deleted:</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px 16px', fontSize: 12, color: '#374151' }}>
                  {Object.entries(deletePreview)
                    .filter(([, n]) => (n as number) > 0)
                    .map(([table, n]) => (
                      <div key={table}>
                        <span style={{ fontWeight: 700 }}>{n}</span>{' '}
                        <span style={{ color: '#6b7280' }}>{table.replace(/_/g, ' ')}</span>
                      </div>
                    ))}
                  {Object.values(deletePreview).every(n => n === 0) && (
                    <div style={{ color: '#6b7280' }}>The org has no data attached — just the org row.</div>
                  )}
                </div>
              </div>
            )}

            <label style={{ display: 'block', fontSize: 12, color: '#374151', marginBottom: 6 }}>
              Type the org's name to confirm: <strong style={{ color: '#7f1d1d' }}>{org.name}</strong>
            </label>
            <input
              type="text"
              autoFocus
              value={deleteTyped}
              onChange={(e) => setDeleteTyped(e.target.value)}
              placeholder={org.name}
              disabled={deleting}
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1.5px solid #e5e7eb', fontSize: 14, marginBottom: 16, outline: 'none' }}
            />

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                style={{ padding: '8px 16px', borderRadius: 10, background: '#f3f4f6', color: '#374151', fontSize: 13, fontWeight: 600, border: 'none', cursor: deleting ? 'wait' : 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteOrg}
                disabled={deleting || deleteTyped.trim().toLowerCase() !== org.name.trim().toLowerCase()}
                style={{
                  padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 700, border: 'none',
                  background: (!deleting && deleteTyped.trim().toLowerCase() === org.name.trim().toLowerCase()) ? '#dc2626' : '#fecaca',
                  color: 'white',
                  cursor: (!deleting && deleteTyped.trim().toLowerCase() === org.name.trim().toLowerCase()) ? 'pointer' : 'not-allowed',
                }}
              >
                {deleting ? 'Deleting…' : 'Delete forever'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6">
      <h2 className="font-semibold text-gray-800 mb-4">{title}</h2>
      {children}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="text-gray-400 text-sm py-4 text-center">{text}</p>
}
