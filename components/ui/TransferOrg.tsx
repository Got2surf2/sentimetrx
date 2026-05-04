'use client'

// components/ui/TransferOrg.tsx
// Reusable admin-only "Transfer Organization" panel.
// Renders a dropdown of all orgs + transfer button.
// On transfer, PATCHes { org_id } to the given API endpoint.

import { useState, useEffect } from 'react'

var HERMES = '#E8632A'

interface Org { id: string; name: string }

interface Props {
  resourceName: string          // e.g. "MyBot" — shown in confirm dialog
  resourceLabel: string         // e.g. "agent" — shown in section title
  apiUrl: string                // e.g. "/api/bots/abc-123"
  allOrgs?: Org[]               // if provided, skips fetch
  currentOrgId?: string
  onTransferred?: () => void    // called after successful transfer
}

export default function TransferOrg({ resourceName, resourceLabel, apiUrl, allOrgs: propOrgs, currentOrgId, onTransferred }: Props) {
  var [targetOrgId, setTargetOrgId] = useState('')
  var [transferring, setTransferring] = useState(false)
  var [error, setError] = useState<string | null>(null)
  var [done, setDone] = useState(false)
  var [orgs, setOrgs] = useState<Org[]>(propOrgs || [])
  var [isAdmin, setIsAdmin] = useState(!!propOrgs)

  useEffect(function() {
    if (propOrgs) return
    fetch('/api/admin/clients')
      .then(function(r) { if (!r.ok) throw new Error(); return r.json() })
      .then(function(d) { setOrgs((d.orgs || d || []).map(function(o: any) { return { id: o.id, name: o.name } })); setIsAdmin(true) })
      .catch(function() { setIsAdmin(false) })
  }, [propOrgs])

  if (!isAdmin) return null
  var allOrgs = orgs

  if (done) {
    return (
      <div style={{ marginTop: 32, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: 20, textAlign: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: '#166534' }}>Transferred successfully</span>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 32, background: 'white', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 4 }}>Transfer Organization</h3>
      <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 14 }}>Move this {resourceLabel} to a different organization. Ownership, data, and future usage costs will transfer.</p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <select
          disabled={transferring}
          value={targetOrgId}
          onChange={function(e) { setTargetOrgId(e.target.value); setError(null) }}
          style={{
            flex: 1, padding: '8px 12px', borderRadius: 10, border: '1px solid #d1d5db',
            fontSize: 13, color: '#374151', outline: 'none', background: 'white',
          }}>
          <option value="" disabled>Select organization...</option>
          {allOrgs.filter(function(o) { return o.id !== currentOrgId }).map(function(o) {
            return <option key={o.id} value={o.id}>{o.name}</option>
          })}
        </select>

        <button
          disabled={transferring || !targetOrgId}
          onClick={async function() {
            if (!targetOrgId) return
            var orgLabel = allOrgs.find(function(o) { return o.id === targetOrgId })?.name || targetOrgId
            if (!confirm('Transfer "' + resourceName + '" to ' + orgLabel + '? This cannot be undone.')) return

            setTransferring(true)
            setError(null)
            try {
              var res = await fetch(apiUrl, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ org_id: targetOrgId }),
              })
              if (!res.ok) {
                var data = await res.json().catch(function() { return {} })
                throw new Error(data.error || 'Transfer failed')
              }
              setDone(true)
              if (onTransferred) onTransferred()
            } catch (e: any) {
              setError(e.message || 'Transfer failed')
              setTransferring(false)
            }
          }}
          style={{
            padding: '8px 20px', borderRadius: 10, border: 'none',
            background: HERMES, color: 'white', fontSize: 13, fontWeight: 600,
            cursor: transferring || !targetOrgId ? 'default' : 'pointer',
            opacity: transferring || !targetOrgId ? 0.5 : 1,
          }}>
          {transferring ? 'Transferring...' : 'Transfer'}
        </button>
      </div>

      {error && (
        <p style={{ fontSize: 12, color: '#dc2626', marginTop: 8 }}>{error}</p>
      )}
    </div>
  )
}
