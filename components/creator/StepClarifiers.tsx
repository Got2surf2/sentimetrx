'use client'

import { useEffect, useState } from 'react'
import type { StepProps } from '@/lib/studyDraft'
import { Field, Input, Section, NavButtons } from './CreatorUI'

const DEFAULT_FALLBACK = 'Could you tell me a little more about that?'

const inputCls = 'w-full px-3 py-2 rounded-lg text-sm text-gray-800 placeholder-gray-400 bg-white border border-gray-300 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-colors'
const labelCls = 'block text-xs font-semibold text-gray-500 mb-1'

interface Props extends StepProps { onNext: () => void; onBack: () => void }

export default function StepClarifiers({ draft, updateConfig, onNext, onBack }: Props) {
  const c = draft.config

  // Auto-fill the default clarifier on mount if empty
  useEffect(() => {
    if (!c.clarifiers?.default?.trim()) {
      updateConfig({ clarifiers: { ...c.clarifiers, default: DEFAULT_FALLBACK } })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keyword clarifier rows — any key in clarifiers except 'default'
  const keywordEntries = Object.entries(c.clarifiers ?? {}).filter(([k]) => k !== 'default')

  const [newKeyword, setNewKeyword] = useState('')
  const [newResponse, setNewResponse] = useState('')

  function addKeyword() {
    const kw = newKeyword.trim().toLowerCase()
    const rs = newResponse.trim()
    if (!kw || !rs) return
    updateConfig({ clarifiers: { ...c.clarifiers, [kw]: rs } })
    setNewKeyword('')
    setNewResponse('')
  }

  function removeKeyword(kw: string) {
    const next = { ...c.clarifiers }
    delete next[kw]
    updateConfig({ clarifiers: next })
  }

  const maxCount = c.maxClarifierCount ?? 5

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800 mb-1">Clarifiers</h2>
        <p className="text-gray-500 text-sm">
          When a respondent gives a short or vague answer the bot probes for more detail.
          Settings here apply globally to all open-ended fields.
        </p>
      </div>

      {/* AI mode toggle */}
      <Section title="AI-powered follow-ups">
        <div className="flex items-center justify-between bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-gray-800">Enable AI clarifiers (all open-ended fields)</div>
            <div className="text-xs text-gray-500 mt-0.5">
              Uses AI to generate intelligent, contextual clarifying questions based on study context, sentiment, and prior answers
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
        {c.useAIClarify && (
          <p className="text-xs text-orange-600 px-1">✦ AI will generate contextual follow-ups. Keyword triggers still fire first; AI handles the rest.</p>
        )}
      </Section>

      {/* Max clarifier count */}
      <Section title="Maximum clarifiers per session">
        <div className="flex items-center gap-4 bg-white border border-gray-200 rounded-xl px-4 py-3">
          <div className="flex-1">
            <div className="text-sm text-gray-700">
              {`Clarifier fires at most ${maxCount} time${maxCount === 1 ? '' : 's'} per respondent`}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => updateConfig({ maxClarifierCount: Math.max(1, maxCount - 1) })}
              disabled={maxCount <= 1}
              className="w-8 h-8 rounded-xl border border-gray-300 bg-white text-gray-700 font-bold hover:border-orange-400 hover:text-orange-500 disabled:opacity-30 transition-all flex items-center justify-center"
            >
              −
            </button>
            <span className="w-12 text-center text-lg font-bold text-gray-800">
              {maxCount}
            </span>
            <button
              type="button"
              onClick={() => updateConfig({ maxClarifierCount: maxCount + 1 })}
              className="w-8 h-8 rounded-xl border border-gray-300 bg-white text-gray-700 font-bold hover:border-orange-400 hover:text-orange-500 transition-all flex items-center justify-center"
            >
              +
            </button>
          </div>
        </div>
      </Section>

      {/* Keyword clarifiers */}
      <Section
        title="Keyword triggers"
        description="When a response contains a keyword the bot asks the paired follow-up question instead of the default."
      >
        <div className="flex flex-col gap-2">
          {keywordEntries.length === 0 && (
            <p className="text-xs text-gray-400 px-1">No keyword triggers yet.</p>
          )}
          {keywordEntries.map(([kw, response]) => (
            <div key={kw} className="flex items-start gap-3 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-orange-600 mb-0.5">if response contains "{kw}"</div>
                <div className="text-sm text-gray-700">{response}</div>
              </div>
              <button
                type="button"
                onClick={() => removeKeyword(kw)}
                className="text-xs text-red-400 hover:text-red-600 flex-shrink-0 mt-0.5"
              >
                Remove
              </button>
            </div>
          ))}

          {/* Add new keyword trigger */}
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 flex flex-col gap-2 mt-1">
            <div className="text-xs font-semibold text-orange-700 mb-0.5">Add keyword trigger</div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className={labelCls}>Keyword or phrase</label>
                <input
                  type="text"
                  value={newKeyword}
                  onChange={e => setNewKeyword(e.target.value)}
                  placeholder="e.g. wait time, staff, price"
                  className={inputCls}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>Follow-up question to ask</label>
              <input
                type="text"
                value={newResponse}
                onChange={e => setNewResponse(e.target.value)}
                placeholder="e.g. Tell me more about the wait time..."
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addKeyword() } }}
                className={inputCls}
              />
            </div>
            <button
              type="button"
              onClick={addKeyword}
              disabled={!newKeyword.trim() || !newResponse.trim()}
              className="self-start text-xs font-semibold text-white bg-orange-500 hover:bg-orange-400 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
            >
              + Add trigger
            </button>
          </div>
        </div>
      </Section>

      {/* Default clarifier */}
      <Section
        title="Default fallback"
        description="Used when no keyword trigger fires (or AI is disabled)."
      >
        <Field label="Fallback question">
          <Input
            value={c.clarifiers.default}
            onChange={v => updateConfig({ clarifiers: { ...c.clarifiers, default: v } })}
            placeholder={DEFAULT_FALLBACK}
          />
        </Field>
        {!c.clarifiers.default.trim() && (
          <button
            type="button"
            onClick={() => updateConfig({ clarifiers: { ...c.clarifiers, default: DEFAULT_FALLBACK } })}
            className="text-xs font-semibold text-orange-500 hover:text-orange-600 bg-orange-50 hover:bg-orange-100 px-3 py-1.5 rounded-lg transition-colors"
          >
            ↺ Use suggested
          </button>
        )}
      </Section>

      {/* Question redirect */}
      <Section
        title="Smart deflection"
        description="When a respondent asks a question or goes off-topic instead of giving feedback, the bot uses AI to generate a contextual response that politely redirects them to a resource link, then continues the survey."
      >
        <div className="flex items-center justify-between bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-gray-800">Enable AI deflection</div>
            <div className="text-xs text-gray-500 mt-0.5">
              Uses AI to detect questions and off-topic responses, then generates a warm contextual redirect
            </div>
          </div>
          <button
            type="button"
            onClick={() => updateConfig({ questionRedirect: { ...c.questionRedirect, enabled: !c.questionRedirect?.enabled, message: c.questionRedirect?.message || '', linkText: c.questionRedirect?.linkText || '', linkUrl: c.questionRedirect?.linkUrl || '' } })}
            className={'relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 ml-4 border-2 border-transparent ' + (c.questionRedirect?.enabled ? 'bg-orange-500' : 'bg-gray-200')}
          >
            <span className={'inline-block w-5 h-5 bg-white rounded-full shadow-md transition-transform transform ' + (c.questionRedirect?.enabled ? 'translate-x-5' : 'translate-x-0')} />
          </button>
        </div>
        {c.questionRedirect?.enabled && (
          <div className="flex flex-col gap-3 mt-2">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Deflection message (optional)</label>
              <textarea
                value={c.questionRedirect?.message || ''}
                onChange={e => updateConfig({ questionRedirect: { ...c.questionRedirect!, message: e.target.value } })}
                placeholder="e.g. Thanks for asking! I'm just here to gather your feedback. Let's continue with the survey."
                rows={2}
                className={inputCls}
                style={{ resize: 'vertical', minHeight: 56 }}
              />
              <p className="text-xs text-gray-400 mt-1">
                Leave blank to let the AI generate a response. Or write your own — the AI will adapt it naturally to what the respondent said.
              </p>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-xs font-semibold text-gray-500 mb-1">Link text (optional)</label>
                <input
                  type="text"
                  value={c.questionRedirect?.linkText || ''}
                  onChange={e => updateConfig({ questionRedirect: { ...c.questionRedirect!, linkText: e.target.value } })}
                  placeholder="our website"
                  className={inputCls}
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-semibold text-gray-500 mb-1">Link URL (optional)</label>
                <input
                  type="text"
                  value={c.questionRedirect?.linkUrl || ''}
                  onChange={e => updateConfig({ questionRedirect: { ...c.questionRedirect!, linkUrl: e.target.value } })}
                  placeholder="https://example.com/faq"
                  className={inputCls}
                />
              </div>
            </div>
          </div>
        )}
      </Section>

      {/* Testing mode */}
      <Section title="Testing mode" description="Expose AI reasoning inline with bot messages — useful for demos and client walkthroughs.">
        <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-gray-800">Show AI thinking</div>
            <div className="text-xs text-gray-500 mt-0.5">Clarifier decisions, deflection reasoning, and sentiment detection shown below each bot message</div>
          </div>
          <button
            type="button"
            onClick={() => updateConfig({ testing: !c.testing })}
            className={'relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 ml-4 border-2 border-transparent ' + (c.testing ? 'bg-amber-500' : 'bg-gray-200')}
          >
            <span className={'inline-block w-5 h-5 bg-white rounded-full shadow-md transition-transform transform ' + (c.testing ? 'translate-x-5' : 'translate-x-0')} />
          </button>
        </div>
      </Section>

      <NavButtons onBack={onBack} onNext={onNext} nextLabel="Next: Custom Questions" />
    </div>
  )
}
