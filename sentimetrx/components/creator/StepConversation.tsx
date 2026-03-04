'use client'

import { useState } from 'react'
import type { StepProps } from '@/lib/studyDraft'
import { Field, Input, Section, NavButtons, Divider } from './CreatorUI'

interface Props extends StepProps { onNext: () => void; onBack: () => void }

export default function StepConversation({ draft, updateConfig, onNext, onBack }: Props) {
  const c = draft.config
  const [newKw, setNewKw]   = useState('')
  const [newQ,  setNewQ]    = useState('')

  const canNext =
    c.promoterQ1.trim() && c.passiveQ1.trim() && c.detractorQ1.trim() &&
    c.q3.trim() && c.q4.trim() && c.clarifiers.default.trim()

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
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-xl font-bold text-white mb-1">Conversation</h2>
        <p className="text-slate-400 text-sm">The questions the bot asks after the initial rating.</p>
      </div>

      <Section
        title="First follow-up — three variants"
        description="The bot adapts this question based on how the respondent rated their experience."
      >
        <Field label="For promoters (score 5 — best experience)">
          <Input
            value={c.promoterQ1}
            onChange={v => updateConfig({ promoterQ1: v })}
            placeholder="That's wonderful to hear! What stood out most about your experience?"
            multiline
            rows={2}
          />
        </Field>
        <Field label="For passives (score 4 — good experience)">
          <Input
            value={c.passiveQ1}
            onChange={v => updateConfig({ passiveQ1: v })}
            placeholder="Thanks for sharing that. What would have made it even better?"
            multiline
            rows={2}
          />
        </Field>
        <Field label="For detractors (scores 1–3 — poor experience)">
          <Input
            value={c.detractorQ1}
            onChange={v => updateConfig({ detractorQ1: v })}
            placeholder="I'm sorry to hear that. What went wrong, and what would have improved things?"
            multiline
            rows={2}
          />
        </Field>
      </Section>

      <Divider />

      <Section
        title="Second question (Q3)"
        description="Asked after the first follow-up. Usually a broader or deeper question."
      >
        <Input
          value={c.q3}
          onChange={v => updateConfig({ q3: v })}
          placeholder="Is there anything specific you think we should do differently?"
          multiline
          rows={2}
        />
        <Field label="CSV export column name (optional)">
          <Input
            value={c.q3ExportLabel || ''}
            onChange={v => updateConfig({ q3ExportLabel: v })}
            placeholder="e.g. Improvement Suggestion — leave blank to use the question text"
          />
        </Field>
      </Section>

      <Section
        title="Third question (Q4)"
        description="The final open-ended question before psychographic questions."
      >
        <Input
          value={c.q4}
          onChange={v => updateConfig({ q4: v })}
          placeholder="Is there anything else you'd like us to know?"
          multiline
          rows={2}
        />
        <Field label="CSV export column name (optional)">
          <Input
            value={c.q4ExportLabel || ''}
            onChange={v => updateConfig({ q4ExportLabel: v })}
            placeholder="e.g. Additional Comments — leave blank to use the question text"
          />
        </Field>
      </Section>

      <Divider />

      <Section
        title="Clarifying questions"
        description="When a respondent gives a short answer, the bot asks a follow-up to get more detail. Add trigger keywords and the question to ask when that word appears in their answer."
      >
        {/* Default clarifier */}
        <Field label="Default clarifier (used when no keyword matches)">
          <Input
            value={c.clarifiers.default}
            onChange={v => updateConfig({ clarifiers: { ...c.clarifiers, default: v } })}
            placeholder="Could you tell me a little more about that?"
          />
        </Field>

        {/* Existing clarifiers */}
        {clarifierEntries.length > 0 && (
          <div className="flex flex-col gap-2 mt-2">
            {clarifierEntries.map(([kw, q]) => (
              <div key={kw} className="flex items-start gap-3 bg-slate-800/50 border border-slate-700 rounded-xl px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono text-cyan-400 mb-1">keyword: {kw}</div>
                  <div className="text-sm text-slate-300">{q as string}</div>
                </div>
                <button
                  onClick={() => removeClarifier(kw)}
                  className="text-slate-500 hover:text-red-400 transition-colors text-lg flex-shrink-0 leading-none"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add new clarifier */}
        <div className="bg-slate-800/30 border border-slate-700 border-dashed rounded-xl p-4 flex flex-col gap-3">
          <p className="text-slate-500 text-xs font-medium uppercase tracking-wide">Add keyword clarifier</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={newKw}
              onChange={e => setNewKw(e.target.value)}
              placeholder="Trigger keyword (e.g. price)"
              className="flex-1 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm placeholder-slate-500 outline-none focus:border-cyan-500 transition-colors"
            />
          </div>
          <input
            type="text"
            value={newQ}
            onChange={e => setNewQ(e.target.value)}
            placeholder="Clarifying question to ask when this word appears"
            className="w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-white text-sm placeholder-slate-500 outline-none focus:border-cyan-500 transition-colors"
            onKeyDown={e => e.key === 'Enter' && addClarifier()}
          />
          <button
            onClick={addClarifier}
            disabled={!newKw.trim() || !newQ.trim()}
            className="self-start px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-white text-sm font-medium transition-all"
          >
            Add clarifier
          </button>
        </div>
      </Section>

      <NavButtons
        onBack={onBack}
        onNext={onNext}
        nextDisabled={!canNext}
        nextLabel="Next: Psychographics"
      />
    </div>
  )
}
