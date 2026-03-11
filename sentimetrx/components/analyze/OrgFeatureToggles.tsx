'use client'

import { useState } from 'react'

interface Props {
  orgId:           string
  initialFeatures: { analyze?: boolean }
}

export default function OrgFeatureToggles({ orgId, initialFeatures }: Props) {
  const [features, setFeatures] = useState(initialFeatures)
  const [saving, setSaving]     = useState(false)
  const [status, setStatus]     = useState<'idle' | 'saved' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function toggle(key: 'analyze') {
    const next = { ...features, [key]: !features[key] }
    setFeatures(next)
    setSaving(true)
    setStatus('idle')
    setErrorMsg('')

    try {
      const res = await fetch('/api/admin/orgs/' + orgId, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ features: next }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Server returned ' + res.status)
      }

      setStatus('saved')
      setTimeout(() => setStatus('idle'), 2500)
    } catch (err: any) {
      // Revert the optimistic update on failure
      setFeatures(features)
      setStatus('error')
      setErrorMsg(err.message || 'Failed to save')
      setTimeout(() => setStatus('idle'), 4000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between py-2">
        <div>
          <p className="text-sm font-medium text-gray-800">Analyze Module</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Enables the Ana analytics module for all users in this org
          </p>
          {status === 'error' && (
            <p className="text-xs text-red-500 mt-1">{'Error: ' + errorMsg}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {saving && <span className="text-xs text-gray-400">Saving...</span>}
          {status === 'saved' && <span className="text-xs text-green-600">Saved</span>}
          <ToggleSwitch
            enabled={!!features.analyze}
            onToggle={() => toggle('analyze')}
            disabled={saving}
          />
        </div>
      </div>
    </div>
  )
}

function ToggleSwitch({ enabled, onToggle, disabled }: { enabled: boolean; onToggle: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      style={{
        display:     'inline-flex',
        alignItems:  'center',
        width:       44,
        height:      24,
        borderRadius: 9999,
        padding:     2,
        background:  enabled ? '#E8632A' : '#D1D5DB',
        transition:  'background 0.2s',
        border:      'none',
        cursor:      disabled ? 'not-allowed' : 'pointer',
        opacity:     disabled ? 0.6 : 1,
        flexShrink:  0,
      }}>
      <span style={{
        display:      'inline-block',
        width:        20,
        height:       20,
        borderRadius: 9999,
        background:   'white',
        boxShadow:    '0 1px 3px rgba(0,0,0,0.2)',
        transform:    enabled ? 'translateX(20px)' : 'translateX(0)',
        transition:   'transform 0.2s',
      }} />
    </button>
  )
}
