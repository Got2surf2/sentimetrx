'use client'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'
import CreatorNav from '@/components/creator/CreatorNav'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import StepBasics from '@/components/creator/StepBasics'
import StepOpening from '@/components/creator/StepOpening'
import StepConversation from '@/components/creator/StepConversation'
import StepClarifiers from '@/components/creator/StepClarifiers'
import StepQuestions from '@/components/creator/StepQuestions'
import StepPsychographics from '@/components/creator/StepPsychographics'
import StepReview from '@/components/creator/StepReview'
import type { StudyDraft } from '@/lib/studyDraft'

const EMPTY_DRAFT: StudyDraft = {
  name:      '',
  bot_name:  '',
  bot_emoji: '💬',
  config: {
    greeting:     '',
    ratingPrompt: '',
    ratingScale: [
      { emoji: '😞', label: 'Very poor',  score: 1 },
      { emoji: '😕', label: 'Poor',       score: 2 },
      { emoji: '😐', label: 'Okay',       score: 3 },
      { emoji: '😊', label: 'Good',       score: 4 },
      { emoji: '😍', label: 'Excellent',  score: 5 },
    ],
    promoterQ1:  '',
    passiveQ1:   '',
    detractorQ1: '',
    q3:          '',
    q4:          '',
    clarifiers:  { default: '' },
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
  },
}

export default function NewStudyPage() {
  const [step,           setStep]           = useState(0)
  const [highestVisited, setHighestVisited] = useState(0)
  const [draft,          setDraft]          = useState<StudyDraft>(EMPTY_DRAFT)
  const [saving,         setSaving]         = useState(false)
  const [error,          setError]          = useState<string | null>(null)
  const router = useRouter()

  const update = useCallback((partial: Partial<StudyDraft>) => {
    setDraft(prev => ({ ...prev, ...partial }))
  }, [])

  const updateConfig = useCallback((partial: Partial<StudyDraft['config']>) => {
    setDraft(prev => ({ ...prev, config: { ...prev.config, ...partial } }))
  }, [])

  // Advance to next step and widen the highestVisited window
  function goTo(i: number) {
    setStep(i)
    setHighestVisited(prev => Math.max(prev, i))
  }

  const handleSave = async (status: 'draft' | 'active') => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/studies', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, status }),
      })
      if (!res.ok) {
        const j = await res.json()
        throw new Error(j.error || 'Failed to save')
      }
      const { id } = await res.json()
      router.push(status === 'active' ? `/studies/${id}/deploy` : `/studies/${id}/edit`)
    } catch (e: any) {
      setError(e.message)
      setSaving(false)
    }
  }

  // Nav publish button: jump to Review step so user sees the summary first.
  // The actual API call happens when they click Publish inside StepReview.
  function handleNavPublish() {
    goTo(6)
  }

  const stepProps = { draft, update, updateConfig }

  return (
    <div className="min-h-screen bg-gray-50">

      <TopNav currentPage="new" />
      <SubHeader crumbs={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'New Study' }]} />

      {/* Pill nav bar — fixed directly below SubHeader (TopNav 56px + SubHeader ~40px = 96px) */}
      <div className="bg-white border-b border-gray-200 shadow-sm px-5 py-2"
        style={{ position: 'fixed', top: '96px', left: 0, right: 0, zIndex: 39 }}>
        <div className="max-w-4xl mx-auto">
          <CreatorNav
            draft={draft}
            currentStep={step}
            highestVisited={highestVisited}
            onStepClick={goTo}
            onPublish={handleNavPublish}
            saving={saving}
            freeNav={false}
          />
        </div>
      </div>

      {/* Step content — clears TopNav(56) + SubHeader(40) + PillBar(40) = 136px */}
      <div className="max-w-4xl mx-auto px-6 py-10" style={{ paddingTop: '9rem' }}>
        {error && (
          <div className="mb-6 px-4 py-3 rounded-xl bg-red-100 border border-red-200 text-red-600 text-sm">
            {error}
          </div>
        )}

        {step === 0 && (
          <StepBasics
            {...stepProps}
            onNext={() => goTo(1)}
          />
        )}
        {step === 1 && (
          <StepOpening
            {...stepProps}
            onNext={() => goTo(2)}
            onBack={() => goTo(0)}
          />
        )}
        {step === 2 && (
          <StepConversation
            {...stepProps}
            onNext={() => goTo(3)}
            onBack={() => goTo(1)}
          />
        )}
        {step === 3 && (
          <StepClarifiers
            {...stepProps}
            onNext={() => goTo(4)}
            onBack={() => goTo(2)}
          />
        )}
        {step === 4 && (
          <StepQuestions
            {...stepProps}
            onNext={() => goTo(5)}
            onBack={() => goTo(3)}
          />
        )}
        {step === 5 && (
          <StepPsychographics
            {...stepProps}
            onNext={() => goTo(6)}
            onBack={() => goTo(4)}
          />
        )}
        {step === 6 && (
          <StepReview
            {...stepProps}
            onBack={() => goTo(5)}
            onSaveDraft={() => handleSave('draft')}
            onPublish={() => handleSave('active')}
            saving={saving}
          />
        )}
      </div>
    </div>
  )
}
