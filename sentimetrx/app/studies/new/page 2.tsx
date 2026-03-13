'use client'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import StepBasics from '@/components/creator/StepBasics'
import StepOpening from '@/components/creator/StepOpening'
import StepConversation from '@/components/creator/StepConversation'
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

const STEPS = ['Basics', 'Opening', 'Conversation', 'Questions', 'Psychographics', 'Review & Publish']

export default function NewStudyPage() {
  const [step,    setStep]    = useState(0)
  const [draft,   setDraft]   = useState<StudyDraft>(EMPTY_DRAFT)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const router = useRouter()

  const update = useCallback((partial: Partial<StudyDraft>) => {
    setDraft(prev => ({ ...prev, ...partial }))
  }, [])

  const updateConfig = useCallback((partial: Partial<StudyDraft['config']>) => {
    setDraft(prev => ({ ...prev, config: { ...prev.config, ...partial } }))
  }, [])

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

  const stepProps = { draft, update, updateConfig }

  return (
    <div className="min-h-screen bg-gray-50">

      <TopNav currentPage='new' />
      <SubHeader crumbs={[{label: 'Dashboard', href: '/dashboard'}, {label: 'New Study'}]} />

      {/* Step progress */}
      <div className="border-b border-gray-200 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <button
                onClick={() => i < step && setStep(i)}
                className={`flex items-center gap-2 text-sm font-medium transition-colors ${
                  i === step ? 'text-cyan-400' :
                  i < step   ? 'text-slate-400 hover:text-white cursor-pointer' :
                               'text-slate-600 cursor-default'
                }`}
              >
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                  i === step ? 'bg-cyan-500 text-slate-900' :
                  i < step   ? 'bg-slate-600 text-white' :
                               'bg-slate-800 text-slate-500'
                }`}>
                  {i < step ? '✓' : i + 1}
                </span>
                <span className="hidden sm:block whitespace-nowrap">{s}</span>
              </button>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-px ${i < step ? 'bg-slate-600' : 'bg-slate-800'}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="max-w-4xl mx-auto px-6 py-10">
        {error && (
          <div className="mb-6 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}

        {step === 0 && <StepBasics       {...stepProps} onNext={() => setStep(1)} />}
        {step === 1 && <StepOpening      {...stepProps} onNext={() => setStep(2)} onBack={() => setStep(0)} />}
        {step === 2 && <StepConversation {...stepProps} onNext={() => setStep(3)} onBack={() => setStep(1)} />}
        {step === 3 && <StepQuestions {...stepProps} onNext={() => setStep(4)} onBack={() => setStep(2)} />}
        {step === 4 && <StepPsychographics {...stepProps} onNext={() => setStep(5)} onBack={() => setStep(3)} />}
        {step === 5 && (
          <StepReview
            {...stepProps}
            onBack={() => setStep(4)}
            onSaveDraft={() => handleSave('draft')}
            onPublish={() => handleSave('active')}
            saving={saving}
          />
        )}
      </div>
    </div>
  )
}
