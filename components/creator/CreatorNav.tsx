'use client'

import { useRef } from 'react'
import type { StudyDraft } from '@/lib/studyDraft'

// ── Step completion logic ─────────────────────────────────────────────────────
export function getStepCompletion(draft: StudyDraft): boolean[] {
  const c = draft.config
  return [
    !!(draft.name?.trim() && draft.bot_name?.trim()),    // 0 Basics
    !!(c.greeting?.trim()),                              // 1 Opening
    (c.q3Enabled === false || !!(c.q3?.trim())) && (c.q4Enabled === false || !!(c.q4?.trim())),  // 2 Conversation
    true,                                                // 3 Clarifiers (default fallback auto-provided)
    true,                                                // 4 Custom Questions (optional — always complete once visited)
    true,                                                // 5 Psychographics (optional — always complete once visited)
    true,                                                // 6 Demographics (optional — always complete once visited)
    true,                                                // 7 Contact Info (optional — always complete once visited)
    true,                                                // 8 Closing (optional — defaults provided)
  ]
}

export function isPublishReady(draft: StudyDraft): boolean {
  return getStepCompletion(draft).every(Boolean)
}

export const CREATOR_STEP_LABELS = [
  'Basics',
  'Opening',
  'Conversation',
  'Clarifiers',
  'Questions',
  'Psycho',
  'Demo',
  'Contact',
  'Closing',
  'Review',
] as const

const CREATOR_STEP_ICONS = [
  '\u2699',     // Basics — gear
  '\uD83D\uDC4B', // Opening — wave
  '\uD83D\uDCAC', // Conversation — speech bubble
  '\uD83E\uDD14', // Clarifiers — thinking
  '\u2753',     // Questions — question mark
  '\uD83E\uDDE0', // Psycho — brain
  '\uD83D\uDC64', // Demo — person
  '\uD83D\uDCE7', // Contact — envelope
  '\uD83D\uDC4B', // Closing — waving goodbye
  '\u2714',     // Review — checkmark
] as const

const CREATOR_STEP_TOOLTIPS = [
  'Study Basics — name, bot, theme',
  'Opening — greeting & NPS',
  'Conversation — open-ended questions',
  'Clarifiers — follow-up settings',
  'Custom Questions — additional questions',
  'Psychographics — attitudes & values',
  'Demographics — age, gender, etc.',
  'Contact Info — email, phone, address',
  'Closing — thank-you message & card',
  'Review & Publish',
] as const

interface CreatorNavProps {
  draft:          StudyDraft
  currentStep:    number
  highestVisited: number
  onStepClick:    (step: number) => void
  onPublish:      () => void
  onImport?:      (draft: StudyDraft) => void
  saving:         boolean
  freeNav?:       boolean
  translating?:   boolean   // true while a language translation is in progress
}

export default function CreatorNav({
  draft,
  currentStep,
  highestVisited,
  onStepClick,
  onPublish,
  onImport,
  saving,
  freeNav = false,
  translating = false,
}: CreatorNavProps) {
  const completion = getStepCompletion(draft)
  const allDone    = completion.every(Boolean)
  // New studies: require visiting Review step (8) before pill publish works
  // Edit studies (freeNav=true): pill always available
  const hasVisitedReview = freeNav || highestVisited >= 9
  const canPublish = allDone && !saving && !translating && hasVisitedReview
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleExport() {
    // Explicitly materialize boolean defaults so nothing is lost as undefined across instances
    const c = draft.config
    const fullConfig = {
      ...c,
      npsEnabled:            c.npsEnabled ?? true,
      experienceEnabled:     c.experienceEnabled ?? true,
      q3Enabled:             c.q3Enabled ?? true,
      q4Enabled:             c.q4Enabled ?? true,
      confirmBeforeRecord:   c.confirmBeforeRecord ?? false,
      allowMultipleResponses: c.allowMultipleResponses ?? true,
      showBranding:          c.showBranding ?? true,
      useAIClarify:          c.useAIClarify ?? false,
      surveyFontSize:        c.surveyFontSize ?? 18,
      typingSpeed:           c.typingSpeed ?? 0.5,
      autoTranslateResponses: c.autoTranslateResponses ?? false,
      psychoCount:           c.psychoCount ?? 3,
    }
    const exportData = { name: draft.name, bot_name: draft.bot_name, bot_emoji: draft.bot_emoji, slug: draft.slug, config: fullConfig }
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = (draft.name || 'study').replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !onImport) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string)
        if (!parsed.config || parsed.config.greeting === undefined) {
          alert('Invalid study JSON — missing config or greeting field.')
          return
        }
        onImport(parsed as StudyDraft)
      } catch {
        alert('Invalid JSON file.')
      }
    }
    reader.readAsText(file)
    e.target.value = '' // reset so same file can be re-imported
  }

  return (
    <div className="flex items-center gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none', paddingRight: 16 }}>

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
            title={CREATOR_STEP_TOOLTIPS[i]}
            className={
              'flex items-center gap-1 rounded-full ' +
              'text-xs font-semibold whitespace-nowrap transition-all ' +
              (isActive ? 'px-3 py-1 ' : 'px-1.5 py-1 ') +
              pillCls
            }
          >
            <span className="text-sm flex-shrink-0 leading-none">{CREATOR_STEP_ICONS[i]}</span>
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

      {/* Publish button — right after Review */}
      <button
        type="button"
        disabled={!canPublish}
        onClick={() => { if (canPublish) onPublish() }}
        title={canPublish ? 'Publish this study' : translating ? 'Translation in progress...' : !hasVisitedReview ? 'Complete Review step first' : 'Complete all required steps to publish'}
        className={
          'flex-shrink-0 flex items-center gap-1 px-3 py-1 ' +
          'rounded-full text-xs font-bold transition-all ' +
          (canPublish
            ? 'bg-orange-500 text-white hover:bg-orange-400 shadow-sm cursor-pointer'
            : 'bg-gray-200 text-gray-400 cursor-not-allowed')
        }
      >
        {saving ? (
          <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
        ) : (
          <span>▶</span>
        )}
        <span>{saving ? 'Publishing…' : 'Publish'}</span>
      </button>

      {/* Divider */}
      <div className="w-px h-4 bg-gray-200 mx-1 flex-shrink-0" />

      {/* Export Study JSON */}
      <button
        type="button"
        onClick={handleExport}
        title="Export study as JSON"
        className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200 hover:text-gray-700 transition-all cursor-pointer"
      >
        <span>Export Study</span>
      </button>

      {/* Import Study JSON */}
      {onImport && (
        <>
          <input ref={fileInputRef} type="file" accept=".json" onChange={handleImportFile} className="hidden" />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Import study from JSON"
            className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200 hover:text-gray-700 transition-all cursor-pointer"
          >
            <span>Import Study</span>
          </button>
        </>
      )}

      {/* Design Deck PPTX */}
      {draft.id && (
        <button
          type="button"
          onClick={() => {
            const a = document.createElement('a')
            a.href = `/api/studies/${draft.id}/design-export`
            a.download = (draft.name || 'study').replace(/[^a-z0-9]/gi, '_').toLowerCase() + '_design.pptx'
            a.click()
          }}
          title="Download study design summary as PowerPoint"
          className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-500 border border-gray-200 hover:bg-gray-200 hover:text-gray-700 transition-all cursor-pointer"
        >
          <span>PPTX Gen</span>
        </button>
      )}

    </div>
  )
}


