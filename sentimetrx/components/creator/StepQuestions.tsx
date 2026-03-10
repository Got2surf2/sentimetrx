'use client'

import { useState, useRef } from 'react'
import type { StepProps } from '@/lib/studyDraft'
import type { SurveyQuestion, LikertFollowUp, QuestionType } from '@/lib/types'
import { Section, NavButtons } from './CreatorUI'
import { INDUSTRY_SUGGESTED_QUESTIONS, INDUSTRY_LABELS, type Industry } from '@/lib/industryDefaults'

// ── Helpers ──────────────────────────────────────────────────

const HERMES = '#E8632A'

const genId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

const TYPE_LABELS: Record<QuestionType, string> = {
  open:     'Open-ended',
  radio:    'Radio (pick one)',
  checkbox: 'Checkboxes (pick many)',
  dropdown: 'Dropdown',
  likert:   'Likert scale',
  date:     'Date picker',
}

const TYPE_ICONS: Record<QuestionType, string> = {
  open:     '✏️',
  radio:    '🔘',
  checkbox: '☑️',
  dropdown: '▾',
  likert:   '⭐',
  date:     '📅',
}

const inputCls = 'w-full px-3 py-2 rounded-lg text-sm text-gray-800 placeholder-gray-400 bg-white border border-gray-300 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-colors'
const labelCls = 'block text-xs font-semibold text-gray-500 mb-1'

// ── Toggle ────────────────────────────────────────────────────
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

// ── Adaptive follow-up panel (reused from StepOpening) ────────
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
                    <div className="text-xs font-semibold text-gray-400">{opt.score} — {opt.label}</div>
                    <textarea value={pr.prompt} onChange={e => setPR(opt.score, { prompt: e.target.value })}
                      placeholder={defaultPrompts?.[opt.score] || `Follow-up for "${opt.label}"...`}
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

// ── Options editor (radio, checkbox, dropdown) ─────────────────
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
            placeholder={`Option ${i + 1}`} className={inputCls + ' flex-1'} />
          <button type="button" onClick={() => remove(i)}
            className="text-gray-300 hover:text-red-400 transition-colors text-base leading-none flex-shrink-0">
            ×
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

// ── Likert scale editor ────────────────────────────────────────
const LIKERT_EMOJIS = ['😞','😕','😐','😊','😍','⭐','👎','👍','🔴','🟡','🟢','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣']

function LikertEditor({ scale, onChange }: {
  scale: { score: number; emoji?: string; label: string }[]
  onChange: (s: { score: number; emoji?: string; label: string }[]) => void
}) {
  const update = (i: number, patch: Partial<{ emoji: string; label: string }>) => {
    onChange(scale.map((r, j) => j === i ? { ...r, ...patch } : r))
  }
  const addPoint = () => {
    const nextScore = scale.length + 1
    onChange([...scale, { score: nextScore, emoji: '⭐', label: `Score ${nextScore}` }])
  }
  const remove = (i: number) => onChange(scale.filter((_, j) => j !== i).map((r, j) => ({ ...r, score: j + 1 })))

  return (
    <div className="flex flex-col gap-2">
      {scale.map((r, i) => (
        <div key={i} className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
          <span className="text-gray-400 text-xs font-bold w-4 flex-shrink-0">{r.score}</span>
          <select value={r.emoji || '⭐'} onChange={e => update(i, { emoji: e.target.value })}
            className="bg-white border border-gray-300 rounded-lg px-1.5 py-1 text-base outline-none focus:border-orange-400 cursor-pointer flex-shrink-0">
            {LIKERT_EMOJIS.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
          <input type="text" value={r.label} onChange={e => update(i, { label: e.target.value })}
            placeholder={`Score ${r.score} label`}
            className="flex-1 bg-transparent text-sm text-gray-700 placeholder-gray-400 outline-none border-b border-gray-200 focus:border-orange-400 pb-0.5 transition-colors" />
          {scale.length > 2 && (
            <button type="button" onClick={() => remove(i)} className="text-gray-300 hover:text-red-400 transition-colors text-base leading-none">×</button>
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

// ── Question card ─────────────────────────────────────────────
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
    { score: 1, emoji: '😞', label: 'Strongly disagree' },
    { score: 2, emoji: '😕', label: 'Disagree' },
    { score: 3, emoji: '😐', label: 'Neutral' },
    { score: 4, emoji: '😊', label: 'Agree' },
    { score: 5, emoji: '😍', label: 'Strongly agree' },
  ]

  const likertScaleOptions = (q.likertScale ?? defaultLikertScale).map(r => ({ score: r.score, label: r.label }))

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
      {/* Card header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-200">
        {/* Reorder buttons */}
        <div className="flex flex-col gap-0.5 flex-shrink-0">
          <button type="button" onClick={onMoveUp} disabled={idx === 0}
            className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 disabled:opacity-20 disabled:cursor-default transition-colors text-xs">
            ▲
          </button>
          <button type="button" onClick={onMoveDown} disabled={idx === total - 1}
            className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 disabled:opacity-20 disabled:cursor-default transition-colors text-xs">
            ▼
          </button>
        </div>

        {/* Type badge */}
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
              ×
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

          {/* Required toggle */}
          <Toggle value={!!q.required} onChange={v => set({ required: v })}
            label={q.required ? 'Required — respondent must answer' : 'Optional — respondent can skip'} />

          {/* Type-specific config */}
          {q.type === 'open' && (
            <div className="flex flex-col gap-3 pt-2 border-t border-gray-100">
              <Toggle value={!!q.clarify} onChange={v => set({ clarify: v })} label="Keyword clarifier" />
              <Toggle value={!!q.useAI} onChange={v => set({ useAI: v })} label="AI clarifier" />
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
        </div>
      )}
    </div>
  )
}

// ── Industry suggested questions panel ───────────────────────
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
          <span className="text-orange-500 text-sm font-bold">✦</span>
          <span className="text-sm font-semibold text-gray-800">
            Suggested for {industryLabel}
          </span>
          <span className="text-xs text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full font-medium">
            {suggestions.length} questions
          </span>
        </div>
        <span className="text-gray-400 text-xs">{open ? '▲ hide' : '▼ show'}</span>
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
                    id:       sq.key + '_' + Date.now().toString(36),
                    type:     'radio',
                    prompt:   sq.q,
                    options:  sq.opts,
                    required: false,
                    exportLabel: sq.exportLabel,
                  } as SurveyQuestion)
                }}
              >
                <span className="text-base flex-shrink-0 mt-0.5">🔘</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800">{sq.q}</div>
                  <div className="text-xs text-gray-400 mt-0.5 truncate">
                    {sq.opts.slice(0, 3).join(' · ')}{sq.opts.length > 3 ? ' …' : ''}
                  </div>
                </div>
                <div className="flex-shrink-0 text-xs font-semibold mt-0.5">
                  {alreadyAdded
                    ? <span className="text-green-500">✓ Added</span>
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

// ── Main component ────────────────────────────────────────────
interface Props extends StepProps { onNext: () => void; onBack: () => void }

export default function StepQuestions({ draft, updateConfig, onNext, onBack }: Props) {
  const questions: SurveyQuestion[] = draft.config.questions ?? []
  const [addingType, setAddingType] = useState<QuestionType | null>(null)
  const industry = (draft as any).industry as string | undefined

  const setQuestions = (qs: SurveyQuestion[]) => updateConfig({ questions: qs })

  const addQuestion = (type: QuestionType) => {
    const q: SurveyQuestion = {
      id:      genId(),
      type,
      prompt:  '',
      required: false,
      ...(type === 'radio' || type === 'checkbox' || type === 'dropdown' ? { options: ['', ''] } : {}),
      ...(type === 'likert' ? {
        likertScale: [
          { score: 1, emoji: '😞', label: 'Strongly disagree' },
          { score: 2, emoji: '😕', label: 'Disagree' },
          { score: 3, emoji: '😐', label: 'Neutral' },
          { score: 4, emoji: '😊', label: 'Agree' },
          { score: 5, emoji: '😍', label: 'Strongly agree' },
        ]
      } : {}),
    }
    setQuestions([...questions, q])
    setAddingType(null)
  }

  const addSuggestedQuestion = (q: SurveyQuestion) => setQuestions([...questions, q])

  const updateQ  = (i: number, q: SurveyQuestion) => setQuestions(questions.map((old, j) => j === i ? q : old))
  const deleteQ  = (i: number) => setQuestions(questions.filter((_, j) => j !== i))
  const moveUp   = (i: number) => { if (i === 0) return; const qs = [...questions]; [qs[i-1], qs[i]] = [qs[i], qs[i-1]]; setQuestions(qs) }
  const moveDown = (i: number) => { if (i === questions.length - 1) return; const qs = [...questions]; [qs[i], qs[i+1]] = [qs[i+1], qs[i]]; setQuestions(qs) }

  // Track which suggested question keys are already added (by checking exportLabel prefix match)
  const existingIds = new Set(questions.map(q => q.id?.split('_')[0] ?? ''))

  return (
    <div className="flex flex-col gap-6">
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

      {/* Questions list */}
      {questions.length > 0 && (
        <div className="flex flex-col gap-3">
          {questions.map((q, i) => (
            <QuestionCard
              key={q.id}
              q={q}
              idx={i}
              total={questions.length}
              onChange={updated => updateQ(i, updated)}
              onDelete={() => deleteQ(i)}
              onMoveUp={() => moveUp(i)}
              onMoveDown={() => moveDown(i)}
            />
          ))}
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
