'use client'

import type { StudyDraft } from '@/lib/studyDraft'

// ── Step completion logic ────────────────────────────────────────
// Each entry corresponds to the same index as STEP_LABELS below.
// "Review & Publish" (index 5) derives from the others, so we only
// compute 5 values and treat it separately.

export function getStepCompletion(draft: StudyDraft): boolean[] {
  const c = draft.config
  return [
    // 0 Basics
    !!(draft.name?.trim() && draft.bot_name?.trim()),
    // 1 Opening
    !!(c.greeting?.trim()),
    // 2 Conversation
    !!(c.q3?.trim() && c.q4?.trim() && c.clarifiers?.default?.trim()),
    // 3 Custom Questions (optional — always complete)
    true,
    // 4 Psychographics (optional — always complete)
    true,
  ]
}

export function isPublishReady(draft: StudyDraft): boolean {
  return getStepCompletion(draft).every(Boolean)
}

// ── Labels must match step indices in page components ─────────────
export const CREATOR_STEP_LABELS = [
  'Basics',
  'Opening',
  'Conversation',
  'Custom Questions',
  'Psychographics',
  'Review & Publish',
] as const

// ── Props ─────────────────────────────────────────────────────────
interface CreatorNavProps {
  draft:           StudyDraft
  currentStep:     number
  highestVisited:  number       // highest step index the user has reached
  onStepClick:     (step: number) => void
  onPublish:       () => void
  saving:          boolean
  freeNav?:        boolean      // true in edit mode — every pill is clickable
}

// ── Component ─────────────────────────────────────────────────────
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
    <div className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-2 sm:gap-3">

        {/* ── Step pills ── */}
        <div className="flex items-center gap-1 sm:gap-1.5 flex-1 min-w-0 overflow-x-auto no-scrollbar">
          {CREATOR_STEP_LABELS.map((label, i) => {
            const isActive    = i === currentStep
            const isReview    = i === CREATOR_STEP_LABELS.length - 1
            const isDone      = isReview ? allDone : completion[i]
            const isClickable = freeNav
              ? true
              : i <= highestVisited

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
              dotCls = 'bg-orange-500 text-white'
            } else {
              dotCls = 'bg-gray-200 text-gray-400'
            }

            return (
              <button
                key={label}
                type="button"
                disabled={!isClickable}
                onClick={() => { if (isClickable) onStepClick(i) }}
                className={
                  'flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 rounded-full ' +
                  'text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0 ' +
                  pillCls
                }
              >
                <span className={
                  'w-4 h-4 rounded-full flex items-center justify-center ' +
                  'text-xs font-bold flex-shrink-0 leading-none ' + dotCls
                }>
                  {isDone && !isActive ? '✓' : String(i + 1)}
                </span>
                {/* Hide label text on very small screens, show on sm+ */}
                <span className="hidden xs:inline sm:inline">{label}</span>
              </button>
            )
          })}
        </div>

        {/* ── Publish button ── */}
        <button
          type="button"
          disabled={!canPublish}
          onClick={() => { if (canPublish) onPublish() }}
          title={canPublish ? 'Publish this study' : 'Complete all required steps to publish'}
          className={
            'flex-shrink-0 flex items-center gap-1.5 px-3 sm:px-4 py-2 ' +
            'rounded-full text-xs sm:text-sm font-bold transition-all ' +
            (canPublish
              ? 'bg-cyan-500 text-slate-900 hover:bg-cyan-400 shadow-sm hover:shadow-md cursor-pointer'
              : 'bg-gray-100 text-gray-300 cursor-not-allowed')
          }
        >
          {saving ? (
            <>
              <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <span className="hidden sm:inline">Publishing…</span>
            </>
          ) : (
            <>
              <span>▶</span>
              <span className="hidden sm:inline">Publish</span>
            </>
          )}
        </button>

      </div>

      {/* Incomplete steps hint — only shown when user tries to publish */}
      {!allDone && (
        <div className="max-w-4xl mx-auto px-4 sm:px-6 pb-2">
          <div className="flex flex-wrap gap-1.5">
            {completion.map((done, i) =>
              !done ? (
                <span
                  key={i}
                  className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full"
                >
                  {CREATOR_STEP_LABELS[i]} incomplete
                </span>
              ) : null
            )}
          </div>
        </div>
      )}
    </div>
  )
}
