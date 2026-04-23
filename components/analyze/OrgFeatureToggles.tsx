'use client'

import { useState } from 'react'
import type { Industry } from '@/lib/industryDefaults'
import { INDUSTRY_LABELS } from '@/lib/industryDefaults'
import { MODULE_LABELS, type ModuleFeatures } from '@/lib/types'

const MODULE_DESCRIPTIONS: Record<keyof ModuleFeatures, string> = {
  surveys:       'Sarina conversational surveys — create, deploy, and analyze',
  analyze:       'Ana text analytics — upload datasets, mine themes, generate reports',
  googleReviews: 'Google Reviews downloader — import reviews from any business',
  reddit:        'Reddit downloader — pull threads and comments for analysis',
  substack:      'Substack analyzer — download reader comments from publications',
  townhall:      'SignalIQ — intelligent signal extraction from continuous conversation streams',
  campaigns:     'Email campaigns — distribute surveys to respondent lists',
  bots:          'Agents — create branded AI agents trained on custom content',
}

interface Props {
  orgId:           string
  initialFeatures: ModuleFeatures & { primaryIndustries?: Industry[] }
}

export default function OrgFeatureToggles({ orgId, initialFeatures }: Props) {
  const [features, setFeatures] = useState(initialFeatures)
  const [primaryIndustries, setPrimaryIndustries] = useState<Industry[]>(initialFeatures.primaryIndustries || [])
  const [saving, setSaving]     = useState(false)
  const [status, setStatus]     = useState<'idle' | 'saved' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function saveFeatures(updated: any) {
    setSaving(true)
    setStatus('idle')
    setErrorMsg('')

    try {
      const res = await fetch('/api/admin/orgs/' + orgId, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ features: updated }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Server returned ' + res.status)
      }

      setStatus('saved')
      setTimeout(() => setStatus('idle'), 2500)
    } catch (err: any) {
      setStatus('error')
      setErrorMsg(err.message || 'Failed to save')
      setTimeout(() => setStatus('idle'), 4000)
    } finally {
      setSaving(false)
    }
  }

  async function toggle(key: keyof ModuleFeatures) {
    const next = { ...features, [key]: !features[key], primaryIndustries }
    // Validate: at least one feature must remain enabled
    const moduleKeys = Object.keys(MODULE_LABELS) as (keyof ModuleFeatures)[]
    const enabledCount = moduleKeys.filter(function(k) { return !!next[k] }).length
    if (enabledCount === 0) {
      setStatus('error')
      setErrorMsg('At least one feature must be enabled')
      setTimeout(() => setStatus('idle'), 3000)
      return
    }
    setFeatures(next)
    await saveFeatures(next)
  }

  async function toggleIndustry(industry: Industry) {
    const updated = primaryIndustries.includes(industry)
      ? primaryIndustries.filter(i => i !== industry)
      : [...primaryIndustries, industry]
    setPrimaryIndustries(updated)
    const next = { ...features, primaryIndustries: updated }
    await saveFeatures(next)
  }

  const allIndustries = (Object.keys(INDUSTRY_LABELS) as Industry[]).sort((a, b) =>
    INDUSTRY_LABELS[a].localeCompare(INDUSTRY_LABELS[b])
  )

  const moduleKeys = Object.keys(MODULE_LABELS) as (keyof ModuleFeatures)[]

  return (
    <div className="flex flex-col gap-6">
      {status === 'error' && (
        <p className="text-xs text-red-500 bg-red-50 border border-red-200 rounded px-3 py-2">{'Error: ' + errorMsg}</p>
      )}

      {/* Module Feature Toggles */}
      {moduleKeys.map(function(key) {
        return (
          <div key={key} className="flex items-center justify-between py-2 border-b border-gray-200 pb-4">
            <div>
              <p className="text-sm font-medium text-gray-800">{MODULE_LABELS[key]}</p>
              <p className="text-xs text-gray-500 mt-0.5">{MODULE_DESCRIPTIONS[key]}</p>
            </div>
            <div className="flex items-center gap-2">
              {saving && <span className="text-xs text-gray-400">Saving...</span>}
              {status === 'saved' && <span className="text-xs text-green-600">Saved</span>}
              <ToggleSwitch
                enabled={!!features[key]}
                onToggle={() => toggle(key)}
                disabled={saving}
              />
            </div>
          </div>
        )
      })}

      {/* Primary Industries Multi-select */}
      <div>
        <p className="text-sm font-medium text-gray-800 mb-2">Primary Industries</p>
        <p className="text-xs text-gray-500 mb-3">
          These industries appear first in the Study Builder for users in this organization.
        </p>
        <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-3">
          {allIndustries.map(industry => (
            <label
              key={industry}
              className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1.5 rounded"
            >
              <input
                type="checkbox"
                checked={primaryIndustries.includes(industry)}
                onChange={() => toggleIndustry(industry)}
                disabled={saving}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 cursor-pointer"
              />
              <span className="text-sm text-gray-700">{INDUSTRY_LABELS[industry]}</span>
            </label>
          ))}
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
