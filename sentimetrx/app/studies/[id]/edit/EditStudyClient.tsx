'use client'

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
import TopNav from '@/components/nav/TopNav'
import CreatorNav from '@/components/creator/CreatorNav'
import SubHeader from '@/components/nav/SubHeader'


interface Props { study: any; logoUrl?: string; orgName?: string; isAdmin?: boolean; userEmail?: string; fullName?: string }

export default function EditStudyClient({ study, logoUrl='', orgName='', isAdmin=false, userEmail='', fullName='' }: Props) {
  const [step,   setStep]   = useState(0)

  function goTo(i: number) {
    setStep(i)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const [draft,  setDraft]  = useState<StudyDraft>({
    name:         study.name,
    bot_name:     study.bot_name,
    bot_emoji:    study.bot_emoji,
    config:       study.config,  // industry & otherIndustry live inside config JSONB
  })
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
      const res = await fetch(`/api/studies/${study.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, status }),
      })
      if (!res.ok) {
        const j = await res.json()
        throw new Error(j.error || 'Failed to save')
      }
      router.push(status === 'active' ? `/studies/${study.id}/deploy` : '/dashboard')
    } catch (e: any) {
      setError(e.message)
      setSaving(false)
    }
  }

  const stepProps = { draft, update, updateConfig }

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav logoUrl={logoUrl} orgName={orgName} isAdmin={isAdmin} userEmail={userEmail} fullName={fullName} currentPage='edit' />
      <SubHeader crumbs={[{label: 'Dashboard', href: '/dashboard'}, {label: draft.name || 'Edit Study'}]} />

      {/* Pill nav bar — fixed directly below SubHeader (TopNav 56px + SubHeader ~40px = 96px) */}
      <div className="bg-white border-b border-gray-200 shadow-sm px-5 py-2"
        style={{ position: 'fixed', top: '96px', left: 0, right: 0, zIndex: 39 }}>
        <div className="max-w-4xl mx-auto">
          <CreatorNav
            draft={draft}
            currentStep={step}
            highestVisited={6}
            onStepClick={goTo}
            onPublish={() => handleSave('active')}
            saving={saving}
            freeNav={true}
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
        {step === 0 && <StepBasics       {...stepProps} onNext={() => goTo(1)} />}
        {step === 1 && <StepOpening      {...stepProps} onNext={() => goTo(2)} onBack={() => goTo(0)} />}
        {step === 2 && <StepConversation {...stepProps} onNext={() => goTo(3)} onBack={() => goTo(1)} />}
        {step === 3 && <StepClarifiers {...stepProps} onNext={() => goTo(4)} onBack={() => goTo(2)} />}
        {step === 4 && <StepQuestions {...stepProps} onNext={() => goTo(5)} onBack={() => goTo(3)} />}
        {step === 5 && <StepPsychographics {...stepProps} onNext={() => goTo(6)} onBack={() => goTo(4)} />}
        {step === 6 && (
          <StepReview
            {...stepProps}
            onBack={() => goTo(5)}
            onSaveDraft={() => handleSave('draft')}
            onPublish={() => handleSave('active')}
            saving={saving}
            studyId={study.guid}
          />
        )}
      </div>
    </div>
  )
}
