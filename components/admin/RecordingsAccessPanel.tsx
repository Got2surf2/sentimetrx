'use client'

// Super-admin control for the recordings paid feature (org_features /
// user_features, sql/089). Org-level enable + monthly quota, plus a per-member
// override (Inherit / Allow / Block). Distinct from the ModuleFeatures toggles
// in OrgFeatureToggles — recordings is metered and gated by this table.

import { useEffect, useState } from 'react'

interface Member { id: string; email: string; full_name: string | null }
interface UserRow { user_id: string; email: string; full_name: string | null; enabled: boolean | null; quota_per_month: number | null }

interface Props {
  orgId:   string
  members: Member[]
}

type UserChoice = 'inherit' | 'allow' | 'block'

function choiceToEnabled(c: UserChoice): boolean | null {
  return c === 'inherit' ? null : c === 'allow'
}
function enabledToChoice(e: boolean | null): UserChoice {
  return e === null || e === undefined ? 'inherit' : e ? 'allow' : 'block'
}

export default function RecordingsAccessPanel({ orgId, members }: Props) {
  const [loading, setLoading]   = useState(true)
  const [orgEnabled, setOrgEnabled] = useState(false)
  const [quota, setQuota]       = useState<string>('')   // '' = unlimited
  const [userRows, setUserRows] = useState<UserRow[]>([])
  const [status, setStatus]     = useState('')
  const [busy, setBusy]         = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/features?feature=recording`)
      if (!res.ok) throw new Error('load failed')
      const data = await res.json()
      setOrgEnabled(!!data.org?.enabled)
      setQuota(data.org?.quota_per_month != null ? String(data.org.quota_per_month) : '')
      setUserRows(data.users || [])
    } catch {
      setStatus('Failed to load recordings access.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [orgId])  // eslint-disable-line react-hooks/exhaustive-deps

  function flash(msg: string) {
    setStatus(msg)
    setTimeout(() => setStatus(''), 2500)
  }

  async function saveOrg(nextEnabled: boolean, nextQuota: string) {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/features`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          feature: 'recording',
          enabled: nextEnabled,
          quota_per_month: nextQuota.trim() === '' ? null : Number(nextQuota.trim()),
        }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'save failed') }
      flash('Saved')
    } catch (e: any) {
      flash(e.message || 'Save failed')
      load()  // re-sync on failure
    } finally {
      setBusy(false)
    }
  }

  async function saveUser(userId: string, choice: UserChoice) {
    setBusy(true)
    setUserRows(prev => prev.map(u => u.user_id === userId ? { ...u, enabled: choiceToEnabled(choice) } : u))
    try {
      const res = await fetch(`/api/admin/users/${userId}/features`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ feature: 'recording', enabled: choiceToEnabled(choice), quota_per_month: null }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'save failed') }
      flash('Saved')
    } catch (e: any) {
      flash(e.message || 'Save failed')
      load()
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <p className="text-xs text-gray-400">Loading recordings access…</p>

  return (
    <div className="flex flex-col gap-5">
      {status && <p className="text-xs text-gray-500">{status}</p>}

      {/* Org-level */}
      <div className="flex items-start justify-between border-b border-gray-200 pb-4 gap-4">
        <div>
          <p className="text-sm font-medium text-gray-800">Recordings (org default)</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Paid, metered feature. Off = nobody in this org can create recordings. Requires the Analytics module too.
          </p>
        </div>
        <ToggleSwitch enabled={orgEnabled} disabled={busy} onToggle={() => { const n = !orgEnabled; setOrgEnabled(n); saveOrg(n, quota) }} />
      </div>

      {/* Monthly quota */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-800">Monthly quota</p>
          <p className="text-xs text-gray-500 mt-0.5">Max recordings processed per calendar month. Blank = unlimited.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number" min={1} value={quota} placeholder="∞"
            onChange={e => setQuota(e.target.value)}
            onBlur={() => saveOrg(orgEnabled, quota)}
            disabled={busy || !orgEnabled}
            style={{ fontSize: '16px', width: 90 }}
            className="border border-gray-300 rounded px-2 py-1 text-right disabled:bg-gray-100"
          />
          <span className="text-xs text-gray-400">/mo</span>
        </div>
      </div>

      {/* Per-user overrides */}
      <div>
        <p className="text-sm font-medium text-gray-800 mb-1">Per-user overrides</p>
        <p className="text-xs text-gray-500 mb-3">
          Inherit follows the org default. Allow/Block overrides it for one person.
        </p>
        <div className="flex flex-col divide-y divide-gray-100 border border-gray-200 rounded-lg">
          {userRows.length === 0 && <p className="text-xs text-gray-400 p-3">No members in this org.</p>}
          {userRows.map(u => (
            <div key={u.user_id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm text-gray-700 truncate">{u.full_name || u.email}</p>
                {u.full_name && <p className="text-xs text-gray-400 truncate">{u.email}</p>}
              </div>
              <select
                value={enabledToChoice(u.enabled)}
                disabled={busy}
                onChange={e => saveUser(u.user_id, e.target.value as UserChoice)}
                style={{ fontSize: '16px' }}
                className="border border-gray-300 rounded px-2 py-1 text-sm">
                <option value="inherit">Inherit{orgEnabled ? ' (on)' : ' (off)'}</option>
                <option value="allow">Allow</option>
                <option value="block">Block</option>
              </select>
            </div>
          ))}
        </div>
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
        display: 'inline-flex', alignItems: 'center', width: 44, height: 24, borderRadius: 9999,
        padding: 2, background: enabled ? '#E8632A' : '#D1D5DB', transition: 'background 0.2s',
        border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1, flexShrink: 0,
      }}>
      <span style={{
        display: 'inline-block', width: 20, height: 20, borderRadius: 9999, background: 'white',
        boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transform: enabled ? 'translateX(20px)' : 'translateX(0)',
        transition: 'transform 0.2s',
      }} />
    </button>
  )
}
