'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'

interface Org {
  id: string
  name: string
  slug: string
  plan: string
  is_admin_org: boolean
  created_at: string
  user_count: number
  active_users_30d?: number
  study_count: number
  response_count: number
}

interface Props {
  orgs: Org[]
  adminEmail: string
  logoUrl?:   string
  orgName?:   string
  fullName?:  string
}

const HERMES = '#E8632A'

function planBadge(plan: string) {
  if (plan === 'active')    return 'bg-green-100 text-green-700 border border-green-200'
  if (plan === 'trial')     return 'bg-blue-100 text-blue-700 border border-blue-200'
  if (plan === 'suspended') return 'bg-red-100 text-red-600 border border-red-200'
  return 'bg-gray-100 text-gray-500 border border-gray-200'
}

function orgStrip(org: Org): string {
  if (org.is_admin_org)         return 'linear-gradient(135deg,#7c3aed,#4f46e5)'
  if (org.plan === 'suspended') return 'linear-gradient(135deg,#dc2626,#b91c1c)'
  if (org.plan === 'active')    return 'linear-gradient(135deg,#16a34a,#15803d)'
  return 'linear-gradient(135deg,#3b82f6,#2563eb)'  // trial
}

function SectionHeader({ label, count, dot }: { label: string; count: number; dot: string }) {
  return (
    <div className="flex items-center gap-2 mt-6 mb-3 first:mt-0">
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: dot }} />
      <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">{label}</span>
      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">{count}</span>
    </div>
  )
}

function OrgCard({ org, toggling, onToggle }: { org: Org; toggling: string | null; onToggle: (o: Org) => void }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md hover:border-orange-200 transition-all overflow-hidden">
      <div className="h-1.5 w-full" style={{ background: orgStrip(org) }} />
      <div className="p-4 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Name + badges */}
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="font-bold text-gray-800 text-sm">{org.name}</h3>
            {org.is_admin_org && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700 border border-purple-200">
                admin
              </span>
            )}
            <span className={'text-xs px-2 py-0.5 rounded-full font-medium ' + planBadge(org.plan)}>
              {org.plan}
            </span>
          </div>
          {/* Slug + date */}
          <div className="text-xs text-gray-400 mb-3 font-mono">
            {org.slug} · {new Date(org.created_at).toLocaleDateString()}
          </div>
          {/* Stats */}
          <div className="flex gap-5 text-xs flex-wrap">
            <div>
              <span className="font-bold text-gray-700">{org.user_count.toLocaleString()}</span>
              <span className="text-gray-400 ml-1">users</span>
            </div>
            {org.user_count > 0 && (
              <div title="Users active in the last 30 days">
                <span className={'font-bold ' + (
                  (org.active_users_30d || 0) === 0 ? 'text-red-600'
                  : (org.active_users_30d || 0) < org.user_count ? 'text-amber-600'
                  : 'text-green-700'
                )}>
                  {(org.active_users_30d || 0).toLocaleString()}
                </span>
                <span className="text-gray-400 ml-1">active 30d</span>
              </div>
            )}
            <div>
              <span className="font-bold text-gray-700">{org.study_count.toLocaleString()}</span>
              <span className="text-gray-400 ml-1">studies</span>
            </div>
            <div>
              <span className="font-bold text-gray-700">{org.response_count.toLocaleString()}</span>
              <span className="text-gray-400 ml-1">responses</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1.5 flex-shrink-0">
          <Link
            href={'/admin/clients/' + org.id}
            className="text-xs px-3 py-1.5 rounded-lg font-medium border border-gray-200 text-gray-600 hover:border-orange-300 hover:text-orange-600 transition-all text-center whitespace-nowrap"
          >
            Manage
          </Link>
          {!org.is_admin_org && (
            <button
              onClick={() => onToggle(org)}
              disabled={toggling === org.id}
              className={'text-xs px-3 py-1.5 rounded-lg border font-medium transition-all disabled:opacity-50 whitespace-nowrap ' + (
                org.plan === 'suspended'
                  ? 'border-green-200 bg-green-50 text-green-700 hover:bg-green-100'
                  : 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100'
              )}
            >
              {toggling === org.id ? '…' : org.plan === 'suspended' ? 'Reactivate' : 'Suspend'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function AdminClient({ orgs: initial, adminEmail, logoUrl='', orgName='', fullName='' }: Props) {
  const [orgs, setOrgs]         = useState(initial)
  const [showNew, setShowNew]   = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)
  const [error, setError]       = useState<string | null>(null)

  const [newName,    setNewName]    = useState('')
  const [newSlug,    setNewSlug]    = useState('')
  const [newPlan,    setNewPlan]    = useState('trial')
  const [newIsAdmin, setNewIsAdmin] = useState(false)
  const [creating,   setCreating]   = useState(false)

  const router = useRouter()

  const handleTogglePlan = async (org: Org) => {
    setToggling(org.id)
    setError(null)
    const newPlanVal = org.plan === 'suspended' ? 'active' : 'suspended'
    try {
      const res = await fetch('/api/admin/clients/' + org.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: newPlanVal }),
      })
      if (!res.ok) throw new Error('Failed to update')
      setOrgs(prev => prev.map(o => o.id === org.id ? { ...o, plan: newPlanVal } : o))
    } catch {
      setError('Failed to update organization status.')
    } finally {
      setToggling(null)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, slug: newSlug, plan: newPlan, is_admin_org: newIsAdmin }),
      })
      if (!res.ok) {
        const j = await res.json()
        throw new Error(j.error || 'Failed to create')
      }
      const created = await res.json()
      setShowNew(false)
      setNewName(''); setNewSlug(''); setNewPlan('trial'); setNewIsAdmin(false)
      router.push('/admin/clients/' + created.id)
    } catch (e: any) {
      setError(e.message)
      setCreating(false)
    }
  }

  const autoSlug = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const adminOrgs    = orgs.filter(o =>  o.is_admin_org)
  const activeOrgs   = orgs.filter(o => !o.is_admin_org && o.plan !== 'suspended')
  const inactiveOrgs = orgs.filter(o => !o.is_admin_org && o.plan === 'suspended')

  const inputCls = 'px-4 py-2.5 rounded-xl border border-gray-300 text-sm text-gray-800 outline-none focus:border-orange-400 transition-colors bg-white'

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav logoUrl={logoUrl} orgName={orgName} isAdmin={true} userEmail={adminEmail} fullName={fullName} currentPage='admin' />
      <SubHeader crumbs={[{ label: 'Admin' }]} />

      <main className="max-w-5xl mx-auto px-6 pt-28 pb-10">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Organizations</h1>
            <p className="text-gray-500 text-sm mt-1">
              {adminOrgs.length} admin · {activeOrgs.length} active · {inactiveOrgs.length} inactive
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Link
              href="/admin/usage"
              className="px-5 py-2.5 rounded-xl bg-white border border-gray-200 hover:border-orange-300 hover:text-orange-600 text-gray-700 font-semibold text-sm transition-all"
            >
              💰 AI Usage
            </Link>
            <Link
              href="/admin/estimator"
              className="px-5 py-2.5 rounded-xl bg-white border border-gray-200 hover:border-orange-300 hover:text-orange-600 text-gray-700 font-semibold text-sm transition-all"
            >
              🧮 Cost Estimator
            </Link>
            <Link
              href="/admin/questions"
              className="px-5 py-2.5 rounded-xl bg-white border border-gray-200 hover:border-gray-300 text-gray-700 font-semibold text-sm transition-all"
            >
              Question Library
            </Link>
            <Link
              href="/admin/sarina-regression"
              className="px-5 py-2.5 rounded-xl bg-white border border-gray-200 hover:border-gray-300 text-gray-700 font-semibold text-sm transition-all"
            >
              Sarina Regression
            </Link>
            <Link
              href="/admin/backups"
              className="px-5 py-2.5 rounded-xl bg-white border border-gray-200 hover:border-gray-300 text-gray-700 font-semibold text-sm transition-all"
            >
              Backups
            </Link>
            <button
              onClick={() => setShowNew(v => !v)}
              className="px-5 py-2.5 rounded-xl font-semibold text-sm transition-all text-white"
              style={{ background: HERMES }}
            >
              + New Organization
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-5 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">
            {error}
          </div>
        )}

        {/* New org form */}
        {showNew && (
          <div className="mb-8 bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
            <h2 className="font-bold text-gray-800 text-base mb-5">New Organization</h2>
            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Organization name</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={e => { setNewName(e.target.value); setNewSlug(autoSlug(e.target.value)) }}
                    placeholder="Acme Corp"
                    required
                    className={inputCls}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Slug (URL-safe)</label>
                  <input
                    type="text"
                    value={newSlug}
                    onChange={e => setNewSlug(e.target.value)}
                    placeholder="acme-corp"
                    required
                    className={inputCls}
                  />
                </div>
              </div>
              <div className="flex gap-4 items-center flex-wrap">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">Plan</label>
                  <select
                    value={newPlan}
                    onChange={e => setNewPlan(e.target.value)}
                    className={inputCls + ' cursor-pointer'}
                  >
                    <option value="trial">Trial</option>
                    <option value="active">Active</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 cursor-pointer mt-5">
                  <input
                    type="checkbox"
                    checked={newIsAdmin}
                    onChange={e => setNewIsAdmin(e.target.checked)}
                    className="w-4 h-4 rounded"
                    style={{ accentColor: HERMES }}
                  />
                  <span className="text-sm text-gray-600">Admin organization</span>
                </label>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={creating}
                  className="px-5 py-2.5 rounded-xl font-semibold text-sm text-white transition-all disabled:opacity-50"
                  style={{ background: HERMES }}
                >
                  {creating ? 'Creating…' : 'Create Organization'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowNew(false)}
                  className="px-5 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium transition-all"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ── Admin orgs ── */}
        {adminOrgs.length > 0 && (
          <>
            <SectionHeader label="Admin" count={adminOrgs.length} dot="#7c3aed" />
            <div className="flex flex-col gap-3 mb-2">
              {adminOrgs.map(org => (
                <OrgCard key={org.id} org={org} toggling={toggling} onToggle={handleTogglePlan} />
              ))}
            </div>
          </>
        )}

        {/* ── Active orgs ── */}
        {activeOrgs.length > 0 && (
          <>
            <SectionHeader label="Active" count={activeOrgs.length} dot="#16a34a" />
            <div className="flex flex-col gap-3 mb-2">
              {activeOrgs.map(org => (
                <OrgCard key={org.id} org={org} toggling={toggling} onToggle={handleTogglePlan} />
              ))}
            </div>
          </>
        )}

        {/* ── Inactive orgs ── */}
        {inactiveOrgs.length > 0 && (
          <>
            <SectionHeader label="Inactive" count={inactiveOrgs.length} dot="#dc2626" />
            <div className="flex flex-col gap-3 mb-2">
              {inactiveOrgs.map(org => (
                <OrgCard key={org.id} org={org} toggling={toggling} onToggle={handleTogglePlan} />
              ))}
            </div>
          </>
        )}

        {orgs.length === 0 && (
          <div className="py-20 text-center text-gray-400 text-sm">No organizations yet.</div>
        )}

      </main>
    </div>
  )
}
