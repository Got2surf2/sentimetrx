'use client'

import { useState } from 'react'
import type { StepProps } from '@/lib/studyDraft'
import { Section, NavButtons } from './CreatorUI'
import type { PsychoQuestion } from '@/lib/types'

interface Props extends StepProps { onNext: () => void; onBack: () => void }

function QuestionCard({ q, idx, total, onChange, onRemove, onMoveUp, onMoveDown }: {
  q: PsychoQuestion; idx: number; total: number
  onChange: (q: PsychoQuestion) => void
  onRemove: () => void; onMoveUp: () => void; onMoveDown: () => void
}) {
  const updateOpt = (i: number, val: string) =>
    onChange({ ...q, opts: q.opts.map((o, j) => j === i ? val : o) })

  const addOpt    = () => { if (q.opts.length < 6) onChange({ ...q, opts: [...q.opts, ''] }) }
  const removeOpt = (i: number) => onChange({ ...q, opts: q.opts.filter((_, j) => j !== i) })

  const inputCls = 'flex-1 px-3 py-2 rounded-lg bg-white border border-gray-300 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-orange-400 transition-colors'

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 flex flex-col gap-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 flex flex-col gap-2">
          <div className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Question {idx + 1}</div>
          {/* Question text */}
          <input
            type="text"
            value={q.q}
            onChange={e => onChange({ ...q, q: e.target.value })}
            placeholder="e.g. Which best describes your relationship with us?"
            className="w-full px-3 py-2 rounded-lg bg-gray-50 border border-gray-300 text-sm text-gray-800 placeholder-gray-400 outline-none focus:border-orange-400 transition-colors"
          />
          {/* Export label */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 font-medium">CSV export column name (optional)</label>
            <input
              type="text"
              value={(q as any).exportLabel || ''}
              onChange={e => onChange({ ...q, exportLabel: e.target.value } as any)}
              placeholder="Short label — e.g. Customer Type (leave blank to use question text)"
              className="w-full px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-600 placeholder-gray-400 outline-none focus:border-orange-400 transition-colors"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1 flex-shrink-0">
          <button onClick={onMoveUp}   disabled={idx === 0}         className="text-gray-400 hover:text-gray-700 disabled:opacity-20 transition-colors text-xs px-2 py-1 rounded hover:bg-gray-100">↑</button>
          <button onClick={onMoveDown} disabled={idx === total - 1} className="text-gray-400 hover:text-gray-700 disabled:opacity-20 transition-colors text-xs px-2 py-1 rounded hover:bg-gray-100">↓</button>
          <button onClick={onRemove} className="text-gray-400 hover:text-red-500 transition-colors text-xs px-2 py-1 rounded hover:bg-red-50">✕</button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="text-xs text-gray-500 font-medium">Answer options</div>
        {q.opts.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-gray-400 text-xs w-4 text-center flex-shrink-0">{i + 1}</span>
            <input
              type="text"
              value={opt}
              onChange={e => updateOpt(i, e.target.value)}
              placeholder={`Option ${i + 1}`}
              className={inputCls}
            />
            {q.opts.length > 2 && (
              <button onClick={() => removeOpt(i)} className="text-gray-300 hover:text-red-400 transition-colors text-sm flex-shrink-0 w-6">×</button>
            )}
          </div>
        ))}
        {q.opts.length < 6 && (
          <button onClick={addOpt} className="text-xs text-gray-400 hover:text-orange-500 transition-colors text-left px-3 py-1.5 mt-0.5">
            + Add option
          </button>
        )}
      </div>
    </div>
  )
}

export default function StepPsychographics({ draft, updateConfig, onNext, onBack }: Props) {
  const bank = draft.config.psychographicBank

  const addQuestion = () => {
    const key = `q_${Date.now()}`
    updateConfig({ psychographicBank: [...bank, { key, q: '', opts: ['', ''] }] })
  }

  const updateQ  = (idx: number, q: PsychoQuestion) =>
    updateConfig({ psychographicBank: bank.map((item, i) => i === idx ? q : item) })
  const removeQ  = (idx: number) =>
    updateConfig({ psychographicBank: bank.filter((_, i) => i !== idx) })
  const moveUp   = (idx: number) => {
    if (idx === 0) return
    const next = [...bank]; [next[idx-1], next[idx]] = [next[idx], next[idx-1]]
    updateConfig({ psychographicBank: next })
  }
  const moveDown = (idx: number) => {
    if (idx === bank.length - 1) return
    const next = [...bank]; [next[idx], next[idx+1]] = [next[idx+1], next[idx]]
    updateConfig({ psychographicBank: next })
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800 mb-1">Psychographic questions</h2>
        <p className="text-gray-500 text-sm">
          Multiple choice questions asked near the end of the survey.
          The bot randomly selects 3 to ask each respondent. Each question has an optional CSV export column name.
        </p>
      </div>

      <Section title={`Questions (${bank.length})`}>
        {bank.length === 0 ? (
          <div className="text-center py-10 border border-dashed border-gray-300 rounded-2xl">
            <p className="text-gray-400 text-sm mb-3">No questions yet</p>
            <button onClick={addQuestion}
              className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium transition-all">
              Add first question
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {bank.map((q, i) => (
              <QuestionCard key={q.key} q={q} idx={i} total={bank.length}
                onChange={q => updateQ(i, q)}
                onRemove={() => removeQ(i)}
                onMoveUp={() => moveUp(i)}
                onMoveDown={() => moveDown(i)} />
            ))}
          </div>
        )}
        {bank.length > 0 && (
          <button onClick={addQuestion}
            className="mt-2 text-sm text-gray-500 hover:text-orange-500 transition-colors px-4 py-2.5 rounded-xl border border-dashed border-gray-300 hover:border-orange-300 w-full">
            + Add another question
          </button>
        )}
      </Section>

      <NavButtons onBack={onBack} onNext={onNext} nextLabel="Next: Review & Publish" />
    </div>
  )
}
