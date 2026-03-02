'use client'

import type { StepProps } from '@/lib/studyDraft'
import { NavButtons } from './CreatorUI'
import StudyPreview from './StudyPreview'

interface Props extends StepProps {
  onBack:       () => void
  onSaveDraft:  () => void
  onPublish:    () => void
  saving:       boolean
}

export default function StepReview({ draft, update, updateConfig, onBack, onSaveDraft, onPublish, saving }: Props) {
  const c = draft.config
  const clarifierCount = Object.keys(c.clarifiers).filter(k => k !== 'default').length

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Review & Publish</h2>
        <p className="text-slate-400 text-sm">
          Check your study settings and preview how it will look to respondents.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* Summary */}
        <div className="flex flex-col gap-5">
          <SummarySection title="Basics">
            <Row label="Study name"   value={draft.name} />
            <Row label="Bot name"     value={`${draft.bot_emoji} ${draft.bot_name}`} />
          </SummarySection>

          <SummarySection title="Opening">
            <Row label="Greeting"      value={c.greeting}     truncate />
            <Row label="Rating prompt" value={c.ratingPrompt} truncate />
            <Row label="Rating scale"  value={c.ratingScale.map(r => `${r.emoji} ${r.label}`).join(' · ')} truncate />
          </SummarySection>

          <SummarySection title="Conversation">
            <Row label="Promoter Q1"   value={c.promoterQ1}  truncate />
            <Row label="Passive Q1"    value={c.passiveQ1}   truncate />
            <Row label="Detractor Q1"  value={c.detractorQ1} truncate />
            <Row label="Q3"            value={c.q3}          truncate />
            <Row label="Q4"            value={c.q4}          truncate />
            <Row label="Clarifiers"    value={`${clarifierCount} keyword${clarifierCount !== 1 ? 's' : ''} + default`} />
          </SummarySection>

          <SummarySection title="Psychographics">
            <Row
              label="Questions"
              value={c.psychographicBank.length > 0
                ? `${c.psychographicBank.length} questions (3 shown per respondent)`
                : 'None added'}
            />
          </SummarySection>

          {/* Action buttons */}
          <div className="flex flex-col gap-2 pt-2">
            <button
              onClick={onPublish}
              disabled={saving}
              className="w-full py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-bold text-sm transition-all"
            >
              {saving ? 'Publishing...' : 'Publish Study'}
            </button>
            <button
              onClick={onSaveDraft}
              disabled={saving}
              className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white font-medium text-sm transition-all"
            >
              Save as Draft
            </button>
            <p className="text-slate-500 text-xs text-center px-4">
              Publishing makes the survey live immediately. Drafts are only visible to you.
            </p>
          </div>
        </div>

        {/* Live preview */}
        <div className="flex flex-col gap-3">
          <h3 className="text-white font-semibold text-base">Live preview</h3>
          <p className="text-slate-500 text-xs">This is how your survey widget will appear to respondents.</p>
          <div className="flex justify-center">
            <StudyPreview draft={draft} />
          </div>
        </div>

      </div>

      <NavButtons onBack={onBack} />
    </div>
  )
}

function SummarySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col gap-2">
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">{title}</div>
      {children}
    </div>
  )
}

function Row({ label, value, truncate }: { label: string; value: string; truncate?: boolean }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="text-slate-500 flex-shrink-0 w-28">{label}</span>
      <span className={`text-slate-200 flex-1 min-w-0 ${truncate ? 'truncate' : ''}`}>{value || '—'}</span>
    </div>
  )
}
