'use client'

// components/creator/SmartStudyWizard.tsx
// 5-step guided wizard for creating surveys from blueprints
// Step 0: Industry (alphabetized, primary first)
// Step 1: Study Type (7 blueprints)
// Step 2: Bot Setup (name + emoji suggestions)
// Step 3: Focus Areas (auto-selected, adjustable)
// Step 4: Length (quick/standard/comprehensive)

import { useState } from 'react'
import type { StudyDraft } from '@/lib/studyDraft'
import { generateStudyDraft, type WizardAnswers } from '@/lib/smartStudyGenerator'
import { STUDY_TYPE_BLUEPRINTS, STUDY_TYPE_LABELS, getBlueprintForStudyType, type StudyType } from '@/lib/surveyBlueprints'
import { INDUSTRY_LABELS, type Industry } from '@/lib/industryDefaults'

const HERMES = '#e8622a'
const HERMES_BG = '#fff4ef'

const INDUSTRY_EMOJIS: Record<Industry, string> = {
  healthcare:          '🏥',
  hospitality:         '🏨',
  casual_dining:       '🍔',
  fine_dining:         '🍽️',
  fast_food:           '⚡',
  travel_tourism:      '✈️',
  political:           '🗳️',
  media_entertainment: '🎬',
  performing_arts:     '🎭',
  saas_software:       '💻',
  retail_ecommerce:    '🛍️',
  financial_services:  '💳',
  education:           '📚',
  higher_education:    '🎓',
  hr_employee:         '👥',
  sports:              '⚽',
  nonprofit:           '🤝',
  automotive_repair:   '🔧',
  other:               '📋',
}

interface Props {
  onGenerated: (draft: StudyDraft) => void
  onSkip: () => void
  orgPrimaryIndustries?: Industry[]
}

export default function SmartStudyWizard({ onGenerated, onSkip, orgPrimaryIndustries = [] }: Props) {
  const [step, setStep] = useState(0)
  const [generating, setGenerating] = useState(false)

  // Wizard answers state
  const [industry, setIndustry] = useState<Industry | null>(null)
  const [studyType, setStudyType] = useState<StudyType | null>(null)
  const [botName, setBotName] = useState<string>('')
  const [botEmoji, setBotEmoji] = useState<string>('💬')
  const [focusAreas, setFocusAreas] = useState<string[]>([])
  const [length, setLength] = useState<'quick' | 'standard' | 'comprehensive'>('standard')
  const [openEnded, setOpenEnded] = useState<0 | 1 | 2>(1)

  // Get current blueprint
  const blueprint = studyType ? getBlueprintForStudyType(studyType) : null

  // Reset downstream state when upstream changes
  const handleIndustryChange = (ind: Industry) => {
    setIndustry(ind)
    setStudyType(null)
    setBotName('')
    setBotEmoji('💬')
    setFocusAreas([])
  }

  const handleStudyTypeChange = (st: StudyType) => {
    const bp = getBlueprintForStudyType(st)
    setStudyType(st)
    setFocusAreas(bp.recommendedFocusAreas)
    setOpenEnded(bp.openEndedDefault)
    setBotName('') // Reset bot name so user picks from suggestions
  }

  const handleBotSuggestionClick = (name: string, emoji: string) => {
    setBotName(name)
    setBotEmoji(emoji)
  }

  const handleFocusAreaToggle = (area: string) => {
    setFocusAreas(prev =>
      prev.includes(area) ? prev.filter(f => f !== area) : [...prev, area]
    )
  }

  const handleResetFocusAreas = () => {
    if (blueprint) {
      setFocusAreas(blueprint.recommendedFocusAreas)
    }
  }

  const handleGenerate = () => {
    if (!industry || !studyType || focusAreas.length === 0 || botName.trim().length === 0) return

    setGenerating(true)
    const answers: WizardAnswers = {
      industry,
      studyType,
      focusAreas,
      length,
      openEnded,
      botName: botName.trim(),
      botEmoji,
    }

    // Simulate delay for visual feedback
    setTimeout(() => {
      const draft = generateStudyDraft(answers)
      setGenerating(false)
      onGenerated(draft)
    }, 300)
  }

  const canGoNext = (): boolean => {
    switch (step) {
      case 0: return industry !== null
      case 1: return studyType !== null
      case 2: return botName.trim().length > 0
      case 3: return focusAreas.length > 0
      case 4: return true
      default: return false
    }
  }

  const progress = (step + 1) / 5

  // ────────────────────────────────────────────────────────────────
  // Step 0: Industry Selection (Alphabetized, primary first)
  // ────────────────────────────────────────────────────────────────
  if (step === 0) {
    const allIndustries = (Object.keys(INDUSTRY_LABELS) as Industry[]).sort((a, b) =>
      INDUSTRY_LABELS[a].localeCompare(INDUSTRY_LABELS[b])
    )
    const primary = orgPrimaryIndustries.filter(ind => INDUSTRY_LABELS[ind])
    const secondary = allIndustries.filter(ind => !primary.includes(ind))

    return (
      <Overlay>
        <div style={{ width: '100%', maxWidth: 720 }}>
          <Header step={step} totalSteps={5} progress={progress} title="Choose your industry" subtitle="This helps us suggest relevant study types and questions." />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 12, marginBottom: 24 }}>
            {/* Primary industries section */}
            {primary.length > 0 && (
              <>
                {primary.map(ind => (
                  <IndustryCard
                    key={ind}
                    industry={ind}
                    selected={industry === ind}
                    onClick={() => handleIndustryChange(ind)}
                  />
                ))}
                {/* Divider row */}
                <div style={{ gridColumn: '1 / -1', height: 1, background: '#e5e7eb', margin: '4px 0' }} />
              </>
            )}
            {/* Secondary industries section */}
            {secondary.map(ind => (
              <IndustryCard
                key={ind}
                industry={ind}
                selected={industry === ind}
                onClick={() => handleIndustryChange(ind)}
              />
            ))}
          </div>

          <Footer step={step} totalSteps={5} onBack={() => {}} onNext={() => setStep(1)} onSkip={onSkip} canNext={canGoNext()} hideBack />
        </div>
      </Overlay>
    )
  }

  // ────────────────────────────────────────────────────────────────
  // Step 1: Study Type (7 blueprints)
  // ────────────────────────────────────────────────────────────────
  if (step === 1) {
    const types: StudyType[] = [
      'satisfaction_experience',
      'nps_loyalty',
      'awareness_perception',
      'motivation_values',
      'churn_risk',
      'engagement_participation',
      'journey_touchpoint',
    ]

    return (
      <Overlay>
        <div style={{ width: '100%', maxWidth: 720 }}>
          <Header step={step} totalSteps={5} progress={progress} title="What's your research goal?" subtitle="Choose a study type template." />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
            {types.map(type => {
              const labels = STUDY_TYPE_LABELS[type]
              const isPopular = type === 'satisfaction_experience'
              return (
                <button
                  key={type}
                  onClick={() => handleStudyTypeChange(type)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 14,
                    width: '100%',
                    padding: '16px 14px',
                    fontSize: 14,
                    fontWeight: 500,
                    color: '#374151',
                    background: studyType === type ? HERMES_BG : '#ffffff',
                    border: `2px solid ${studyType === type ? HERMES : '#e5e7eb'}`,
                    borderRadius: 10,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    textAlign: 'left',
                    transition: 'all .15s',
                  }}
                  onMouseEnter={e => { if (studyType !== type) (e.currentTarget as HTMLButtonElement).style.background = '#f9fafb' }}
                  onMouseLeave={e => { if (studyType !== type) (e.currentTarget as HTMLButtonElement).style.background = '#ffffff' }}>
                  <div style={{ fontSize: 24, flexShrink: 0 }}>{labels.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, marginBottom: 2 }}>{labels.label}</div>
                    <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.4 }}>{labels.description}</div>
                    {isPopular && (
                      <div style={{ fontSize: 10, color: HERMES, fontWeight: 700, marginTop: 6, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                        ⭐ Most Popular
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          <Footer step={step} totalSteps={5} onBack={() => setStep(0)} onNext={() => setStep(2)} onSkip={onSkip} canNext={canGoNext()} />
        </div>
      </Overlay>
    )
  }

  // ────────────────────────────────────────────────────────────────
  // Step 2: Bot Setup (Name + Emoji)
  // ────────────────────────────────────────────────────────────────
  if (step === 2) {
    const suggestions = blueprint?.botSuggestions || []

    return (
      <Overlay>
        <div style={{ width: '100%', maxWidth: 720 }}>
          <Header step={step} totalSteps={5} progress={progress} title="Name your bot" subtitle="Choose a suggested name or create your own." />

          {/* Suggestion cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 20 }}>
            {suggestions.map((sugg, idx) => (
              <button
                key={idx}
                onClick={() => handleBotSuggestionClick(sugg.name, sugg.emoji)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                  padding: 12,
                  fontSize: 13,
                  fontWeight: 600,
                  color: botName === sugg.name ? HERMES : '#6b7280',
                  background: botName === sugg.name ? HERMES_BG : '#f9fafb',
                  border: `2px solid ${botName === sugg.name ? HERMES : '#e5e7eb'}`,
                  borderRadius: 10,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textAlign: 'center',
                  transition: 'all .15s',
                }}
                onMouseEnter={e => { if (botName !== sugg.name) (e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6' }}
                onMouseLeave={e => { if (botName !== sugg.name) (e.currentTarget as HTMLButtonElement).style.background = '#f9fafb' }}>
                <span style={{ fontSize: 28 }}>{sugg.emoji}</span>
                <span style={{ lineHeight: 1.3 }}>{sugg.name}</span>
              </button>
            ))}
          </div>

          {/* Custom input */}
          <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, marginBottom: 24 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '.06em' }}>Custom bot setup</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                type="text"
                value={botName}
                onChange={e => setBotName(e.target.value)}
                placeholder="Bot name"
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  fontSize: 14,
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  fontFamily: 'inherit',
                  outline: 'none',
                }}
              />
              <input
                type="text"
                value={botEmoji}
                onChange={e => setBotEmoji(e.target.value.slice(0, 1))}
                maxLength={1}
                placeholder="😊"
                style={{
                  width: 50,
                  padding: '10px 6px',
                  fontSize: 20,
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                  fontFamily: 'inherit',
                  textAlign: 'center',
                  outline: 'none',
                }}
              />
            </div>
          </div>

          <Footer step={step} totalSteps={5} onBack={() => setStep(1)} onNext={() => setStep(3)} onSkip={onSkip} canNext={canGoNext()} />
        </div>
      </Overlay>
    )
  }

  // ────────────────────────────────────────────────────────────────
  // Step 3: Focus Areas (Multi-select)
  // ────────────────────────────────────────────────────────────────
  if (step === 3) {
    const allFocusAreas = [
      { key: 'retention', label: 'Retention & Churn', icon: '🔄' },
      { key: 'communication', label: 'Communication', icon: '📢' },
      { key: 'recognition', label: 'Recognition & Appreciation', icon: '🙏' },
      { key: 'motivation', label: 'Motivation & Values', icon: '⭐' },
      { key: 'legacy_giving', label: 'Legacy & Future', icon: '🎁' },
      { key: 'civic_mindset', label: 'Civic Views', icon: '🌍' },
      { key: 'donor_capacity', label: 'Donor Profile', icon: '💰' },
      { key: 'satisfaction', label: 'Satisfaction', icon: '😊' },
      { key: 'loyalty', label: 'Loyalty & Frequency', icon: '❤️' },
      { key: 'engagement', label: 'Engagement', icon: '🤝' },
    ]

    const recommended = blueprint?.recommendedFocusAreas || []
    const modified = focusAreas.some(f => !recommended.includes(f)) || focusAreas.length !== recommended.length

    return (
      <Overlay>
        <div style={{ width: '100%', maxWidth: 720 }}>
          <Header step={step} totalSteps={5} progress={progress} title="What topics matter?" subtitle="Select the areas to explore. (Choose 1–4)" />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 20 }}>
            {allFocusAreas.map(area => {
              const isSelected = focusAreas.includes(area.key)
              const isRecommended = recommended.includes(area.key)
              return (
                <button
                  key={area.key}
                  onClick={() => handleFocusAreaToggle(area.key)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 6,
                    padding: '12px 10px',
                    fontSize: 12,
                    fontWeight: 600,
                    color: isSelected ? HERMES : '#6b7280',
                    background: isSelected ? HERMES_BG : '#f9fafb',
                    border: `2px solid ${isSelected ? HERMES : '#e5e7eb'}`,
                    borderRadius: 10,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    textAlign: 'center',
                    transition: 'all .15s',
                    minHeight: 80,
                    justifyContent: 'center',
                  }}
                  onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6' }}
                  onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLButtonElement).style.background = '#f9fafb' }}>
                  <span style={{ fontSize: 20 }}>{area.icon}</span>
                  <span style={{ lineHeight: 1.3 }}>{area.label}</span>
                  {isRecommended && <span style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>✓ Rec</span>}
                </button>
              )
            })}
          </div>

          {modified && (
            <div style={{ marginBottom: 24 }}>
              <button
                onClick={handleResetFocusAreas}
                style={{
                  fontSize: 12,
                  color: '#9ca3af',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  fontFamily: 'inherit',
                  transition: 'color .15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#6b7280' }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af' }}>
                Reset to recommended
              </button>
            </div>
          )}

          <Footer step={step} totalSteps={5} onBack={() => setStep(2)} onNext={() => setStep(4)} onSkip={onSkip} canNext={canGoNext()} />
        </div>
      </Overlay>
    )
  }

  // ────────────────────────────────────────────────────────────────
  // Step 4: Survey Length + Generate
  // ────────────────────────────────────────────────────────────────
  if (step === 4) {
    return (
      <Overlay>
        <div style={{ width: '100%', maxWidth: 720 }}>
          <Header step={step} totalSteps={5} progress={progress} title="Survey length & details" subtitle="Choose how detailed your survey should be." />

          {/* Length cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { len: 'quick' as const, icon: '⚡', label: 'Quick', desc: '~5 min' },
              { len: 'standard' as const, icon: '📋', label: 'Standard', desc: '~10 min' },
              { len: 'comprehensive' as const, icon: '📊', label: 'Comprehensive', desc: '~15 min' },
            ].map(opt => (
              <button
                key={opt.len}
                onClick={() => setLength(opt.len)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 8,
                  padding: 16,
                  fontSize: 13,
                  fontWeight: 700,
                  color: length === opt.len ? HERMES : '#6b7280',
                  background: length === opt.len ? HERMES_BG : '#f9fafb',
                  border: `2px solid ${length === opt.len ? HERMES : '#e5e7eb'}`,
                  borderRadius: 10,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  textAlign: 'center',
                  transition: 'all .15s',
                }}
                onMouseEnter={e => { if (length !== opt.len) (e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6' }}
                onMouseLeave={e => { if (length !== opt.len) (e.currentTarget as HTMLButtonElement).style.background = '#f9fafb' }}>
                <span style={{ fontSize: 24 }}>{opt.icon}</span>
                <span>{opt.label}</span>
                <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 500 }}>{opt.desc}</span>
              </button>
            ))}
          </div>

          {/* Open-ended toggle */}
          <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, marginBottom: 20 }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: '.06em' }}>Open-ended questions</p>
            <div style={{ display: 'flex', gap: 8 }}>
              {([0, 1, 2] as const).map(count => (
                <button
                  key={count}
                  onClick={() => setOpenEnded(count)}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    fontSize: 13,
                    fontWeight: 600,
                    color: openEnded === count ? HERMES : '#9ca3af',
                    background: openEnded === count ? HERMES_BG : '#ffffff',
                    border: `1px solid ${openEnded === count ? HERMES : '#d1d5db'}`,
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    transition: 'all .1s',
                  }}>
                  {count} question{count !== 1 ? 's' : ''}
                </button>
              ))}
            </div>
          </div>

          {/* Summary */}
          <SummaryCard length={length} openEnded={openEnded} focusAreasCount={focusAreas.length} studyType={blueprint?.label || ''} />

          {/* Final CTA */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              onClick={handleGenerate}
              disabled={generating || !canGoNext()}
              style={{
                flex: 1,
                padding: '13px 0',
                fontSize: 14,
                fontWeight: 700,
                color: 'white',
                background: HERMES,
                border: 'none',
                borderRadius: 10,
                cursor: 'pointer',
                fontFamily: 'inherit',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                opacity: generating || !canGoNext() ? 0.6 : 1,
                transition: 'all .15s',
              }}
              onMouseEnter={e => { if (!generating && canGoNext()) (e.currentTarget as HTMLButtonElement).style.background = '#d45619' }}
              onMouseLeave={e => { if (!generating && canGoNext()) (e.currentTarget as HTMLButtonElement).style.background = HERMES }}>
              {generating ? (
                <>
                  <span style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,.4)', borderTopColor: 'white', borderRadius: '50%', animation: '_bspin .7s linear infinite', display: 'inline-block' }} />
                  Building…
                </>
              ) : '✨ Generate My Survey →'}
            </button>
            <button
              onClick={onSkip}
              style={{
                padding: '13px 16px',
                fontSize: 13,
                fontWeight: 600,
                color: '#6b7280',
                background: '#f3f4f6',
                border: 'none',
                borderRadius: 10,
                cursor: 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
                transition: 'all .15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#e5e7eb' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6' }}>
              Start from scratch
            </button>
          </div>

          <style>{`@keyframes _bspin{to{transform:rotate(360deg)}}`}</style>
        </div>
      </Overlay>
    )
  }

  return null
}

// ────────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────────

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 200,
      background: 'rgba(0,0,0,0.45)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        background: 'white',
        borderRadius: 16,
        padding: '28px 28px 24px',
        boxShadow: '0 24px 64px rgba(0,0,0,.22)',
        width: '100%',
        maxWidth: 720,
        maxHeight: '90vh',
        overflowY: 'auto',
      }}>
        {children}
      </div>
    </div>
  )
}

function Header({
  step,
  totalSteps,
  progress,
  title,
  subtitle,
}: {
  step: number
  totalSteps: number
  progress: number
  title: string
  subtitle: string
}) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ height: 3, background: '#f3f4f6', borderRadius: 2, marginBottom: 16, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${progress * 100}%`,
          background: HERMES,
          transition: 'width .3s ease',
        }} />
      </div>
      <h2 style={{ fontSize: 20, fontWeight: 800, color: '#111827', margin: '0 0 6px' }}>{title}</h2>
      <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>{subtitle}</p>
    </div>
  )
}

function IndustryCard({
  industry,
  selected,
  onClick,
}: {
  industry: Industry
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        padding: 12,
        fontSize: 12,
        fontWeight: 600,
        color: selected ? HERMES : '#6b7280',
        background: selected ? HERMES_BG : '#f9fafb',
        border: `2px solid ${selected ? HERMES : '#e5e7eb'}`,
        borderRadius: 10,
        cursor: 'pointer',
        fontFamily: 'inherit',
        textAlign: 'center',
        transition: 'all .15s',
      }}
      onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6' }}
      onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLButtonElement).style.background = '#f9fafb' }}>
      <span style={{ fontSize: 24 }}>{INDUSTRY_EMOJIS[industry]}</span>
      <span style={{ lineHeight: 1.3 }}>{INDUSTRY_LABELS[industry]}</span>
    </button>
  )
}

function SummaryCard({
  length,
  openEnded,
  focusAreasCount,
  studyType,
}: {
  length: string
  openEnded: number
  focusAreasCount: number
  studyType: string
}) {
  const lengthMap = { quick: '~5 questions', standard: '~10 questions', comprehensive: '~15 questions' }
  const lengthLabel = lengthMap[length as keyof typeof lengthMap]

  return (
    <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, marginBottom: 12 }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '.06em' }}>Your survey will include:</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: '#374151' }}>
        <div>✓ {studyType}</div>
        <div>✓ {focusAreasCount} topic area{focusAreasCount !== 1 ? 's' : ''}</div>
        <div>✓ {lengthLabel}</div>
        <div>✓ {openEnded} open-ended question{openEnded !== 1 ? 's' : ''}</div>
      </div>
    </div>
  )
}

function Footer({
  step,
  totalSteps,
  onBack,
  onNext,
  onSkip,
  canNext,
  hideBack = false,
}: {
  step: number
  totalSteps: number
  onBack: () => void
  onNext: () => void
  onSkip: () => void
  canNext: boolean
  hideBack?: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      {step > 0 && !hideBack && (
        <button
          onClick={onBack}
          style={{
            padding: '11px 16px',
            fontSize: 13,
            fontWeight: 600,
            color: '#6b7280',
            background: '#f3f4f6',
            border: 'none',
            borderRadius: 10,
            cursor: 'pointer',
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
            transition: 'all .15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#e5e7eb' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6' }}>
          ← Back
        </button>
      )}
      <button
        onClick={onNext}
        disabled={!canNext}
        style={{
          flex: 1,
          padding: '11px 0',
          fontSize: 14,
          fontWeight: 700,
          color: 'white',
          background: canNext ? HERMES : '#f3a07a',
          border: 'none',
          borderRadius: 10,
          cursor: canNext ? 'pointer' : 'not-allowed',
          fontFamily: 'inherit',
          transition: 'all .15s',
        }}
        onMouseEnter={e => { if (canNext) (e.currentTarget as HTMLButtonElement).style.background = '#d45619' }}
        onMouseLeave={e => { if (canNext) (e.currentTarget as HTMLButtonElement).style.background = HERMES }}>
        Next →
      </button>
      {step === 0 && (
        <button
          onClick={onSkip}
          style={{
            padding: '11px 16px',
            fontSize: 13,
            fontWeight: 600,
            color: '#9ca3af',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            textDecoration: 'underline',
            fontFamily: 'inherit',
            transition: 'color .15s',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#6b7280' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af' }}>
          Skip
        </button>
      )}
    </div>
  )
}
