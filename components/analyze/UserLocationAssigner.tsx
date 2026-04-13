'use client'

// components/analyze/UserLocationAssigner.tsx
// Admin UI for assigning org members to specific locations (scoped access)

import { useState, useEffect } from 'react'

const HERMES = '#E8632A'

interface Assignment {
  id: string
  user_id: string
  location_id: string
  review_source_locations?: { name: string; city: string | null; state: string | null } | null
  users?: { email: string; full_name: string | null } | null
}

interface TeamMember {
  id: string
  email: string
  full_name: string | null
  role: string
}

interface Location {
  id: string
  name: string
  city: string | null
  state: string | null
}

interface Props {
  sourceId: string
}

export default function UserLocationAssigner({ sourceId }: Props) {
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [members, setMembers] = useState<TeamMember[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedUser, setSelectedUser] = useState('')
  const [selectedLocations, setSelectedLocations] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(function() {
    Promise.all([
      fetch('/api/review-sources/' + sourceId + '/user-locations').then(function(r) { return r.json() }),
      fetch('/api/settings/team').then(function(r) { return r.json() }),
      fetch('/api/review-sources/' + sourceId).then(function(r) { return r.json() }),
    ]).then(function([assignData, teamData, sourceData]) {
      setAssignments(assignData.assignments || [])
      // Only show members/viewers (not owners/admins who see everything)
      setMembers((teamData.members || []).filter(function(m: TeamMember) {
        return m.role === 'member' || m.role === 'viewer'
      }))
      setLocations((sourceData.locations || []).filter(function(l: any) { return l.selected }))
    }).catch(function() {}).finally(function() { setLoading(false) })
  }, [sourceId])

  // Group assignments by user
  const userAssignments = assignments.reduce(function(acc, a) {
    if (!acc[a.user_id]) acc[a.user_id] = []
    acc[a.user_id].push(a)
    return acc
  }, {} as Record<string, Assignment[]>)

  function handleSelectUser(userId: string) {
    setSelectedUser(userId)
    // Pre-select currently assigned locations
    const current = (userAssignments[userId] || []).map(function(a) { return a.location_id })
    setSelectedLocations(new Set(current))
    setMessage('')
  }

  function toggleLocation(locId: string) {
    setSelectedLocations(function(prev) {
      const next = new Set(prev)
      if (next.has(locId)) next.delete(locId)
      else next.add(locId)
      return next
    })
  }

  async function handleSave() {
    if (!selectedUser) return
    setSaving(true)
    setMessage('')
    try {
      // Remove all existing assignments for this user
      await fetch('/api/review-sources/' + sourceId + '/user-locations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: selectedUser }),
      })

      // Add new assignments
      if (selectedLocations.size > 0) {
        await fetch('/api/review-sources/' + sourceId + '/user-locations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: selectedUser, location_ids: Array.from(selectedLocations) }),
        })
      }

      // Refresh assignments
      const res = await fetch('/api/review-sources/' + sourceId + '/user-locations')
      const data = await res.json()
      setAssignments(data.assignments || [])
      setMessage(selectedLocations.size > 0
        ? 'Assigned ' + selectedLocations.size + ' location(s)'
        : 'Removed all location restrictions (user sees all data)')
    } catch (err: any) {
      setMessage('Failed: ' + (err?.message || 'Unknown error'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="bg-white border border-gray-200 rounded-2xl p-6 text-sm text-gray-400">Loading...</div>
  if (members.length === 0) return null

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col gap-4">
      <div>
        <h2 className="font-bold text-gray-800">Location Access</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Assign team members to specific locations. Members will only see reviews for their assigned locations.
          Owners and admins always see all locations.
        </p>
      </div>

      {/* Current assignments summary */}
      {Object.keys(userAssignments).length > 0 && (
        <div className="bg-gray-50 rounded-xl p-3 flex flex-col gap-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Current Assignments</p>
          {Object.entries(userAssignments).map(function([userId, assigns]) {
            const user = assigns[0]?.users
            const locs = assigns.map(function(a) {
              const loc = a.review_source_locations
              return loc ? loc.name : ''
            }).filter(Boolean)
            return (
              <div key={userId} className="flex items-center justify-between text-sm">
                <span className="text-gray-700">{user?.full_name || user?.email || userId}</span>
                <span className="text-xs text-gray-400">{locs.length} location(s)</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Assign form */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-gray-700">Team member</label>
          <select value={selectedUser} onChange={function(e) { handleSelectUser(e.target.value) }}
            className="w-full px-4 py-2.5 rounded-xl border border-gray-300 text-sm outline-none focus:border-orange-400 transition-colors">
            <option value="">Select a member...</option>
            {members.map(function(m) {
              const assignCount = (userAssignments[m.id] || []).length
              return (
                <option key={m.id} value={m.id}>
                  {m.full_name || m.email}{assignCount > 0 ? ' (' + assignCount + ' locations)' : ''}
                </option>
              )
            })}
          </select>
        </div>

        {selectedUser && (
          <>
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-gray-700">
                Locations ({selectedLocations.size} selected)
              </label>
              <div className="flex gap-2">
                <button onClick={function() {
                  const all = new Set<string>()
                  locations.forEach(function(l) { all.add(l.id) })
                  setSelectedLocations(all)
                }} className="text-xs font-semibold hover:underline" style={{ color: HERMES }}>All</button>
                <button onClick={function() { setSelectedLocations(new Set()) }}
                  className="text-xs font-semibold text-gray-400 hover:underline">None</button>
              </div>
            </div>
            <p className="text-xs text-gray-400 -mt-2">
              Select "None" to remove all restrictions — user will see all locations.
            </p>
            <div style={{ maxHeight: 200, overflowY: 'auto' }} className="flex flex-col gap-1 border border-gray-100 rounded-xl p-2">
              {locations.map(function(loc) {
                const checked = selectedLocations.has(loc.id)
                return (
                  <label key={loc.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer">
                    <input type="checkbox" checked={checked} onChange={function() { toggleLocation(loc.id) }}
                      style={{ accentColor: HERMES, width: 14, height: 14 }} />
                    <span className="text-sm text-gray-700">{loc.name}</span>
                    <span className="text-xs text-gray-400">{[loc.city, loc.state].filter(Boolean).join(', ')}</span>
                  </label>
                )
              })}
            </div>
            <button onClick={handleSave} disabled={saving}
              className="self-start px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-all hover:opacity-90"
              style={{ background: HERMES }}>
              {saving ? 'Saving...' : 'Save Assignments'}
            </button>
          </>
        )}

        {message && (
          <p className={'text-xs ' + (message.includes('Failed') ? 'text-red-500' : 'text-green-600')}>{message}</p>
        )}
      </div>
    </div>
  )
}
