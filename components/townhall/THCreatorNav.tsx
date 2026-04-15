'use client'

import type { TownHallConfig, TownHallGuideTopic } from '@/lib/types'

// ── Step definitions ─────────────────────────────────────────────────────────

export const TH_STEP_LABELS = [
  'Basics',
  'Topics',
  'Sensitive Topics',
  'Conversation',
  'Post-Session',
  'Review',
] as const

const TH_STEP_ICONS = [
  '\u2699',     // Basics — gear
  '\uD83D\uDCAC', // Topics — speech bubble
  '\uD83D\uDEE1', // Sensitive Topics — shield
  '\u2699\uFE0F', // Conversation — gear
  '\uD83D\uDCCB', // Post-Session — clipboard
  '\u2714',     // Review — checkmark
] as const

const TH_STEP_TOOLTIPS = [
  'Basics — name, bot, org, messages',
  'Topics — discussion guide',
  'Sensitive Topics — off-limits topics, priority areas',
  'Conversation — engine settings, session end',
  'Post-Session — languages, demographics, psychographics',
  'Review & Create',
] as const

// ── Completion logic ─────────────────────────────────────────────────────────

export function getTHStepCompletion(
  name: string,
  config: TownHallConfig,
  guide: TownHallGuideTopic[],
): boolean[] {
  return [
    !!(name?.trim() && config.opening_message?.trim()),                            // 0 Basics
    guide.length > 0 && guide.every(t => t.label.trim() && t.opening_question.trim()), // 1 Topics
    true,                                                                           // 2 Sensitive Topics (optional)
    true,                                                                           // 3 Conversation (defaults ok)
    true,                                                                           // 4 Post-Session (optional)
  ]
}

// ── Component ────────────────────────────────────────────────────────────────

interface THCreatorNavProps {
  name: string
  config: TownHallConfig
  guide: TownHallGuideTopic[]
  currentStep: number
  highestVisited: number
  onStepClick: (step: number) => void
  onSave: () => void
  saving: boolean
  freeNav?: boolean
  saveLabel?: string
  savingLabel?: string
}

export default function THCreatorNav({
  name,
  config,
  guide,
  currentStep,
  highestVisited,
  onStepClick,
  onSave,
  saving,
  freeNav = false,
  saveLabel = 'Create Session',
  savingLabel = 'Creating...',
}: THCreatorNavProps) {
  const completion = getTHStepCompletion(name, config, guide)
  const allDone = completion.every(Boolean)
  const isReviewStep = TH_STEP_LABELS.length - 1
  const hasVisitedReview = freeNav || highestVisited >= isReviewStep
  const canSave = allDone && !saving && hasVisitedReview

  return (
    <div className="flex items-center gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none', paddingRight: 16 }}>

      {/* Step pills */}
      {TH_STEP_LABELS.map((label, i) => {
        const isActive    = i === currentStep
        const isReview    = i === isReviewStep
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

        const hasBeenVisited = freeNav || i <= highestVisited
        let dotCls: string
        if (isActive) {
          dotCls = 'bg-white/30 text-white'
        } else if (!hasBeenVisited) {
          dotCls = 'bg-gray-200 text-gray-400'
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
            title={TH_STEP_TOOLTIPS[i]}
            className={
              'flex items-center gap-1 rounded-full ' +
              'text-xs font-semibold whitespace-nowrap transition-all ' +
              (isActive ? 'px-3 py-1 ' : 'px-1.5 py-1 ') +
              pillCls
            }
          >
            <span className="text-sm flex-shrink-0 leading-none">{TH_STEP_ICONS[i]}</span>
            {isActive && <span>{label}</span>}
            {!isActive && hasBeenVisited && (
              <span className={'w-3 h-3 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0 leading-none ' + dotCls}>
                {isDone ? '✓' : '✗'}
              </span>
            )}
          </button>
        )
      })}

      {/* Divider */}
      <div className="w-px h-4 bg-gray-200 mx-1 flex-shrink-0" />

      {/* Save/Create button */}
      <button
        type="button"
        disabled={!canSave}
        onClick={() => { if (canSave) onSave() }}
        title={canSave ? saveLabel : !hasVisitedReview ? 'Complete Review step first' : 'Complete all required steps'}
        className={
          'flex-shrink-0 flex items-center gap-1 px-3 py-1 ' +
          'rounded-full text-xs font-bold transition-all ' +
          (canSave
            ? 'bg-orange-500 text-white hover:bg-orange-400 shadow-sm cursor-pointer'
            : 'bg-gray-200 text-gray-400 cursor-not-allowed')
        }
      >
        {saving ? (
          <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : (
          <span>▶</span>
        )}
        <span>{saving ? savingLabel : saveLabel}</span>
      </button>

    </div>
  )
}
