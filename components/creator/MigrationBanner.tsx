'use client'

// components/creator/MigrationBanner.tsx
// Shown when editing a study created before the blueprint system (no studyType)
// Allows users to assign a study type for analytics + metadata

import { useState } from 'react'
import { STUDY_TYPE_BLUEPRINTS, STUDY_TYPE_LABELS, type StudyType } from '@/lib/surveyBlueprints'
import type { StudyConfig } from '@/lib/types'

const HERMES = '#e8622a'
const HERMES_BG = '#fff4ef'

interface Props {
  studyId: string
  currentConfig: StudyConfig
  onStudyTypeAdded: (config: StudyConfig) => void
}

export default function MigrationBanner({ studyId, currentConfig, onStudyTypeAdded }: Props) {
  const dismissalKey = `dismissed_migration_${studyId}`
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem(dismissalKey) === 'true'
  })
  const [showPicker, setShowPicker] = useState(false)
  const [saving, setSaving] = useState(false)

  // Only show if studyType is missing
  if (currentConfig.studyType) {
    return null
  }

  const handleDismiss = () => {
    setDismissed(true)
    if (typeof window !== 'undefined') {
      localStorage.setItem(dismissalKey, 'true')
    }
  }

  const handleSelectStudyType = async (studyType: StudyType) => {
    setSaving(true)
    try {
      const blueprint = STUDY_TYPE_BLUEPRINTS[studyType]
      const updatedConfig = {
        ...currentConfig,
        studyType,
        templateLabel: blueprint.templateLabel,
      }

      const res = await fetch(`/api/studies/${studyId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: updatedConfig }),
      })

      if (!res.ok) {
        throw new Error('Failed to update study')
      }

      // Dismiss and notify parent
      handleDismiss()
      onStudyTypeAdded(updatedConfig)
      setShowPicker(false)
    } catch (error) {
      console.error('Failed to add study type:', error)
    } finally {
      setSaving(false)
    }
  }

  if (dismissed) {
    return null
  }

  return (
    <div style={{
      background: HERMES_BG,
      border: `1px solid ${HERMES}`,
      borderRadius: 10,
      padding: 16,
      marginBottom: 20,
    }}>
      {!showPicker ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, color: '#111827', margin: '0 0 4px' }}>
              ✨ Add a study type
            </p>
            <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>
              This study was created before our blueprint system. Adding a study type unlocks richer analytics and organization features.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => setShowPicker(true)}
              style={{
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 600,
                color: 'white',
                background: HERMES,
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all .15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#d45619' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = HERMES }}>
              Add Study Type
            </button>
            <button
              onClick={handleDismiss}
              style={{
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 600,
                color: '#6b7280',
                background: '#ffffff',
                border: `1px solid #d1d5db`,
                borderRadius: 8,
                cursor: 'pointer',
                fontFamily: 'inherit',
                transition: 'all .15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#f9fafb' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#ffffff' }}>
              Dismiss
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#111827', margin: '0 0 12px' }}>
            Choose a study type
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8, marginBottom: 16 }}>
            {(Object.keys(STUDY_TYPE_LABELS) as StudyType[]).map(type => {
              const labels = STUDY_TYPE_LABELS[type]
              return (
                <button
                  key={type}
                  onClick={() => { void handleSelectStudyType(type) }}
                  disabled={saving}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 6,
                    padding: 12,
                    fontSize: 12,
                    fontWeight: 600,
                    color: '#6b7280',
                    background: '#ffffff',
                    border: '1px solid #d1d5db',
                    borderRadius: 8,
                    cursor: saving ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                    textAlign: 'center',
                    opacity: saving ? 0.6 : 1,
                    transition: 'all .15s',
                  }}
                  onMouseEnter={e => { if (!saving) (e.currentTarget as HTMLButtonElement).style.background = '#f9fafb' }}
                  onMouseLeave={e => { if (!saving) (e.currentTarget as HTMLButtonElement).style.background = '#ffffff' }}>
                  <span style={{ fontSize: 18 }}>{labels.icon}</span>
                  <span style={{ lineHeight: 1.2 }}>{labels.label}</span>
                </button>
              )
            })}
          </div>
          <button
            onClick={() => setShowPicker(false)}
            disabled={saving}
            style={{
              padding: '8px 14px',
              fontSize: 12,
              fontWeight: 600,
              color: '#6b7280',
              background: 'transparent',
              border: 'none',
              cursor: saving ? 'not-allowed' : 'pointer',
              textDecoration: 'underline',
              fontFamily: 'inherit',
              transition: 'color .15s',
              opacity: saving ? 0.6 : 1,
            }}
            onMouseEnter={e => { if (!saving) (e.currentTarget as HTMLButtonElement).style.color = '#374151' }}
            onMouseLeave={e => { if (!saving) (e.currentTarget as HTMLButtonElement).style.color = '#6b7280' }}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
