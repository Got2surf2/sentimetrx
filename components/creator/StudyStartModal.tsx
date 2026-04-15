'use client'

// components/creator/StudyStartModal.tsx
// Pre-wizard modal shown when creating a new study.
// User describes their goal in plain text; AI generates starter values.

import { useState, useRef } from 'react'
import type { StudyDraft } from '@/lib/studyDraft'
import { INDUSTRY_LABELS, type Industry } from '@/lib/industryDefaults'

const HERMES    = '#e8622a'
const HERMES_BG = '#fff4ef'

const EXAMPLES = [
  'Patient satisfaction at a medical clinic — understand why patients do or don\'t return',
  'Employee experience for a software company — measure team morale and identify pain points',
  'Customer feedback for a casual dining restaurant — improve food, service, and atmosphere',
  'Event feedback for a performing arts venue — capture audience impressions after shows',
]

interface Suggestion {
  name:         string
  bot_name:     string
  bot_emoji:    string
  industry:     string
  greeting:     string
  npsEnabled:   boolean
  npsPrompt:    string
  ratingPrompt: string
  promoterQ1:   string
  passiveQ1:    string
  detractorQ1:  string
  q3:           string
  q4Enabled:    boolean
  q4:           string
}

interface Props {
  onApply:  (partial: Partial<StudyDraft>) => void
  onSkip:   () => void
}

export default function StudyStartModal({ onApply, onSkip }: Props) {
  const [description, setDescription] = useState('')
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')
  const [preview,     setPreview]     = useState<Suggestion | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  async function handleGenerate() {
    const desc = description.trim()
    if (desc.length < 10) { setError('Please describe your study in a bit more detail.'); return }
    setError('')
    setLoading(true)
    try {
      const res  = await fetch('/api/ai/study-suggest', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ description: desc }),
      })
      const data = await res.json()
      if (!res.ok || !data.suggestion) throw new Error(data.error || 'Generation failed')
      setPreview(data.suggestion)
    } catch (e: any) {
      setError(e.message || 'Something went wrong — try again or start from scratch.')
    } finally {
      setLoading(false)
    }
  }

  function handleApply() {
    if (!preview) return
    const partial: Partial<StudyDraft> = {
      name:      preview.name,
      bot_name:  preview.bot_name,
      bot_emoji: preview.bot_emoji,
      industry:  preview.industry as any,
      config: {
        // Spread defaults that the wizard would normally provide
        ratingScale: [
          { emoji: '😞', label: 'Very poor',  score: 1 },
          { emoji: '😕', label: 'Poor',       score: 2 },
          { emoji: '😐', label: 'Okay',       score: 3 },
          { emoji: '😊', label: 'Good',       score: 4 },
          { emoji: '😍', label: 'Excellent',  score: 5 },
        ],
        clarifiers:        { default: '' },
        questions:         [],
        psychoCount:       3,
        psychographicBank: [],
        theme: {
          primaryColor:      '#00b4d8',
          headerGradient:    'linear-gradient(135deg, #00b4d8, #0077a8)',
          backgroundColor:   '#0a1628',
          accentColor:       '#00d4ff',
          botAvatarGradient: 'linear-gradient(135deg, #00b4d8, #0077a8)',
        },
        // AI-generated fields
        greeting:     preview.greeting,
        npsEnabled:   preview.npsEnabled,
        npsPrompt:    preview.npsEnabled ? preview.npsPrompt : '',
        ratingPrompt: preview.ratingPrompt,
        promoterQ1:   preview.promoterQ1,
        passiveQ1:    preview.passiveQ1,
        detractorQ1:  preview.detractorQ1,
        q3:           preview.q3,
        q3Enabled:    true,
        q4:           preview.q4Enabled ? preview.q4 : '',
        q4Enabled:    preview.q4Enabled,
        industry:     preview.industry,
      } as any,
    }
    onApply(partial)
  }

  function handleExample(ex: string) {
    setDescription(ex)
    setPreview(null)
    setError('')
    taRef.current?.focus()
  }

  // ── Preview screen ─────────────────────────────────────────────────────────
  if (preview) {
    return (
      <Overlay>
        <div style={{ width: '100%', maxWidth: 560 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <span style={{ fontSize: 32 }}>{preview.bot_emoji}</span>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: '#111827', margin: 0 }}>
                {preview.name || 'Your new study'}
              </h2>
              <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
                Meet <strong>{preview.bot_name}</strong> · {INDUSTRY_LABELS[preview.industry as Industry] || preview.industry}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
            <PreviewRow label="Opening" value={preview.greeting} />
            <PreviewRow label="Rating prompt" value={preview.ratingPrompt} />
            {preview.npsEnabled && <PreviewRow label="NPS question" value={preview.npsPrompt} />}
            <PreviewRow label="Main question" value={preview.q3} />
            {preview.q4Enabled && <PreviewRow label="Second question" value={preview.q4} />}
          </div>

          <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 20, textAlign: 'center' }}>
            These are starting suggestions — you can edit every detail in the wizard.
          </p>

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={handleApply}
              style={{ flex: 1, padding: '11px 0', fontSize: 14, fontWeight: 700, color: 'white', background: HERMES, border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit' }}>
              Use these suggestions →
            </button>
            <button onClick={function() { setPreview(null) }}
              style={{ padding: '11px 16px', fontSize: 13, fontWeight: 600, color: '#374151', background: '#f3f4f6', border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit' }}>
              Try again
            </button>
          </div>
          <div style={{ textAlign: 'center', marginTop: 12 }}>
            <button onClick={onSkip} style={{ fontSize: 12, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}>
              Start from scratch instead
            </button>
          </div>
        </div>
      </Overlay>
    )
  }

  // ── Entry screen ───────────────────────────────────────────────────────────
  return (
    <Overlay>
      <div style={{ width: '100%', maxWidth: 540 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: HERMES_BG, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
            ✨
          </div>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: '#111827', margin: 0 }}>Start with AI suggestions</h2>
            <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>Describe what you want to learn — we'll fill in a starting point.</p>
          </div>
        </div>

        {/* Text area */}
        <div style={{ margin: '20px 0 12px' }}>
          <textarea
            ref={taRef}
            value={description}
            onChange={function(e) { setDescription(e.target.value); setError('') }}
            onKeyDown={function(e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate() }}
            placeholder="e.g. 'We want to understand why patients at our clinic aren't scheduling follow-up appointments'"
            rows={3}
            style={{
              width: '100%', padding: '12px 14px', fontSize: 14, lineHeight: 1.55,
              border: '1.5px solid #d1d5db', borderRadius: 10, outline: 'none',
              fontFamily: 'inherit', resize: 'vertical', color: '#111827',
              background: 'white', boxSizing: 'border-box',
            }}
            onFocus={function(e) { e.target.style.borderColor = HERMES }}
            onBlur={function(e) { e.target.style.borderColor = '#d1d5db' }}
            autoFocus
          />
          {error && (
            <p style={{ fontSize: 12, color: '#dc2626', margin: '6px 0 0' }}>{error}</p>
          )}
        </div>

        {/* Example chips */}
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.06em', margin: '0 0 8px' }}>
            Examples
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {EXAMPLES.map(function(ex) {
              return (
                <button key={ex} onClick={function() { handleExample(ex) }}
                  style={{
                    textAlign: 'left', padding: '7px 11px', fontSize: 12, color: '#374151',
                    background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8,
                    cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1.45, transition: 'background .1s',
                  }}
                  onMouseEnter={function(e) { (e.currentTarget as HTMLButtonElement).style.background = HERMES_BG }}
                  onMouseLeave={function(e) { (e.currentTarget as HTMLButtonElement).style.background = '#f9fafb' }}>
                  {ex}
                </button>
              )
            })}
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button onClick={handleGenerate} disabled={loading || description.trim().length < 10}
            style={{
              flex: 1, padding: '11px 0', fontSize: 14, fontWeight: 700, color: 'white',
              background: loading || description.trim().length < 10 ? '#f3a07a' : HERMES,
              border: 'none', borderRadius: 10, cursor: loading || description.trim().length < 10 ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
            {loading ? (
              <>
                <span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,.4)', borderTopColor: 'white', borderRadius: '50%', animation: '_bspin .7s linear infinite', display: 'inline-block' }} />
                Generating…
              </>
            ) : 'Generate suggestions →'}
          </button>
          <button onClick={onSkip}
            style={{ padding: '11px 16px', fontSize: 13, fontWeight: 600, color: '#6b7280', background: '#f3f4f6', border: 'none', borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
            Skip
          </button>
        </div>

        <p style={{ fontSize: 11, color: '#d1d5db', textAlign: 'center', margin: '12px 0 0' }}>
          ⌘ + Enter to generate
        </p>
      </div>
      <style>{`@keyframes _bspin{to{transform:rotate(360deg)}}`}</style>
    </Overlay>
  )
}

// ── Small helpers ──────────────────────────────────────────────────────────

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        background: 'white', borderRadius: 16, padding: '28px 28px 24px',
        boxShadow: '0 24px 64px rgba(0,0,0,.22)', width: '100%', maxWidth: 560,
      }}>
        {children}
      </div>
    </div>
  )
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '9px 12px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.5 }}>{value}</div>
    </div>
  )
}

