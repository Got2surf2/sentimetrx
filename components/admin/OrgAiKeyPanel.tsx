'use client'

// components/admin/OrgAiKeyPanel.tsx
// Section on /admin/clients/[id] for provisioning a per-org Anthropic
// key. Two modes: "platform" (uses ANTHROPIC_API_KEY env, the default —
// platform absorbs cost, usage_log tracks per-org spend) and "byo"
// (this org's AI calls route through the customer's own Anthropic
// account). The secret itself is never returned to the browser; this
// panel only shows isSet + when/by-whom it was last set.

import { useEffect, useState } from 'react'

interface Props { orgId: string }

interface Status {
  mode:  'platform' | 'byo'
  isSet: boolean
  setAt: string | null
  setBy: string | null
}

const HERMES = '#E8632A'

export default function OrgAiKeyPanel({ orgId }: Props) {
  const [status, setStatus]   = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [flash, setFlash]     = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/ai-key`)
      const data = await res.json()
      if (res.ok) setStatus(data)
      else setError(data.error || 'Failed to load')
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [orgId])

  const setMode = async (mode: 'platform' | 'byo', api_key?: string) => {
    setSaving(true); setError(null)
    try {
      const body: Record<string, unknown> = { mode }
      if (api_key !== undefined) body.api_key = api_key
      const res = await fetch(`/api/admin/orgs/${orgId}/ai-key`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update')
      setStatus(data)
      setEditing(false); setKeyInput('')
      setFlash(mode === 'byo' ? 'BYO key saved' : 'Reverted to platform key')
      setTimeout(() => setFlash(null), 3000)
    } catch (e: any) {
      setError(e.message || 'Failed to update')
    } finally { setSaving(false) }
  }

  const onPlatform = status?.mode === 'platform'
  const setAtPretty = status?.setAt ? new Date(status.setAt).toLocaleString() : null

  if (loading) return <div className="text-sm text-gray-400">Loading AI key configuration…</div>

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-gray-500">
        Anthropic API key billing for AI features (theme mining, StoryTime, agents, search re-rank…).
      </p>

      <div className="flex flex-col gap-2">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="radio"
            name={'aikey-' + orgId}
            checked={onPlatform}
            onChange={() => setMode('platform')}
            disabled={saving}
            className="mt-0.5"
          />
          <span>
            <span className="text-sm font-semibold text-gray-800">Platform key</span>
            <span className="block text-xs text-gray-500">Routes through Sentimetrx's Anthropic account. Cost absorbed by the platform; per-org usage logged in <code className="font-mono">usage_log</code> for billing.</span>
          </span>
        </label>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="radio"
            name={'aikey-' + orgId}
            checked={!onPlatform}
            onChange={() => { if (status?.isSet) setMode('byo'); else setEditing(true) }}
            disabled={saving}
            className="mt-0.5"
          />
          <span>
            <span className="text-sm font-semibold text-gray-800">This org's own key (BYO)</span>
            <span className="block text-xs text-gray-500">All AI calls for this org route through the customer's Anthropic account. Sentimetrx never sees the bill.</span>
          </span>
        </label>
      </div>

      {/* Current BYO state */}
      {!onPlatform && status?.isSet && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900">
          <div className="font-semibold">Custom key in use</div>
          {setAtPretty && <div className="text-blue-700 mt-0.5">Last updated {setAtPretty}{status?.setBy ? ' by ' + status.setBy.slice(0, 8) + '…' : ''}</div>}
          <div className="mt-2 flex gap-2">
            <button onClick={() => { setEditing(true); setKeyInput('') }} disabled={saving}
              className="text-xs px-2 py-1 rounded bg-white border border-blue-300 text-blue-700 hover:bg-blue-100">
              Replace key
            </button>
            <button onClick={() => { if (confirm('Revert this org to the platform Anthropic key?')) setMode('platform') }} disabled={saving}
              className="text-xs px-2 py-1 rounded bg-white border border-red-300 text-red-700 hover:bg-red-50">
              Clear & revert to platform
            </button>
          </div>
        </div>
      )}

      {/* Key input — shown when switching to BYO from platform, or when replacing */}
      {editing && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 flex flex-col gap-2">
          <label className="text-xs font-semibold text-gray-700">Anthropic API key for this org</label>
          <input
            type="password"
            placeholder="sk-ant-..."
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            disabled={saving}
            className="w-full px-3 py-2 text-sm font-mono border border-gray-300 rounded-md focus:outline-none focus:border-orange-400"
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setEditing(false); setKeyInput(''); setError(null) }} disabled={saving}
              className="text-xs px-3 py-1.5 rounded bg-white border border-gray-300 text-gray-700">
              Cancel
            </button>
            <button onClick={() => { if (keyInput.trim()) setMode('byo', keyInput.trim()) }}
              disabled={saving || !keyInput.trim()}
              style={{ background: keyInput.trim() && !saving ? HERMES : '#fed7aa' }}
              className="text-xs px-3 py-1.5 rounded text-white font-semibold disabled:opacity-50">
              {saving ? 'Saving…' : 'Save BYO key'}
            </button>
          </div>
          <p className="text-[10px] text-gray-500">The key is stored encrypted on the server and never returned to any browser.</p>
        </div>
      )}

      {error && <div className="text-xs text-red-600">{error}</div>}
      {flash && <div className="text-xs text-green-700 font-semibold">{flash}</div>}
    </div>
  )
}
