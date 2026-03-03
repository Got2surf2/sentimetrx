'use client'

import Link from 'next/link'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useEffect, useState, useCallback } from 'react'

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
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()

  const [orgs,        setOrgs]        = useState<OrgOption[]>([])
  const [users,       setUsers]       = useState<UserOption[]>([])
  const [selectedOrg, setSelectedOrg] = useState(searchParams.get('org') || '')
  const [selectedUser,setSelectedUser]= useState(searchParams.get('user') || '')

  // Fetch orgs for admin
  useEffect(() => {
    if (!isAdmin) return
    fetch('/api/admin/orgs', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(data => setOrgs(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [isAdmin])

  // Fetch users when org changes
  useEffect(() => {
    const targetOrg = selectedOrg || orgId
    if (!targetOrg) { setUsers([]); return }
    fetch('/api/admin/orgs/' + targetOrg + '/users', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(data => setUsers(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [selectedOrg, orgId])

  const updateParams = useCallback((org: string, user: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (org)  params.set('org', org)  ; else params.delete('org')
    if (user) params.set('user', user); else params.delete('user')
    router.push(pathname + (params.toString() ? '?' + params.toString() : ''))
  }, [router, pathname, searchParams])

  const handleOrgChange = (orgId: string) => {
    setSelectedOrg(orgId)
    setSelectedUser('')
    updateParams(orgId, '')
  }

  const handleUserChange = (userId: string) => {
    setSelectedUser(userId)
    updateParams(selectedOrg, userId)
  }

  const selectCls = 'text-xs bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-300 focus:outline-none focus:border-slate-500 max-w-[140px]'

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

        {/* Org filter — admin only */}
        {isAdmin && orgs.length > 0 && (
          <select value={selectedOrg} onChange={e => handleOrgChange(e.target.value)} className={selectCls}>
            <option value="">All orgs</option>
            {orgs.map(o => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        )}

        {/* User filter — shown when org is selected or user is in a known org */}
        {users.length > 0 && (
          <select value={selectedUser} onChange={e => handleUserChange(e.target.value)} className={selectCls}>
            <option value="">All users</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
            ))}
          </select>
        )}

        <div className="w-px h-4 bg-slate-700 mx-1 hidden sm:block" />

        <Link href="/dashboard" className="text-xs text-slate-500 hover:text-white transition-colors hidden sm:block whitespace-nowrap">Dashboard</Link>
        <Link href="/settings/team" className="text-xs text-slate-500 hover:text-white transition-colors hidden sm:block whitespace-nowrap">Team</Link>
        {isAdmin && (
          <Link href="/admin" className="text-xs font-medium transition-colors whitespace-nowrap" style={{ color: HERMES }}>Admin</Link>
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
