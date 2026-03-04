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
  study_count: number
  response_count: number
}

interface Props {
  orgs: Org[]
  adminEmail: string
  logoUrl?: string
}

export default function AdminClient({ orgs: initial, adminEmail, logoUrl='' }: Props) {
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

  const planColor = (p: string) => {
    if (p === 'active')    return 'bg-green-500/15 text-green-400'
    if (p === 'trial')     return 'bg-blue-500/15 text-blue-400'
    if (p === 'suspended') return 'bg-red-500/15 text-red-400'
    return 'bg-slate-700 text-slate-400'
  }

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
        body: JSON.stringify({
          name: newName,
          slug: newSlug,
          plan: newPlan,
          is_admin_org: newIsAdmin,
        }),
      })
      if (!res.ok) {
        const j = await res.json()
        throw new Error(j.error || 'Failed to create')
      }
      const created = await res.json()
      setShowNew(false)
      setNewName('')
      setNewSlug('')
      setNewPlan('trial')
      setNewIsAdmin(false)
      router.push('/admin/clients/' + created.id)
    } catch (e: any) {
      setError(e.message)
      setCreating(false)
    }
  }

  const autoSlug = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav logoUrl={logoUrl} isAdmin={true} userEmail={adminEmail} currentPage='admin' />
      <SubHeader crumbs={[{label: 'Admin'}]} />

      <main className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Organizations</h1>
            <p className="text-gray-500 text-sm mt-1">{orgs.length} organizations</p>
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-900 font-semibold text-sm transition-all"
          >
            + New Organization
          </button>
        </div>

        {error && (
          <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {showNew && (
          <div className="mb-8 bg-slate-900 border border-slate-700 rounded-2xl p-6">
            <h2 className="font-semibold text-white mb-5">New Organization</h2>
            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-medium">Organization name</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={e => { setNewName(e.target.value); setNewSlug(autoSlug(e.target.value)) }}
                    placeholder="Acme Corp"
                    required
                    className="px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm outline-none focus:border-cyan-500 transition-colors"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-medium">Slug (URL-safe)</label>
                  <input
                    type="text"
                    value={newSlug}
                    onChange={e => setNewSlug(e.target.value)}
                    placeholder="acme-corp"
                    required
                    className="px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm outline-none focus:border-cyan-500 transition-colors"
                  />
                </div>
              </div>
              <div className="flex gap-4 items-center">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-medium">Plan</label>
                  <select
                    value={newPlan}
                    onChange={e => setNewPlan(e.target.value)}
                    className="px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white text-sm outline-none focus:border-cyan-500 transition-colors cursor-pointer"
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
                    className="w-4 h-4 rounded accent-cyan-500"
                  />
                  <span className="text-sm text-slate-300">Admin organization (sees all data)</span>
                </label>
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={creating}
                  className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-900 font-semibold text-sm transition-all"
                >
                  {creating ? 'Creating...' : 'Create Organization'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowNew(false)}
                  className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm transition-all"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {orgs.map(org => (
            <div key={org.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap mb-1">
                    <h2 className="font-semibold text-white text-base">{org.name}</h2>
                    <span className={'text-xs px-2 py-0.5 rounded-full font-medium ' + planColor(org.plan)}>
                      {org.plan}
                    </span>
                    {org.is_admin_org && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-500/15 text-purple-400">
                        admin org
                      </span>
                    )}
                  </div>
                  <div className="text-slate-500 text-xs mb-3">
                    slug: {org.slug} · Created {new Date(org.created_at).toLocaleDateString()}
                  </div>
                  <div className="flex gap-5 flex-wrap">
                    <div>
                      <div className="font-semibold text-sm text-white">{org.user_count}</div>
                      <div className="text-slate-500 text-xs">Users</div>
                    </div>
                    <div>
                      <div className="font-semibold text-sm text-white">{org.study_count}</div>
                      <div className="text-slate-500 text-xs">Studies</div>
                    </div>
                    <div>
                      <div className="font-semibold text-sm text-white">{org.response_count}</div>
                      <div className="text-slate-500 text-xs">Responses</div>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 flex-shrink-0">
                  <Link
                    href={'/admin/clients/' + org.id}
                    className="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors text-center"
                  >
                    Manage
                  </Link>
                  {!org.is_admin_org && (
                    <button
                      onClick={() => handleTogglePlan(org)}
                      disabled={toggling === org.id}
                      className={'text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 ' + (
                        org.plan === 'suspended'
                          ? 'bg-green-500/15 hover:bg-green-500/25 text-green-400'
                          : 'bg-red-500/15 hover:bg-red-500/25 text-red-400'
                      )}
                    >
                      {toggling === org.id ? '...' : org.plan === 'suspended' ? 'Reactivate' : 'Suspend'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
