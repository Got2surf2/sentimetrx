'use client'

import { useState } from 'react'
import type { StepProps } from '@/lib/studyDraft'
import { Field, Input, Section, NavButtons } from './CreatorUI'

interface Props extends StepProps { onNext: () => void; onBack: () => void }

const inputCls = 'w-full px-3 py-2 rounded-lg bg-white border border-gray-300 text-gray-800 text-sm placeholder-gray-400 outline-none focus:border-orange-400 transition-colors'

export default function StepClarifiers({ draft, updateConfig, onNext, onBack }: Props) {
  const c = draft.config
  const [newKw, setNewKw] = useState('')
  const [newQ,  setNewQ]  = useState('')

  const addClarifier = () => {
    const kw = newKw.trim().toLowerCase().replace(/\s+/g, '_')
    const q  = newQ.trim()
    if (!kw || !q) return
    updateConfig({ clarifiers: { ...c.clarifiers, [kw]: q } })
    setNewKw('')
    setNewQ('')
  }

  const removeClarifier = (key: string) => {
    const next = { ...c.clarifiers }
    delete next[key]
    updateConfig({ clarifiers: next })
  }

  const clarifierEntries = Object.entries(c.clarifiers).filter(([k]) => k !== 'default')

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800 mb-1">Clarifiers</h2>
        <p className="text-gray-500 text-sm">
          When a respondent gives a short or vague answer the bot probes for more detail.
          Set a default fallback and optional keyword-triggered follow-ups.
        </p>
      </div>

      {/* AI vs keyword mode */}
      <Section title="Follow-up mode">
        <div className="flex items-center justify-between bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-gray-800">AI-powered follow-ups</div>
            <div className="text-xs text-gray-500 mt-0.5">
              Use Claude to generate intelligent, contextual clarifying questions instead of keyword matching
            </div>
          </div>
          <button
            type="button"
            onClick={() => updateConfig({ useAIClarify: !c.useAIClarify })}
            className={'relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 ml-4 border-2 border-transparent ' + (c.useAIClarify ? 'bg-orange-500' : 'bg-gray-200')}
          >
            <span className={'inline-block w-5 h-5 bg-white rounded-full shadow-md transition-transform transform ' + (c.useAIClarify ? 'translate-x-5' : 'translate-x-0')} />
          </button>
        </div>
        {!c.useAIClarify && (
          <p className="text-xs text-gray-400 px-1">Keyword matching active — add triggers below or enable AI for smarter follow-ups.</p>
        )}
        {c.useAIClarify && (
          <p className="text-xs text-orange-600 px-1">✦ AI will generate follow-ups using study context, sentiment, and prior answers. Keyword rules below are used as fallback.</p>
        )}
      </Section>

      {/* Default clarifier */}
      <Section
        title="Default clarifier"
        description="Used as a fallback when no keyword matches or AI is disabled."
      >
        <Field label="Fallback question">
          <Input
            value={c.clarifiers.default}
            onChange={v => updateConfig({ clarifiers: { ...c.clarifiers, default: v } })}
            placeholder="Could you tell me a little more about that?"
          />
        </Field>
        {!c.clarifiers.default.trim() && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => updateConfig({ clarifiers: { ...c.clarifiers, default: 'Could you tell me a little more about that?' } })}
              className="text-xs font-semibold text-orange-500 hover:text-orange-600 bg-orange-50 hover:bg-orange-100 px-3 py-1.5 rounded-lg transition-colors"
            >
              ↺ Use suggested
            </button>
            <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
              ⚠ Required — greyed text is a suggestion only
            </span>
          </div>
        )}
      </Section>

      {/* Keyword clarifiers */}
      <Section
        title="Keyword clarifiers"
        description="When a response contains a trigger keyword, the bot asks a specific follow-up instead of the default."
      >
        {clarifierEntries.length > 0 && (
          <div className="flex flex-col gap-2">
            {clarifierEntries.map(function(entry) {
              const kw = entry[0]
              const q  = entry[1]
              return (
                <div key={kw} className="flex items-start gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-mono text-orange-500 mb-1">keyword: {kw}</div>
                    <div className="text-sm text-gray-700 whitespace-pre-wrap">{q as string}</div>
                  </div>
                  <button
                    onClick={() => removeClarifier(kw)}
                    className="text-gray-400 hover:text-red-500 transition-colors text-lg flex-shrink-0 leading-none"
                  >
                    ×
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {clarifierEntries.length === 0 && (
          <p className="text-sm text-gray-400 italic">No keyword clarifiers yet — add one below.</p>
        )}

        {/* Add new clarifier */}
        <div className="bg-gray-50 border border-dashed border-gray-300 rounded-xl p-4 flex flex-col gap-3">
          <p className="text-gray-500 text-xs font-semibold uppercase tracking-wide">Add keyword clarifier</p>
          <input
            type="text"
            value={newKw}
            onChange={e => setNewKw(e.target.value)}
            placeholder="Trigger keyword (e.g. price, wait, staff)"
            className={inputCls}
          />
          <input
            type="text"
            value={newQ}
            onChange={e => setNewQ(e.target.value)}
            placeholder="Clarifying question to ask when this keyword appears"
            className={inputCls}
            onKeyDown={e => { if (e.key === 'Enter') addClarifier() }}
          />
          <button
            onClick={addClarifier}
            disabled={!newKw.trim() || !newQ.trim()}
            className="self-start px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 disabled:opacity-40 text-gray-700 text-sm font-medium transition-all"
          >
            Add clarifier
          </button>
        </div>
      </Section>

      <NavButtons onBack={onBack} onNext={onNext} nextDisabled={!c.clarifiers.default.trim()} nextLabel="Next: Custom Questions" />
    </div>
  )
}
