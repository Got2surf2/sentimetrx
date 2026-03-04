'use client'

import { useEffect, useRef, useState } from 'react'

interface OrgOption  { id: string; name: string }
interface UserOption { id: string; email: string; full_name: string | null }

interface Props {
  isAdmin?: boolean
  orgId?:   string
}

export default function FilterBar({ isAdmin, orgId }: Props) {
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
    if (!isAdmin) return
    fetch('/api/admin/orgs', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => setOrgs(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [isAdmin])

  useEffect(() => {
    if (!ready || navigating.current) return
    const targetOrg = selectedOrg || orgId
    if (!targetOrg) { setUsers([]); return }
    fetch('/api/admin/orgs/' + targetOrg + '/users', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => { if (!navigating.current) setUsers(Array.isArray(d) ? d : []) })
      .catch(() => {})
  }, [ready, selectedOrg, orgId])

  const nav = (org: string, user: string) => {
    navigating.current = true
    const p = new URLSearchParams(window.location.search)
    if (org)  p.set('org',  org);  else p.delete('org')
    if (user) p.set('user', user); else p.delete('user')
    window.location.href = window.location.pathname + (p.toString() ? '?' + p.toString() : '')
  }

  const handleOrgChange  = (v: string) => { setSelectedOrg(v); setSelectedUser(''); nav(v, '') }
  const handleUserChange = (v: string) => { setSelectedUser(v); nav(selectedOrg, v) }

  const clearAll = () => nav('', '')
  const hasFilter = selectedOrg || selectedUser

  // Don't render if not admin and no org
  if (!isAdmin && !orgId) return null

  const selCls = 'text-xs bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-300 focus:outline-none focus:border-slate-600 cursor-pointer'

  return (
    <div className="border-b border-slate-800/60 bg-slate-950/80 px-5 py-2 flex items-center gap-3">
      <span className="text-xs text-slate-600 font-medium uppercase tracking-wide flex-shrink-0">Filter</span>

      {isAdmin && (
        <select value={ready ? selectedOrg : ''} onChange={e => handleOrgChange(e.target.value)}
          className={selCls} disabled={!ready}>
          <option value="">All organisations</option>
          {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      )}

      {(selectedOrg || orgId) && (
        <select value={ready ? selectedUser : ''} onChange={e => handleUserChange(e.target.value)}
          className={selCls} disabled={!ready}>
          <option value="">All users</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
        </select>
      )}

      {hasFilter && (
        <button onClick={clearAll}
          className="text-xs text-slate-500 hover:text-white transition-colors px-2 py-1 rounded hover:bg-slate-800">
          Clear ×
        </button>
      )}
    </div>
  )
}
