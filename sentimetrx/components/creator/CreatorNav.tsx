'use client'

import type { StudyDraft } from '@/lib/studyDraft'

// ── Step completion logic ─────────────────────────────────────────────────────
export function getStepCompletion(draft: StudyDraft): boolean[] {
  const c = draft.config
  return [
    !!(draft.name?.trim() && draft.bot_name?.trim()),   // 0 Basics
    !!(c.greeting?.trim()),                              // 1 Opening
    !!(c.q3?.trim() && c.q4?.trim() && c.clarifiers?.default?.trim()), // 2 Conversation
    true,                                                // 3 Custom Questions (optional)
    true,                                                // 4 Psychographics (optional)
  ]
}

export function isPublishReady(draft: StudyDraft): boolean {
  return getStepCompletion(draft).every(Boolean)
}

export const CREATOR_STEP_LABELS = [
  'Basics',
  'Opening',
  'Conversation',
  'Questions',
  'Psychographics',
  'Review',
] as const

interface CreatorNavProps {
  draft:          StudyDraft
  currentStep:    number
  highestVisited: number
  onStepClick:    (step: number) => void
  onPublish:      () => void
  saving:         boolean
  freeNav?:       boolean
}

export default function CreatorNav({
  draft,
  currentStep,
  highestVisited,
  onStepClick,
  onPublish,
  saving,
  freeNav = false,
}: CreatorNavProps) {
  const completion = getStepCompletion(draft)
  const allDone    = completion.every(Boolean)
  const canPublish = allDone && !saving

  return (
    <div className="flex items-center gap-1 min-w-0 overflow-x-auto">

      {/* Step pills */}
      {CREATOR_STEP_LABELS.map((label, i) => {
        const isActive    = i === currentStep
        const isReview    = i === CREATOR_STEP_LABELS.length - 1
        const isDone      = isReview ? allDone : completion[i]
        const isClickable = freeNav ? true : i <= highestVisited

        let pillCls: string
        if (isActive) {
          pillCls = 'bg-orange-500 text-white shadow-sm'
        } else if (isDone && isClickable) {
          pillCls = 'bg-orange-50 text-orange-600 border border-orange-200 hover:bg-orange-100 cursor-pointer'
        } else if (isClickable) {
          pillCls = 'bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200 cursor-pointer'
        } else {
          pillCls = 'bg-gray-50 text-gray-300 border border-gray-100 cursor-default opacity-60'
        }

        let dotCls: string
        if (isActive) {
          dotCls = 'bg-white/30 text-white'
        } else if (isDone) {
          dotCls = 'bg-green-500 text-white'
        } else {
          dotCls = 'bg-red-400 text-white'
        }

        return (
          <button
            key={label}
            type="button"
            disabled={!isClickable}
            onClick={() => { if (isClickable) onStepClick(i) }}
            className={
              'flex items-center gap-1 px-2 py-1 rounded-full ' +
              'text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0 ' +
              pillCls
            }
          >
            <span className={
              'w-3.5 h-3.5 rounded-full flex items-center justify-center ' +
              'text-xs font-bold flex-shrink-0 leading-none ' + dotCls
            }>
              {isActive ? String(i + 1) : isDone ? '✓' : '✗'}
            </span>
            <span className="hidden md:inline">{label}</span>
          </button>
        )
      })}

      {/* Divider */}
      <div className="w-px h-4 bg-gray-200 mx-1 flex-shrink-0" />

      {/* Publish button */}
      <button
        type="button"
        disabled={!canPublish}
        onClick={() => { if (canPublish) onPublish() }}
        title={canPublish ? 'Publish this study' : 'Complete all required steps to publish'}
        className={
          'flex-shrink-0 flex items-center gap-1 px-3 py-1 ' +
          'rounded-full text-xs font-bold transition-all ' +
          (canPublish
            ? 'bg-cyan-500 text-slate-900 hover:bg-cyan-400 shadow-sm cursor-pointer'
            : 'bg-gray-100 text-gray-300 cursor-not-allowed')
        }
      >
        {saving ? (
          <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : (
          <span>▶</span>
        )}
        <span>{saving ? 'Publishing…' : 'Publish'}</span>
      </button>

    </div>
  )
}
