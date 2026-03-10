'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

interface Crumb { label: string; href?: string }
interface OrgOption  { id: string; name: string }
interface UserOption { id: string; email: string; full_name: string | null }

interface Props {
  crumbs?:      Crumb[]
  isAdmin?:     boolean
  orgId?:       string
  showFilters?: boolean
  actions?:     React.ReactNode  // e.g. creator step pills
}

export default function SubHeader({ crumbs, isAdmin, orgId, showFilters, actions }: Props) {
  const [orgs,         setOrgs]         = useState<OrgOption[]>([])
  const [users,        setUsers]        = useState<UserOption[]>([])
  const [selectedOrg,  setSelectedOrg]  = useState('')
  const [selectedUser, setSelectedUser] = useState('')
  const [ready,        setReady]        = useState(false)
  const navigating = useRef(false)

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    setSelectedOrg(p.get('org')  || '')
    setSelectedUser(p.get('user') || '')
    setReady(true)
  }, [])

  useEffect(() => {
    if (!showFilters || !isAdmin) return
    fetch('/api/admin/orgs?active=true', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setOrgs(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [isAdmin, showFilters])

  useEffect(() => {
    if (!ready || !showFilters || navigating.current) return
    const targetOrg = selectedOrg || orgId
    if (!targetOrg) { setUsers([]); return }
    fetch('/api/admin/orgs/' + targetOrg + '/users', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => { if (!navigating.current) setUsers(Array.isArray(d) ? d : []) })
      .catch(() => {})
  }, [ready, selectedOrg, orgId, showFilters])

  const nav = (org: string, user: string) => {
    navigating.current = true
    const p = new URLSearchParams(window.location.search)
    if (org)  p.set('org',  org);  else p.delete('org')
    if (user) p.set('user', user); else p.delete('user')
    window.location.href = window.location.pathname + (p.toString() ? '?' + p.toString() : '')
  }

  const hasFilter = selectedOrg || selectedUser
  const selCls = 'text-xs bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 focus:outline-none focus:border-orange-400 cursor-pointer shadow-sm'

  return (
    <div className="bg-white border-b border-gray-200 px-5 py-2.5 flex items-center justify-between gap-4 shadow-sm fixed top-14 left-0 right-0 z-40">

      {/* Left: breadcrumbs */}
      <div className="flex items-center gap-1.5 min-w-0 overflow-hidden shrink">
        {crumbs && crumbs.map((c, i) => (
          <div key={i} className="flex items-center gap-1.5 min-w-0">
            {i > 0 && <span className="text-gray-300 text-sm flex-shrink-0">/</span>}
            {c.href
              ? <Link href={c.href} className="text-sm text-orange-500 hover:text-orange-600 transition-colors truncate max-w-[140px] font-medium">{c.label}</Link>
              : <span className="text-sm text-gray-700 font-semibold truncate max-w-[180px]">{c.label}</span>
            }
          </div>
        ))}
      </div>

      {/* Right: step pills (creator) OR admin filters */}
      {actions && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {actions}
        </div>
      )}
      {showFilters && !actions && (
        <div className="flex items-center gap-2 flex-shrink-0">
          {isAdmin && (
            <select value={ready ? selectedOrg : ''} onChange={e => { setSelectedOrg(e.target.value); setSelectedUser(''); nav(e.target.value, '') }}
              className={selCls} disabled={!ready}>
              <option value="">All organisations</option>
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          )}
          {(selectedOrg || orgId) && (
            <select value={ready ? selectedUser : ''} onChange={e => { setSelectedUser(e.target.value); nav(selectedOrg, e.target.value) }}
              className={selCls} disabled={!ready}>
              <option value="">All users</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
            </select>
          )}
          {hasFilter && (
            <button onClick={() => nav('', '')} className="text-xs text-gray-400 hover:text-gray-600 transition-colors px-2 py-1.5 rounded-lg hover:bg-gray-100">
              Clear ×
            </button>
          )}
        </div>
      )}
    </div>
  )
}
