'use client'

// components/admin/OrgAiKeyPanel.tsx
// Three-state AI mode picker for /admin/clients/[id]:
//   - Off         → no AI calls for this org under any circumstance
//   - Sentimetrx  → use platform env keys (default; cost absorbed, tracked in usage_log)
//   - BYO         → use the org's own API key; provider must be picked (Anthropic | OpenAI)
//
// The secret is never returned to the browser. This panel only shows
// isSet + when/by-whom it was last set + the chosen provider.

import { useEffect, useState } from 'react'

interface Props { orgId: string }

type Mode = 'off' | 'platform' | 'byo'
type Provider = 'anthropic' | 'openai'

interface Status {
  mode:     Mode
  provider: Provider
  isSet:    boolean
  setAt:    string | null
  setBy:    string | null
}

const HERMES = '#E8632A'

export default function OrgAiKeyPanel({ orgId }: Props) {
  const [status, setStatus]     = useState<Status | null>(null)
  const [loading, setLoading]   = useState(true)
  const [editing, setEditing]   = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [providerInput, setProviderInput] = useState<Provider>('anthropic')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [flash, setFlash]       = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/ai-key`)
      const data = await res.json()
      if (res.ok) {
        setStatus(data)
        setProviderInput((data.provider as Provider) || 'anthropic')
      } else {
        setError(data.error || 'Failed to load')
      }
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [orgId])

  const submit = async (body: Record<string, unknown>, successMsg: string) => {
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/admin/orgs/${orgId}/ai-key`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update')
      setStatus(data)
      setEditing(false); setKeyInput('')
      setFlash(successMsg)
      setTimeout(() => setFlash(null), 3000)
    } catch (e: any) {
      setError(e.message || 'Failed to update')
    } finally { setSaving(false) }
  }

  const pickOff      = () => submit({ mode: 'off' }, 'AI disabled for this org')
  const pickPlatform = () => submit({ mode: 'platform' }, 'Using Sentimetrx AI')
  const saveBYO      = () => {
    if (!keyInput.trim()) return
    void submit({ mode: 'byo', provider: providerInput, api_key: keyInput.trim() }, 'BYO key saved')
  }
  const rotateProvider = (p: Provider) => submit({ mode: 'byo', provider: p }, 'Provider updated')

  const onMode = status?.mode || 'platform'
  const setAtPretty = status?.setAt ? new Date(status.setAt).toLocaleString() : null

  if (loading) return <div className="text-sm text-gray-400">Loading AI configuration…</div>

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-gray-500">
        Controls every outbound AI call this org makes (theme mining, Reports, agents, search re-rank, embeddings, moderation).
      </p>

      <div className="flex flex-col gap-2">
        {/* Off */}
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="radio" name={'aimode-' + orgId} checked={onMode === 'off'}
            onChange={() => { void pickOff() }} disabled={saving} className="mt-0.5" />
          <span>
            <span className="text-sm font-semibold text-red-700">AI Off</span>
            <span className="block text-xs text-gray-500">No data leaves the platform to any AI vendor. AI-powered features will be unavailable for this org. For customers with data-residency or privacy concerns.</span>
          </span>
        </label>

        {/* Platform */}
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="radio" name={'aimode-' + orgId} checked={onMode === 'platform'}
            onChange={() => { void pickPlatform() }} disabled={saving} className="mt-0.5" />
          <span>
            <span className="text-sm font-semibold text-gray-800">Sentimetrx AI</span>
            <span className="block text-xs text-gray-500">Routes through Sentimetrx's Anthropic + OpenAI accounts. Cost absorbed by the platform; per-org usage logged in <code className="font-mono">usage_log</code> for billing.</span>
          </span>
        </label>

        {/* BYO */}
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="radio" name={'aimode-' + orgId} checked={onMode === 'byo'}
            onChange={() => { if (status?.isSet) void submit({ mode: 'byo', provider: status.provider }, 'Switched to BYO'); else setEditing(true) }}
            disabled={saving} className="mt-0.5" />
          <span>
            <span className="text-sm font-semibold text-gray-800">BYO key (Anthropic or OpenAI)</span>
            <span className="block text-xs text-gray-500">All AI for this org routes through the customer's account. OpenAI BYOK covers LLM + embeddings + moderation. Anthropic BYOK covers LLM only; embeddings/moderation fall back to Sentimetrx OpenAI (cost absorbed).</span>
          </span>
        </label>
      </div>

      {/* Current BYO state */}
      {onMode === 'byo' && status?.isSet && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-900">
          <div className="font-semibold">Customer key in use — {status.provider === 'openai' ? 'OpenAI' : 'Anthropic'}</div>
          {setAtPretty && <div className="text-blue-700 mt-0.5">Last updated {setAtPretty}{status.setBy ? ' by ' + status.setBy.slice(0, 8) + '…' : ''}</div>}
          <div className="mt-2 flex flex-wrap gap-2 items-center">
            {status.provider !== 'anthropic' && (
              <button onClick={() => { void rotateProvider('anthropic') }} disabled={saving}
                className="text-[11px] px-2 py-1 rounded bg-white border border-blue-300 text-blue-700 hover:bg-blue-100">
                Switch to Anthropic
              </button>
            )}
            {status.provider !== 'openai' && (
              <button onClick={() => { void rotateProvider('openai') }} disabled={saving}
                className="text-[11px] px-2 py-1 rounded bg-white border border-blue-300 text-blue-700 hover:bg-blue-100">
                Switch to OpenAI
              </button>
            )}
            <button onClick={() => { setEditing(true); setKeyInput(''); setProviderInput(status.provider) }} disabled={saving}
              className="text-[11px] px-2 py-1 rounded bg-white border border-blue-300 text-blue-700 hover:bg-blue-100">
              Replace key
            </button>
            <button onClick={() => { if (confirm('Revert this org to Sentimetrx AI?')) void pickPlatform() }} disabled={saving}
              className="text-[11px] px-2 py-1 rounded bg-white border border-red-300 text-red-700 hover:bg-red-50">
              Clear & revert
            </button>
          </div>
        </div>
      )}

      {/* Key input — shown when switching to BYO from another mode, or when replacing */}
      {editing && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 flex flex-col gap-2">
          <label className="text-xs font-semibold text-gray-700">Provider</label>
          <div className="flex gap-2">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input type="radio" name={'provider-' + orgId} checked={providerInput === 'anthropic'}
                onChange={() => setProviderInput('anthropic')} disabled={saving} />
              Anthropic
            </label>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input type="radio" name={'provider-' + orgId} checked={providerInput === 'openai'}
                onChange={() => setProviderInput('openai')} disabled={saving} />
              OpenAI
            </label>
          </div>
          <label className="text-xs font-semibold text-gray-700">{providerInput === 'openai' ? 'OpenAI' : 'Anthropic'} API key</label>
          <input
            type="password"
            placeholder={providerInput === 'openai' ? 'sk-...' : 'sk-ant-...'}
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
            <button onClick={saveBYO}
              disabled={saving || !keyInput.trim()}
              style={{ background: keyInput.trim() && !saving ? HERMES : '#fed7aa' }}
              className="text-xs px-3 py-1.5 rounded text-white font-semibold disabled:opacity-50">
              {saving ? 'Saving…' : 'Save BYO key'}
            </button>
          </div>
          <p className="text-[10px] text-gray-500">The key is stored server-side and never returned to any browser.</p>
        </div>
      )}

      {error && <div className="text-xs text-red-600">{error}</div>}
      {flash && <div className="text-xs text-green-700 font-semibold">{flash}</div>}
    </div>
  )
}
