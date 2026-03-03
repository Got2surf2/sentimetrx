'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

interface Crumb { label: string; href?: string }
interface OrgOption  { id: string; name: string }
interface UserOption { id: string; email: string; full_name: string | null }

interface Props {
  logoUrl?:   string
  orgName?:   string
  isAdmin?:   boolean
  userEmail?: string
  crumbs?:    Crumb[]
  orgId?:     string
}

const HERMES = '#E8632A'

export default function TopNav({ logoUrl, orgName, isAdmin, userEmail, crumbs, orgId }: Props) {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams()

  const [orgs,         setOrgs]         = useState<OrgOption[]>([])
  const [users,        setUsers]        = useState<UserOption[]>([])
  const [selectedOrg,  setSelectedOrg]  = useState(() => params.get('org')  || '')
  const [selectedUser, setSelectedUser] = useState(() => params.get('user') || '')
  const [orgsLoaded,   setOrgsLoaded]   = useState(false)
  const navigating = useRef(false)

  // Fetch orgs once for admin
  useEffect(() => {
    if (!isAdmin) return
    fetch('/api/admin/orgs', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => { setOrgs(Array.isArray(d) ? d : []); setOrgsLoaded(true) })
      .catch(() => setOrgsLoaded(true))
  }, [isAdmin])

  // Fetch users when org changes — but only if not currently navigating
  useEffect(() => {
    if (navigating.current) return
    const targetOrg = selectedOrg || orgId
    if (!targetOrg) { setUsers([]); return }
    fetch('/api/admin/orgs/' + targetOrg + '/users', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => { if (!navigating.current) setUsers(Array.isArray(d) ? d : []) })
      .catch(() => {})
  }, [selectedOrg, orgId])

  const navigate = (org: string, user: string) => {
    navigating.current = true
    const p = new URLSearchParams(window.location.search)
    if (org)  p.set('org', org);   else p.delete('org')
    if (user) p.set('user', user); else p.delete('user')
    window.location.href = window.location.pathname + (p.toString() ? '?' + p.toString() : '')
  }

  const handleOrgChange = (val: string) => {
    setSelectedOrg(val)
    setSelectedUser('')
    navigate(val, '')
  }

  const handleUserChange = (val: string) => {
    setSelectedUser(val)
    navigate(selectedOrg, val)
  }

  const selectCls = 'text-xs bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-300 focus:outline-none focus:border-slate-500 max-w-[150px] cursor-pointer'

  return (
    <nav className="border-b border-slate-800 px-4 py-3 flex items-center justify-between bg-slate-950 sticky top-0 z-50 gap-3">
      {/* Left: logo + breadcrumbs */}
      <div className="flex items-center gap-3 min-w-0 overflow-hidden flex-shrink-0">
        <Link href="/dashboard" className="flex items-center gap-2 flex-shrink-0">
          {logoUrl ? (
            <img src={logoUrl} alt={orgName || 'Logo'} className="h-8 w-auto object-contain max-w-[120px]" />
          ) : (
            <span className="font-bold text-sm whitespace-nowrap" style={{ color: HERMES }}>
              sentimetrx.ai
            </span>
          )}
        </Link>
        {crumbs && crumbs.length > 0 && (
          <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
            {crumbs.map((c, i) => (
              <div key={i} className="flex items-center gap-1.5 min-w-0">
                <span className="text-slate-600 text-sm flex-shrink-0">/</span>
                {c.href ? (
                  <Link href={c.href} className="text-sm text-slate-400 hover:text-white transition-colors truncate max-w-[130px]">
                    {c.label}
                  </Link>
                ) : (
                  <span className="text-sm text-white font-medium truncate max-w-[160px]">{c.label}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right: filters + nav */}
      <div className="flex items-center gap-2 flex-shrink-0">

        {/* Org filter — admin only, always visible once loaded */}
        {isAdmin && orgsLoaded && (
          <select value={selectedOrg} onChange={e => handleOrgChange(e.target.value)} className={selectCls}>
            <option value="">All orgs</option>
            {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}

        {/* User filter — always visible when there are users to show */}
        {(selectedOrg || orgId) && (
          <select value={selectedUser} onChange={e => handleUserChange(e.target.value)} className={selectCls}
            disabled={users.length === 0}>
            <option value="">{users.length === 0 ? 'No users' : 'All users'}</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
          </select>
        )}

        <div className="w-px h-4 bg-slate-700 mx-1 hidden sm:block" />

        <Link href="/dashboard" className="text-xs text-slate-500 hover:text-white transition-colors hidden sm:block whitespace-nowrap">Dashboard</Link>
        <Link href="/settings/team" className="text-xs text-slate-500 hover:text-white transition-colors hidden sm:block whitespace-nowrap">Team</Link>
        {isAdmin && (
          <Link href="/admin" className="text-xs font-medium whitespace-nowrap" style={{ color: HERMES }}>Admin</Link>
        )}
        {userEmail && (
          <span className="text-slate-600 text-xs hidden lg:block truncate max-w-[140px]">{userEmail}</span>
        )}
        <form action="/api/auth/signout" method="POST">
          <button className="text-xs text-slate-500 hover:text-white transition-colors px-2.5 py-1.5 rounded-lg hover:bg-slate-800 whitespace-nowrap">
            Sign out
          </button>
        </form>
      </div>
    </nav>
  )
}
