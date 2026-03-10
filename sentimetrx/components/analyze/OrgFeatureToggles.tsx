'use client'

import { useState } from 'react'

interface Props {
  orgId:           string
  initialFeatures: { analyze?: boolean }
}

export default function OrgFeatureToggles({ orgId, initialFeatures }: Props) {
  const [features, setFeatures] = useState(initialFeatures)
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)

  async function toggle(key: 'analyze') {
    const next = { ...features, [key]: !features[key] }
    setFeatures(next)
    setSaving(true)
    setSaved(false)
    await fetch('/api/admin/orgs/' + orgId, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ features: next }),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between py-2">
        <div>
          <p className="text-sm font-medium text-gray-800">Analyze Module</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Enables the Ana analytics module for all users in this org
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saving && <span className="text-xs text-gray-400">Saving...</span>}
          {saved  && <span className="text-xs text-green-600">Saved</span>}
          <ToggleSwitch
            enabled={!!features.analyze}
            onToggle={() => toggle('analyze')}
          />
        </div>
      </div>
    </div>
  )
}

// Toggle switch -- uses inline styles per SWC rules
function ToggleSwitch({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      style={{
        display:         'inline-flex',
        alignItems:      'center',
        width:           44,
        height:          24,
        borderRadius:    9999,
        padding:         2,
        background:      enabled ? '#E8632A' : '#D1D5DB',
        transition:      'background 0.2s',
        border:          'none',
        cursor:          'pointer',
        flexShrink:      0,
      }}>
      <span style={{
        display:     'inline-block',
        width:       20,
        height:      20,
        borderRadius: 9999,
        background:  'white',
        boxShadow:   '0 1px 3px rgba(0,0,0,0.2)',
        transform:   enabled ? 'translateX(20px)' : 'translateX(0)',
        transition:  'transform 0.2s',
      }} />
    </button>
  )
}
