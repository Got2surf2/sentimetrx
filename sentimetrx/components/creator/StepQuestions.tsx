'use client'

import { useState, useRef } from 'react'
import type { StepProps } from '@/lib/studyDraft'
import type { SurveyQuestion, LikertFollowUp, QuestionType, KeywordTrigger } from '@/lib/types'
import { Section, NavButtons } from './CreatorUI'
import { INDUSTRY_SUGGESTED_QUESTIONS, INDUSTRY_LABELS, type Industry } from '@/lib/industryDefaults'

// -- Helpers --------------------------------------------------

const HERMES = '#E8632A'

const genId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

const TYPE_LABELS: Record<QuestionType, string> = {
  open:     'Open-ended',
  radio:    'Radio (pick one)',
  checkbox: 'Checkboxes (pick many)',
  dropdown: 'Dropdown',
  likert:   'Likert scale',
  date:     'Date picker',
  rating:   'Rating scale',
  numeric:  'Numeric input',
}

const TYPE_ICONS: Record<QuestionType, string> = {
  open:     '\u270F\uFE0F',
  radio:    '\uD83D\uDD18',
  checkbox: '\u2611\uFE0F',
  dropdown: '\u25BE',
  likert:   '\u2B50',
  date:     '\uD83D\uDCC5',
  rating:   '\uD83D\uDD22',
  numeric:  '\uD83D\uDCAC',
}

const inputCls = 'w-full px-3 py-2 rounded-lg text-sm text-gray-800 placeholder-gray-400 bg-white border border-gray-300 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-colors'
const labelCls = 'block text-xs font-semibold text-gray-500 mb-1'

// -- Toggle ---------------------------------------------------
function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={'relative inline-flex w-11 h-6 rounded-full transition-colors border-2 border-transparent flex-shrink-0 ' + (value ? 'bg-orange-500' : 'bg-gray-200')}
      >
        <span className={'inline-block w-5 h-5 bg-white rounded-full shadow-md transition-transform transform ' + (value ? 'translate-x-5' : 'translate-x-0')} />
      </button>
      <span className="text-sm text-gray-600">{label}</span>
    </label>
  )
}

// -- Adaptive follow-up panel ---------------------------------
function FollowUpPanel({
  followUp, onChange, scaleOptions, defaultPrompts
}: {
  followUp:        LikertFollowUp | undefined
  onChange:        (fu: LikertFollowUp) => void
  scaleOptions:    { score: number; label: string }[]
  defaultPrompts?: Record<number, string>
}) {
  const fu = followUp ?? {
    enabled: false, mode: 'shared' as const,
    sharedPrompt: '', shareClarify: false, shareAI: false,
    perResponse: {}
  }
  const set = (patch: Partial<LikertFollowUp>) => onChange({ ...fu, ...patch })
  const setPR = (score: number, patch: Partial<{ prompt: string; clarify: boolean; useAI: boolean }>) => {
    const prev = fu.perResponse?.[score] ?? { prompt: '', clarify: false, useAI: false }
    set({ perResponse: { ...fu.perResponse, [score]: { ...prev, ...patch } } })
  }
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden mt-2">
      <div className="flex items-center justify-between px-3 py-2.5 bg-gray-50 border-b border-gray-200">
        <span className="text-xs font-semibold text-gray-600">Adaptive follow-up after this question</span>
        <Toggle value={fu.enabled} onChange={v => set({ enabled: v })} label="" />
      </div>
      {fu.enabled && (
        <div className="px-3 py-3 flex flex-col gap-3">
          <div className="flex gap-2">
            {(['shared', 'per-response'] as const).map(m => (
              <button key={m} type="button" onClick={() => set({ mode: m })}
                className={'px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ' +
                  (fu.mode === m ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-500 border-gray-300 hover:border-orange-300')}>
                {m === 'shared' ? 'One prompt for all' : 'Unique per response'}
              </button>
            ))}
          </div>
          {fu.mode === 'shared' ? (
            <div className="flex flex-col gap-2">
              <textarea value={fu.sharedPrompt} onChange={e => set({ sharedPrompt: e.target.value })}
                placeholder={defaultPrompts?.[3] || 'Could you tell us a bit more about that?'}
                rows={2} className={inputCls + ' resize-none'} />
              <div className="flex gap-4">
                <Toggle value={fu.shareClarify} onChange={v => set({ shareClarify: v })} label="Keyword clarifier" />
                <Toggle value={fu.shareAI} onChange={v => set({ shareAI: v })} label="AI clarifier" />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {scaleOptions.map(opt => {
                const pr = fu.perResponse?.[opt.score] ?? { prompt: '', clarify: false, useAI: false }
                return (
                  <div key={opt.score} className="bg-gray-50 rounded-lg p-2.5 flex flex-col gap-1.5">
                    <div className="text-xs font-semibold text-gray-400">{opt.score + ' -- ' + opt.label}</div>
                    <textarea value={pr.prompt} onChange={e => setPR(opt.score, { prompt: e.target.value })}
                      placeholder={defaultPrompts?.[opt.score] || 'Follow-up for "' + opt.label + '"...'}
                      rows={2} className={inputCls + ' resize-none text-xs'} />
                    <div className="flex gap-4">
                      <Toggle value={pr.clarify} onChange={v => setPR(opt.score, { clarify: v })} label="Keyword clarifier" />
                      <Toggle value={pr.useAI} onChange={v => setPR(opt.score, { useAI: v })} label="AI clarifier" />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// -- Options editor (radio, checkbox, dropdown) ---------------
function OptionsEditor({ options, onChange }: { options: string[]; onChange: (opts: string[]) => void }) {
  const dragIdx = useRef<number | null>(null)

  const update = (i: number, v: string) => {
    const next = [...options]; next[i] = v; onChange(next)
  }
  const add    = () => onChange([...options, ''])
  const remove = (i: number) => onChange(options.filter((_, j) => j !== i))

  const onDragStart = (i: number) => { dragIdx.current = i }
  const onDragOver  = (e: React.DragEvent, i: number) => {
    e.preventDefault()
    if (dragIdx.current === null || dragIdx.current === i) return
    const next = [...options]
    const [moved] = next.splice(dragIdx.current, 1)
    next.splice(i, 0, moved)
    dragIdx.current = i
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-1.5">
      {options.map((opt, i) => (
        <div key={i} draggable onDragStart={() => onDragStart(i)} onDragOver={e => onDragOver(e, i)}
          className="flex items-center gap-2 group">
          <span className="text-gray-300 cursor-grab text-sm select-none">⠿</span>
          <input type="text" value={opt} onChange={e => update(i, e.target.value)}
            placeholder={'Option ' + (i + 1)} className={inputCls + ' flex-1'} />
          <button type="button" onClick={() => remove(i)}
            className="text-gray-300 hover:text-red-400 transition-colors text-base leading-none flex-shrink-0">
            x
          </button>
        </div>
      ))}
      <button type="button" onClick={add}
        className="mt-1 text-xs font-semibold text-orange-500 hover:text-orange-600 text-left transition-colors">
        + Add option
      </button>
    </div>
  )
}

// -- Likert scale editor --------------------------------------
const LIKERT_EMOJIS = ['\uD83D\uDE1E','\uD83D\uDE15','\uD83D\uDE10','\uD83D\uDE0A','\uD83D\uDE0D','\u2B50','\uD83D\uDC4E','\uD83D\uDC4D','\uD83D\uDD34','\uD83D\uDFE1','\uD83D\uDFE2','1\uFE0F\u20E3','2\uFE0F\u20E3','3\uFE0F\u20E3','4\uFE0F\u20E3','5\uFE0F\u20E3']

function LikertEditor({ scale, onChange }: {
  scale: { score: number; emoji?: string; label: string }[]
  onChange: (s: { score: number; emoji?: string; label: string }[]) => void
}) {
  const update = (i: number, patch: Partial<{ emoji: string; label: string }>) => {
    onChange(scale.map((r, j) => j === i ? { ...r, ...patch } : r))
  }
  const addPoint = () => {
    const nextScore = scale.length + 1
    onChange([...scale, { score: nextScore, emoji: '\u2B50', label: 'Score ' + nextScore }])
  }
  const remove = (i: number) => onChange(scale.filter((_, j) => j !== i).map((r, j) => ({ ...r, score: j + 1 })))

  return (
    <div className="flex flex-col gap-2">
      {scale.map((r, i) => (
        <div key={i} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
          <span className="text-gray-400 text-xs font-bold w-4 flex-shrink-0">{r.score}</span>
          <select value={r.emoji || '\u2B50'} onChange={e => update(i, { emoji: e.target.value })}
            className="bg-white border border-gray-300 rounded-lg px-1.5 py-1 text-base outline-none focus:border-orange-400 cursor-pointer flex-shrink-0">
            {LIKERT_EMOJIS.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          <input type="text" value={r.label} onChange={e => update(i, { label: e.target.value })}
            placeholder={'Score ' + r.score + ' label'}
            className="flex-1 bg-transparent text-sm text-gray-700 placeholder-gray-400 outline-none border-b border-gray-200 focus:border-orange-400 pb-0.5 transition-colors" />
          {scale.length > 2 && (
            <button type="button" onClick={() => remove(i)} className="text-gray-300 hover:text-red-400 transition-colors text-base leading-none">x</button>
          )}
        </div>
      ))}
      {scale.length < 7 && (
        <button type="button" onClick={addPoint}
          className="text-xs font-semibold text-orange-500 hover:text-orange-600 text-left transition-colors">
          + Add scale point
        </button>
      )}
      <p className="text-gray-400 text-xs">Score 1 = lowest, higher = better. Max 7 points.</p>
    </div>
  )
}

// -- Rating scale editor (min/max) ----------------------------
function RatingEditor({ min, max, onChange }: {
  min: number
  max: number
  onChange: (min: number, max: number) => void
}) {
  const PRESETS: [string, number, number][] = [
    ['1 - 5', 1, 5],
    ['1 - 7', 1, 7],
    ['0 - 10', 0, 10],
  ]
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 flex-wrap">
        {PRESETS.map(function(preset) {
          const [label, pMin, pMax] = preset
          const active = min === pMin && max === pMax
          return (
            <button key={label} type="button" onClick={() => onChange(pMin, pMax)}
              className={'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ' +
                (active ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-500 border-gray-300 hover:border-orange-300')}>
              {label}
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex flex-col gap-1 flex-1">
          <label className={labelCls}>Min</label>
          <input type="number" value={min} min={0} max={max - 1}
            onChange={e => onChange(Math.min(Number(e.target.value), max - 1), max)}
            className={inputCls} />
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <label className={labelCls}>Max</label>
          <input type="number" value={max} min={min + 1} max={100}
            onChange={e => onChange(min, Math.max(Number(e.target.value), min + 1))}
            className={inputCls} />
        </div>
      </div>
      <p className="text-gray-400 text-xs">
        {'Respondents will see buttons from ' + min + ' to ' + max + ' (' + (max - min + 1) + ' options).'}
      </p>
    </div>
  )
}

// -- Question card --------------------------------------------
function QuestionCard({
  q, idx, total, onChange, onDelete, onMoveUp, onMoveDown
}: {
  q: SurveyQuestion
  idx: number
  total: number
  onChange: (q: SurveyQuestion) => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const set = (patch: Partial<SurveyQuestion>) => onChange({ ...q, ...patch })

  const defaultLikertScale = q.likertScale ?? [
    { score: 1, emoji: '\uD83D\uDE1E', label: 'Strongly disagree' },
    { score: 2, emoji: '\uD83D\uDE15', label: 'Disagree' },
    { score: 3, emoji: '\uD83D\uDE10', label: 'Neutral' },
    { score: 4, emoji: '\uD83D\uDE0A', label: 'Agree' },
    { score: 5, emoji: '\uD83D\uDE0D', label: 'Strongly agree' },
  ]

  const likertScaleOptions = (q.likertScale ?? defaultLikertScale).map(r => ({ score: r.score, label: r.label }))

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      {/* Card header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-200">
        {/* Drag grip + reorder */}
        <div className="flex flex-col items-center gap-0 flex-shrink-0 cursor-grab select-none" title="Drag to reorder">
          <span className="text-gray-300 text-sm leading-none">⠿</span>
        </div>

        {/* Type badge */}
        <span className="text-xs font-bold text-gray-300 flex-shrink-0 w-5 text-center">Q{idx + 1}</span>
        <span className="text-sm flex-shrink-0">{TYPE_ICONS[q.type]}</span>
        <span className="text-xs font-semibold text-gray-400 flex-shrink-0">{TYPE_LABELS[q.type]}</span>

        {/* Prompt preview */}
        <span className="flex-1 text-sm text-gray-700 truncate min-w-0">
          {q.prompt || <span className="text-gray-400 italic">Untitled question</span>}
        </span>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button type="button" onClick={() => setExpanded(v => !v)}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors px-2 py-1 rounded-lg hover:bg-gray-100">
            {expanded ? 'Collapse' : 'Edit'}
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-red-500">Delete?</span>
              <button type="button" onClick={onDelete} className="text-xs font-semibold text-red-500 hover:text-red-700">Yes</button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="text-xs text-gray-400 hover:text-gray-600">No</button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)}
              className="text-gray-300 hover:text-red-400 transition-colors text-lg leading-none">
              x
            </button>
          )}
        </div>
      </div>

      {/* Card body */}
      {expanded && (
        <div className="px-4 py-4 flex flex-col gap-4">
          {/* Prompt */}
          <div>
            <label className={labelCls}>Question prompt</label>
            <textarea value={q.prompt} onChange={e => set({ prompt: e.target.value })}
              placeholder="Enter your question..." rows={2}
              className={inputCls + ' resize-none'} />
          </div>

          {/* Export label */}
          <div>
            <label className={labelCls}>CSV export label <span className="text-gray-400 font-normal">(optional)</span></label>
            <input type="text" value={q.exportLabel || ''} onChange={e => set({ exportLabel: e.target.value })}
              placeholder={q.prompt ? q.prompt.slice(0, 40) + '...' : 'Column header in CSV export'}
              className={inputCls} />
          </div>

          {/* Analytics display alias */}
          <div>
            <label className={labelCls}>Analytics label <span className="text-gray-400 font-normal">(short name shown in charts &amp; PPTX)</span></label>
            <input type="text" value={(q as any).analyticsLabel || ''} onChange={e => set({ analyticsLabel: e.target.value } as any)}
              placeholder={q.prompt ? q.prompt.slice(0, 50) : 'Short label for analytics reports'}
              className={inputCls} />
          </div>

          {/* Required toggle */}
          <Toggle value={!!q.required} onChange={v => set({ required: v })}
            label={q.required ? 'Required -- respondent must answer' : 'Optional -- respondent can skip'} />

          {/* Type-specific config */}
          {q.type === 'open' && (
            <div className="flex flex-col gap-3 pt-2 border-t border-gray-100">
              <Toggle value={!!q.clarify} onChange={v => set({ clarify: v })} label="Keyword clarifier" />
              <Toggle value={!!q.useAI} onChange={v => set({ useAI: v })} label="AI clarifier" />
              {q.keywordTriggers && q.keywordTriggers.length > 0 && q.clarify && (
                <KeywordTriggersPreview triggers={q.keywordTriggers} defaultFollowOn={q.defaultFollowOn} />
              )}
            </div>
          )}

          {(q.type === 'radio' || q.type === 'checkbox' || q.type === 'dropdown') && (
            <div className="pt-2 border-t border-gray-100">
              <label className={labelCls}>Answer options</label>
              <OptionsEditor
                options={q.options ?? ['', '']}
                onChange={opts => set({ options: opts })}
              />
            </div>
          )}

          {q.type === 'likert' && (
            <div className="flex flex-col gap-3 pt-2 border-t border-gray-100">
              <div>
                <label className={labelCls}>Scale points</label>
                <LikertEditor
                  scale={q.likertScale ?? defaultLikertScale}
                  onChange={s => set({ likertScale: s })}
                />
              </div>
              <FollowUpPanel
                followUp={q.followUp}
                onChange={fu => set({ followUp: fu })}
                scaleOptions={likertScaleOptions}
              />
            </div>
          )}

          {q.type === 'rating' && (
            <div className="pt-2 border-t border-gray-100">
              <label className={labelCls}>Scale range</label>
              <RatingEditor
                min={q.ratingMin ?? 1}
                max={q.ratingMax ?? 5}
                onChange={(min, max) => set({ ratingMin: min, ratingMax: max })}
              />
            </div>
          )}

          {q.type === 'numeric' && (
            <div className="pt-2 border-t border-gray-100">
              <p className="text-xs text-gray-400">
                Respondents type a number. Accepts any integer or decimal. Ana will treat responses as a numeric variable for statistical analysis.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// -- Industry suggested questions panel -----------------------
function SuggestedQuestionsPanel({
  industry,
  onAdd,
  existingIds,
}: {
  industry: string
  onAdd: (q: SurveyQuestion) => void
  existingIds: Set<string>
}) {
  const [open, setOpen] = useState(true)
  const suggestions = INDUSTRY_SUGGESTED_QUESTIONS[industry as Exclude<Industry, 'other'>] ?? []
  if (!suggestions.length) return null

  const industryLabel = INDUSTRY_LABELS[industry as Industry] ?? industry

  return (
    <div className="bg-orange-50 border border-orange-200 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-orange-500 text-sm font-bold">+</span>
          <span className="text-sm font-semibold text-gray-800">
            {'Suggested for ' + industryLabel}
          </span>
          <span className="text-xs text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full font-medium">
            {suggestions.length + ' questions'}
          </span>
        </div>
        <span className="text-gray-400 text-xs">{open ? 'hide' : 'show'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 flex flex-col gap-2">
          <p className="text-xs text-orange-700 mb-1">
            These contextual questions help segment responses by how respondents actually use or engage with you. Click any to add it to your survey.
          </p>
          {suggestions.map(function(sq) {
            const alreadyAdded = existingIds.has(sq.key)
            return (
              <div
                key={sq.key}
                className={'flex items-start gap-3 bg-white border rounded-xl px-4 py-3 transition-all ' + (alreadyAdded ? 'border-green-200 opacity-60' : 'border-orange-200 hover:border-orange-400 cursor-pointer')}
                onClick={() => {
                  if (alreadyAdded) return
                  onAdd({
                    id:          sq.key + '_' + Date.now().toString(36),
                    type:        'radio',
                    prompt:      sq.q,
                    options:     sq.opts,
                    required:    false,
                    exportLabel: sq.exportLabel,
                  } as SurveyQuestion)
                }}
              >
                <span className="text-base flex-shrink-0 mt-0.5">\uD83D\uDD18</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800">{sq.q}</div>
                  <div className="text-xs text-gray-400 mt-0.5 truncate">
                    {sq.opts.slice(0, 3).join(' · ')}{sq.opts.length > 3 ? ' ...' : ''}
                  </div>
                </div>
                <div className="flex-shrink-0 text-xs font-semibold mt-0.5">
                  {alreadyAdded
                    ? <span className="text-green-500">Added</span>
                    : <span className="text-orange-500">+ Add</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// -- Keyword triggers preview (for open-ended bank questions) --
function KeywordTriggersPreview({ triggers, defaultFollowOn }: { triggers: KeywordTrigger[]; defaultFollowOn?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
      <button type="button" onClick={() => setOpen(v => !v)} className="flex items-center gap-2 w-full text-left">
        <span className="text-xs font-semibold text-gray-500">{triggers.length} keyword clusters loaded</span>
        <span className="text-xs text-gray-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {triggers.map(function(kt, i) {
            return (
              <div key={i} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-gray-400">P{kt.priority}</span>
                  {kt.keywords.slice(0, 6).map(function(kw) {
                    return <span key={kw} className="text-xs bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded font-mono">{kw}</span>
                  })}
                  {kt.keywords.length > 6 && <span className="text-xs text-gray-400">+{kt.keywords.length - 6} more</span>}
                </div>
                <div className="text-xs text-gray-500 italic ml-5">{kt.follow_on}</div>
              </div>
            )
          })}
          {defaultFollowOn && (
            <div className="pt-1 border-t border-gray-200">
              <span className="text-xs font-semibold text-gray-400">Default: </span>
              <span className="text-xs text-gray-500 italic">{defaultFollowOn}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// -- Open-ended question bank panel ---------------------------
function OpenEndedBankPanel({
  industry,
  onAdd,
  existingPrompts,
}: {
  industry: string
  onAdd: (q: SurveyQuestion) => void
  existingPrompts: Set<string>
}) {
  const [open, setOpen] = useState(false)
  const [bankQuestions, setBankQuestions] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [loadedIndustry, setLoadedIndustry] = useState<string | null>(null)

  function loadBank() {
    var currentIndustry = industry && industry !== 'other' ? industry : ''
    if (loadedIndustry === currentIndustry) { setOpen(v => !v); return }
    setOpen(true)
    setLoading(true)
    fetch('/api/admin/questions?type=open_ended' + (currentIndustry ? '&industry=' + currentIndustry : ''))
      .then(function(r) { return r.json() })
      .then(function(d) { setBankQuestions(d.openEnded || []); setLoadedIndustry(currentIndustry); setLoading(false) })
      .catch(function() { setLoading(false) })
  }

  var industryLabel = INDUSTRY_LABELS[industry as Industry] ?? industry

  return (
    <div className="bg-purple-50 border border-purple-200 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={loadBank}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-purple-500 text-sm font-bold">💬</span>
          <span className="text-sm font-semibold text-gray-800">
            Open-ended question bank{industry && industry !== 'other' ? ' — ' + industryLabel : ''}
          </span>
          <span className="text-xs text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full font-medium">
            with clarifiers
          </span>
        </div>
        <span className="text-gray-400 text-xs">{open ? 'hide' : 'show'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 flex flex-col gap-2">
          <p className="text-xs text-purple-700 mb-1">
            Deep-dive questions with keyword-based follow-on rules. Each question comes with clarifier triggers you can toggle on or off.
          </p>
          {loading ? (
            <div className="py-4 text-center text-gray-400 text-sm">Loading question bank...</div>
          ) : bankQuestions.length === 0 ? (
            <div className="py-4 text-center text-gray-400 text-sm">No open-ended questions available for this industry.</div>
          ) : (
            bankQuestions.map(function(bq, i) {
              var alreadyAdded = existingPrompts.has(bq.prompt)
              return (
                <div
                  key={i}
                  className={'flex items-start gap-3 bg-white border rounded-xl px-4 py-3 transition-all ' + (alreadyAdded ? 'border-green-200 opacity-60' : 'border-purple-200 hover:border-purple-400 cursor-pointer')}
                  onClick={function() {
                    if (alreadyAdded) return
                    onAdd({
                      id:              genId(),
                      type:            'open',
                      prompt:          bq.prompt,
                      required:        false,
                      clarify:         true,
                      useAI:           false,
                      keywordTriggers: bq.keywordTriggers,
                      defaultFollowOn: bq.defaultFollowOn,
                      triggerType:     bq.triggerType,
                    } as SurveyQuestion)
                  }}
                >
                  <span className="text-base flex-shrink-0 mt-0.5">✏️</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800">{bq.prompt}</div>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-600 font-medium">{bq.triggerType}</span>
                      <span className="text-xs text-gray-400">{bq.keywordTriggers.length} keyword clusters</span>
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-xs font-semibold mt-0.5">
                    {alreadyAdded
                      ? <span className="text-green-500">Added</span>
                      : <span className="text-purple-500">+ Add</span>}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}

// -- Survey Flow Panel (compact reorder view) ----------------
function SurveyFlowPanel({ draft, onReorderQuestions, onReorderDemos }: { draft: StepProps['draft']; onReorderQuestions: (qs: SurveyQuestion[]) => void; onReorderDemos: (df: any[]) => void }) {
  const [open, setOpen] = useState(false)
  const c = draft.config
  const questions: SurveyQuestion[] = c.questions ?? []
  const psychoBank: any[] = c.psychographicBank ?? []
  const dragIdx = useRef<number | null>(null)
  const dragGroup = useRef<string | null>(null)

  // Drag within "custom" group
  const onDragStartQ = (i: number) => { dragIdx.current = i; dragGroup.current = 'custom' }
  const onDragOverQ = (e: React.DragEvent, i: number) => {
    e.preventDefault()
    if (dragGroup.current !== 'custom' || dragIdx.current === null || dragIdx.current === i) return
    const next = [...questions]
    const [moved] = next.splice(dragIdx.current, 1)
    next.splice(i, 0, moved)
    dragIdx.current = i
    onReorderQuestions(next)
  }

  // Drag within "demo" group
  const demoFields = c.demoFields || [
    { key: 'age', label: 'Age Range', type: 'select', enabled: true },
    { key: 'gender', label: 'Gender', type: 'select', enabled: true },
    { key: 'zip', label: 'ZIP Code', type: 'text', enabled: true },
  ]
  const enabledDemos = demoFields.filter((f: any) => f.enabled)

  const onDragStartD = (i: number) => { dragIdx.current = i; dragGroup.current = 'demo' }
  const onDragOverD = (e: React.DragEvent, i: number) => {
    e.preventDefault()
    if (dragGroup.current !== 'demo' || dragIdx.current === null || dragIdx.current === i) return
    // Reorder within the full demoFields array using enabled-index mapping
    const enabledKeys = enabledDemos.map((f: any) => f.key)
    const full = [...demoFields]
    // Find actual indices in the full array
    const fromKey = enabledKeys[dragIdx.current]
    const toKey = enabledKeys[i]
    const fromFull = full.findIndex((f: any) => f.key === fromKey)
    const toFull = full.findIndex((f: any) => f.key === toKey)
    if (fromFull < 0 || toFull < 0) return
    const [moved] = full.splice(fromFull, 1)
    full.splice(toFull, 0, moved)
    dragIdx.current = i
    onReorderDemos(full)
  }

  const onDragEnd = () => { dragIdx.current = null; dragGroup.current = null }

  // Compact row renderer
  const Row = ({ icon, label, sub, dim, draggable: isDraggable, onDS, onDO }: {
    icon: string; label: string; sub?: string; dim?: boolean
    draggable?: boolean; onDS?: () => void; onDO?: (e: React.DragEvent) => void
  }) => (
    <div
      draggable={isDraggable}
      onDragStart={onDS}
      onDragOver={onDO}
      onDragEnd={onDragEnd}
      className={'flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-xs transition-all ' + (dim ? 'opacity-40' : '') + (isDraggable ? ' cursor-grab hover:bg-orange-50' : '')}
      style={{ borderLeft: '2px solid ' + (dim ? '#e5e7eb' : '#e8622a'), minHeight: 28 }}
    >
      {isDraggable && <span className="text-gray-300 text-xs select-none flex-shrink-0">⠿</span>}
      <span className="flex-shrink-0">{icon}</span>
      <span className={'font-medium truncate flex-1 ' + (dim ? 'text-gray-400' : 'text-gray-700')}>{label}</span>
      {sub && <span className="text-gray-400 flex-shrink-0 text-xs">{sub}</span>}
    </div>
  )

  const npsOn = c.npsEnabled !== false
  const expOn = c.experienceEnabled !== false
  const q3On  = c.q3Enabled !== false
  const q4On  = c.q4Enabled !== false

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-gray-50 transition-colors">
        <div className="flex items-center gap-2">
          <span className="text-sm">🗂</span>
          <span className="text-sm font-semibold text-gray-800">Survey Flow</span>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
            {(npsOn ? 1 : 0) + (expOn ? 1 : 0) + (q3On ? 1 : 0) + (q4On ? 1 : 0) + questions.length + psychoBank.length} questions
          </span>
        </div>
        <span className="text-xs text-gray-400">{open ? 'hide' : 'show'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 flex flex-col gap-3">
          <p className="text-xs text-gray-400 px-1">Drag ⠿ to reorder within a group. Greyed-out items are disabled.</p>

          {/* Core */}
          <div>
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wider px-1 mb-1">Core Ratings</div>
            <Row icon="⭐" label={c.ratingPrompt || 'Experience Rating'} dim={!expOn} sub={expOn ? 'On' : 'Off'} />
            <Row icon="📊" label={c.npsPrompt || 'NPS Score'} dim={!npsOn} sub={npsOn ? 'On' : 'Off'} />
          </div>

          {/* Follow-ups */}
          <div>
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wider px-1 mb-1">Follow-ups</div>
            <Row icon="💬" label="Q1 — NPS follow-up" dim={!npsOn} sub={npsOn ? 'Auto' : 'Off'} />
            <Row icon="💬" label="Q2 — Rating follow-up" dim={!expOn} sub={expOn ? 'Auto' : 'Off'} />
          </div>

          {/* Conversation */}
          <div>
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wider px-1 mb-1">Conversation</div>
            <Row icon="🗣" label={'Q3 — ' + (c.q3 || 'Conversation question 3').slice(0, 50)} dim={!q3On} sub={q3On ? 'On' : 'Off'} />
            <Row icon="🗣" label={'Q4 — ' + (c.q4 || 'Conversation question 4').slice(0, 50)} dim={!q4On} sub={q4On ? 'On' : 'Off'} />
          </div>

          {/* Custom — draggable */}
          {questions.length > 0 && (
            <div>
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider px-1 mb-1">Custom Questions ({questions.length})</div>
              {questions.map((q, i) => (
                <Row
                  key={q.id}
                  icon={TYPE_ICONS[q.type] || '❓'}
                  label={'CQ' + (i + 1) + ' — ' + (q.prompt || 'Untitled').slice(0, 50)}
                  sub={TYPE_LABELS[q.type]}
                  draggable
                  onDS={() => onDragStartQ(i)}
                  onDO={(e) => onDragOverQ(e, i)}
                />
              ))}
            </div>
          )}

          {/* Psychographics */}
          {psychoBank.length > 0 && (
            <div>
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider px-1 mb-1">Psychographics ({psychoBank.length})</div>
              {psychoBank.slice(0, 8).map((q: any) => (
                <Row key={q.key} icon="🧠" label={(q.exportLabel || q.q || q.key).slice(0, 50)} sub="Bank" />
              ))}
              {psychoBank.length > 8 && (
                <div className="text-xs text-gray-400 px-3 py-1">+{psychoBank.length - 8} more</div>
              )}
            </div>
          )}

          {/* Demographics — draggable */}
          <div>
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wider px-1 mb-1">Demographics ({enabledDemos.length})</div>
            {enabledDemos.map((f: any, i: number) => (
              <Row key={f.key} icon="👤" label={f.label || f.key} sub={f.type === 'select' ? 'Dropdown' : 'Text'}
                draggable onDS={() => onDragStartD(i)} onDO={(e) => onDragOverD(e, i)} />
            ))}
            {enabledDemos.length === 0 && (
              <div className="text-xs text-gray-400 px-3 py-1">No demographics enabled</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// -- Main component -------------------------------------------
interface Props extends StepProps { onNext: () => void; onBack: () => void }

export default function StepQuestions({ draft, updateConfig, onNext, onBack }: Props) {
  const questions: SurveyQuestion[] = draft.config.questions ?? []
  const [addingType, setAddingType] = useState<QuestionType | null>(null)
  const industry = ((draft as any).industry || draft.config.industry || '') as string

  const customQCount = draft.config.customQCount ?? 0
  const totalQ       = questions.length

  const setQuestions = (qs: SurveyQuestion[]) => updateConfig({ questions: qs })
  const dragIdx = useRef<number | null>(null)

  const onDragStart = (i: number) => { dragIdx.current = i }
  const onDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault()
    if (dragIdx.current === null || dragIdx.current === i) return
    const next = [...questions]
    const [moved] = next.splice(dragIdx.current, 1)
    next.splice(i, 0, moved)
    dragIdx.current = i
    setQuestions(next)
  }
  const onDragEnd = () => { dragIdx.current = null }

  const addQuestion = (type: QuestionType) => {
    const q: SurveyQuestion = {
      id:       genId(),
      type,
      prompt:   '',
      required: false,
      ...(type === 'radio' || type === 'checkbox' || type === 'dropdown' ? { options: ['', ''] } : {}),
      ...(type === 'likert' ? {
        likertScale: [
          { score: 1, emoji: '\uD83D\uDE1E', label: 'Strongly disagree' },
          { score: 2, emoji: '\uD83D\uDE15', label: 'Disagree' },
          { score: 3, emoji: '\uD83D\uDE10', label: 'Neutral' },
          { score: 4, emoji: '\uD83D\uDE0A', label: 'Agree' },
          { score: 5, emoji: '\uD83D\uDE0D', label: 'Strongly agree' },
        ]
      } : {}),
      ...(type === 'rating' ? { ratingMin: 1, ratingMax: 5 } : {}),
    }
    setQuestions([...questions, q])
    setAddingType(null)
  }

  const addSuggestedQuestion = (q: SurveyQuestion) => setQuestions([...questions, q])

  const updateQ  = (i: number, q: SurveyQuestion) => setQuestions(questions.map((old, j) => j === i ? q : old))
  const deleteQ  = (i: number) => setQuestions(questions.filter((_, j) => j !== i))
  const moveUp   = (i: number) => { if (i === 0) return; const qs = [...questions]; [qs[i-1], qs[i]] = [qs[i], qs[i-1]]; setQuestions(qs) }
  const moveDown = (i: number) => { if (i === questions.length - 1) return; const qs = [...questions]; [qs[i], qs[i+1]] = [qs[i+1], qs[i]]; setQuestions(qs) }

  const existingIds = new Set(questions.map(q => q.id?.split('_')[0] ?? ''))

  return (
    <div className="flex flex-col gap-6">
      {/* Survey flow overview — compact reorder view */}
      <SurveyFlowPanel draft={draft} onReorderQuestions={setQuestions} onReorderDemos={function(df) { updateConfig({ demoFields: df }) }} />

      <div>
        <h2 className="text-xl font-bold text-gray-800 mb-1">Custom questions</h2>
        <p className="text-gray-500 text-sm">
          Add open-ended or close-ended questions to your survey. They appear after the core questions and before psychographics.
        </p>
      </div>

      {/* Industry suggestions */}
      {industry && industry !== 'other' && (
        <SuggestedQuestionsPanel
          industry={industry}
          onAdd={addSuggestedQuestion}
          existingIds={existingIds}
        />
      )}

      {/* Open-ended question bank with clarifiers */}
      <OpenEndedBankPanel
        industry={industry || ''}
        onAdd={addSuggestedQuestion}
        existingPrompts={new Set(questions.map(function(q) { return q.prompt }))}
      />

      {/* Questions list */}
      {questions.length > 0 && (
        <div className="flex flex-col gap-3">
          {questions.map((q, i) => (
            <div key={q.id} draggable onDragStart={() => onDragStart(i)} onDragOver={e => onDragOver(e, i)} onDragEnd={onDragEnd}>
            <QuestionCard
              q={q}
              idx={i}
              total={questions.length}
              onChange={updated => updateQ(i, updated)}
              onDelete={() => deleteQ(i)}
              onMoveUp={() => moveUp(i)}
              onMoveDown={() => moveDown(i)}
            />
            </div>
          ))}
        </div>
      )}

      {/* Sampling control */}
      {totalQ >= 2 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm flex items-center gap-5">
          <div className="flex-1">
            <div className="text-sm font-semibold text-gray-800 mb-0.5">Questions per respondent</div>
            <div className="text-xs text-gray-400">
              {customQCount === 0 || customQCount >= totalQ
                ? 'All ' + totalQ + ' questions shown to every respondent'
                : 'Randomly showing ' + customQCount + ' of your ' + totalQ + ' questions per respondent'}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => {
                const next = customQCount <= 1 ? 0 : customQCount - 1
                updateConfig({ customQCount: next })
              }}
              disabled={customQCount === 0}
              className="w-8 h-8 rounded-xl border border-gray-300 bg-white text-gray-700 font-bold hover:border-orange-400 hover:text-orange-500 disabled:opacity-30 transition-all flex items-center justify-center"
            >
              -
            </button>
            <span className="w-10 text-center text-lg font-bold text-gray-800">
              {customQCount === 0 || customQCount >= totalQ ? 'All' : customQCount}
            </span>
            <button
              type="button"
              onClick={() => {
                const next = customQCount === 0 ? 2 : Math.min(totalQ - 1, customQCount + 1)
                updateConfig({ customQCount: next })
              }}
              disabled={customQCount !== 0 && customQCount >= totalQ - 1}
              className="w-8 h-8 rounded-xl border border-gray-300 bg-white text-gray-700 font-bold hover:border-orange-400 hover:text-orange-500 disabled:opacity-30 transition-all flex items-center justify-center"
            >
              +
            </button>
          </div>
        </div>
      )}

      {/* Add question */}
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        {!addingType ? (
          <div className="flex flex-col items-center gap-3 py-2">
            {questions.length === 0 && (
              <p className="text-gray-400 text-sm text-center mb-1">No custom questions yet. Add one below.</p>
            )}
            <button
              type="button"
              onClick={() => setAddingType('open')}
              className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
              style={{ background: HERMES }}
            >
              + Add question
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="text-sm font-semibold text-gray-700">Choose question type:</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(Object.keys(TYPE_LABELS) as QuestionType[]).map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => addQuestion(type)}
                  className={'flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ' +
                    (addingType === type
                      ? 'border-orange-500 bg-orange-50 text-orange-700'
                      : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-orange-300 hover:bg-orange-50')}
                >
                  <span>{TYPE_ICONS[type]}</span>
                  <span>{TYPE_LABELS[type]}</span>
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setAddingType(null)}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors self-start">
              Cancel
            </button>
          </div>
        )}
      </div>

      <NavButtons onBack={onBack} onNext={onNext} nextLabel="Next: Psychographics" />
    </div>
  )
}
