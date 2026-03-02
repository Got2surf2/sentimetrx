'use client'

import { useState } from 'react'
import type { StepProps } from '@/lib/studyDraft'
import { Section, NavButtons } from './CreatorUI'
import type { PsychoQuestion } from '@/lib/types'

interface Props extends StepProps { onNext: () => void; onBack: () => void }

function QuestionCard({
  q, idx, total,
  onChange, onRemove, onMoveUp, onMoveDown
}: {
  q: PsychoQuestion
  idx: number
  total: number
  onChange: (q: PsychoQuestion) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}) {
  const updateOpt = (i: number, val: string) => {
    const opts = q.opts.map((o, j) => j === i ? val : o)
    onChange({ ...q, opts })
  }

  const addOpt = () => {
    if (q.opts.length >= 6) return
    onChange({ ...q, opts: [...q.opts, ''] })
  }

  const removeOpt = (i: number) => {
    onChange({ ...q, opts: q.opts.filter((_, j) => j !== i) })
  }

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="text-xs text-slate-500 mb-1.5 font-medium">Question {idx + 1}</div>
          <input
            type="text"
            value={q.q}
            onChange={e => onChange({ ...q, q: e.target.value })}
            placeholder="e.g. Which best describes your relationship with us?"
            className="w-full bg-transparent text-white text-sm outline-none border-b border-slate-600 focus:border-cyan-500 pb-1 transition-colors placeholder-slate-500"
          />
        </div>
        <div className="flex flex-col gap-1 flex-shrink-0">
          <button onClick={onMoveUp}   disabled={idx === 0}         className="text-slate-500 hover:text-white disabled:opacity-20 transition-colors text-xs px-2 py-1 rounded hover:bg-slate-700">Up</button>
          <button onClick={onMoveDown} disabled={idx === total - 1} className="text-slate-500 hover:text-white disabled:opacity-20 transition-colors text-xs px-2 py-1 rounded hover:bg-slate-700">Dn</button>
          <button onClick={onRemove} className="text-slate-500 hover:text-red-400 transition-colors text-xs px-2 py-1 rounded hover:bg-red-500/10">Del</button>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {q.opts.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-slate-600 text-xs w-4 text-center flex-shrink-0">{i + 1}</span>
            <input
              type="text"
              value={opt}
              onChange={e => updateOpt(i, e.target.value)}
              placeholder={`Answer option ${i + 1}`}
              className="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-500 transition-colors"
            />
            {q.opts.length > 2 && (
              <button
                onClick={() => removeOpt(i)}
                className="text-slate-600 hover:text-red-400 transition-colors text-sm flex-shrink-0 w-6"
              >
                x
              </button>
            )}
          </div>
        ))}
        {q.opts.length < 6 && (
          <button
            onClick={addOpt}
            className="text-xs text-slate-500 hover:text-cyan-400 transition-colors text-left px-3 py-1.5 mt-1"
          >
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
    updateConfig({
      psychographicBank: [
        ...bank,
        { key, q: '', opts: ['', ''] }
      ]
    })
  }

  const updateQ = (idx: number, q: PsychoQuestion) => {
    updateConfig({ psychographicBank: bank.map((item, i) => i === idx ? q : item) })
  }

  const removeQ = (idx: number) => {
    updateConfig({ psychographicBank: bank.filter((_, i) => i !== idx) })
  }

  const moveUp = (idx: number) => {
    if (idx === 0) return
    const next = [...bank]
    ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
    updateConfig({ psychographicBank: next })
  }

  const moveDown = (idx: number) => {
    if (idx === bank.length - 1) return
    const next = [...bank]
    ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
    updateConfig({ psychographicBank: next })
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Psychographic questions</h2>
        <p className="text-slate-400 text-sm">
          Multiple choice questions asked near the end of the survey.
          The bot randomly selects 3 to ask each respondent — add as many as you like.
        </p>
      </div>

      <Section title={`Questions (${bank.length})`}>
        {bank.length === 0 ? (
          <div className="text-center py-10 border border-dashed border-slate-700 rounded-2xl">
            <p className="text-slate-500 text-sm mb-3">No questions yet</p>
            <button
              onClick={addQuestion}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium transition-all"
            >
              Add first question
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {bank.map((q, i) => (
              <QuestionCard
                key={q.key}
                q={q}
                idx={i}
                total={bank.length}
                onChange={q => updateQ(i, q)}
                onRemove={() => removeQ(i)}
                onMoveUp={() => moveUp(i)}
                onMoveDown={() => moveDown(i)}
              />
            ))}
          </div>
        )}
        {bank.length > 0 && (
          <button
            onClick={addQuestion}
            className="mt-2 text-sm text-slate-500 hover:text-cyan-400 transition-colors px-4 py-2.5 rounded-xl border border-dashed border-slate-700 hover:border-slate-600 w-full"
          >
            + Add another question
          </button>
        )}
      </Section>

      <NavButtons
        onBack={onBack}
        onNext={onNext}
        nextLabel="Next: Review & Publish"
      />
    </div>
  )
}
