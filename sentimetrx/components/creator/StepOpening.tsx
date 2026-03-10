'use client'

import { useState } from 'react'
import type { StepProps } from '@/lib/studyDraft'
import { Input, Section, NavButtons } from './CreatorUI'
import type { RatingOption, LikertFollowUp } from '@/lib/types'

const EMOJI_OPTIONS = ['😞','😕','😐','😊','😍','🤷','👀','📖','👍','❤️','⭐','💔','😡','😢','😄','🎉','👎','👌','🙌','💪']

const inputCls = 'w-full px-4 py-2.5 rounded-xl text-sm text-gray-800 placeholder-gray-400 bg-white border border-gray-300 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-colors'
const labelCls = 'block text-xs font-semibold text-gray-600 mb-1'

interface Props extends StepProps { onNext: () => void; onBack: () => void }

// ── Reusable toggle ──────────────────────────────────────────
function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer select-none">
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={'relative inline-flex w-11 h-6 rounded-full transition-colors border-2 border-transparent flex-shrink-0 ' + (value ? 'bg-orange-500' : 'bg-gray-200')}
      >
        <span className={'inline-block w-5 h-5 bg-white rounded-full shadow-md transition-transform transform ' + (value ? 'translate-x-5' : 'translate-x-0')} />
      </button>
      <span className="text-sm text-gray-700">{label}</span>
    </label>
  )
}

// ── Adaptive follow-up panel ─────────────────────────────────
function FollowUpPanel({
  followUp, onChange, scaleOptions, defaultPrompts
}: {
  followUp:        LikertFollowUp | undefined
  onChange:        (fu: LikertFollowUp) => void
  scaleOptions:    { score: number; label: string }[]
  defaultPrompts?: Record<number, string>
}) {
  const fu = followUp ?? {
    enabled: false, mode: 'shared',
    sharedPrompt: '', shareClarify: false, shareAI: false,
    perResponse: {}
  }

  const set = (patch: Partial<LikertFollowUp>) => onChange({ ...fu, ...patch })

  const setPerResponse = (score: number, patch: Partial<{ prompt: string; clarify: boolean; useAI: boolean }>) => {
    const prev = fu.perResponse?.[score] ?? { prompt: '', clarify: false, useAI: false }
    set({ perResponse: { ...fu.perResponse, [score]: { ...prev, ...patch } } })
  }

  return (
    <div className="border border-gray-200 rounded-2xl overflow-hidden">
      {/* Header toggle */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div>
          <div className="text-sm font-semibold text-gray-700">Adaptive follow-up</div>
          <div className="text-xs text-gray-400 mt-0.5">Ask an open-ended question based on the response given</div>
        </div>
        <Toggle value={fu.enabled} onChange={v => set({ enabled: v })} label="" />
      </div>

      {fu.enabled && (
        <div className="px-4 py-4 flex flex-col gap-4">
          {/* Shared vs per-response mode */}
          <div className="flex gap-2">
            {(['shared', 'per-response'] as const).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => set({ mode: m })}
                className={'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ' +
                  (fu.mode === m
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'bg-white text-gray-500 border-gray-300 hover:border-orange-300')}
              >
                {m === 'shared' ? 'One prompt for all responses' : 'Unique prompt per response'}
              </button>
            ))}
          </div>

          {fu.mode === 'shared' ? (
            <div className="flex flex-col gap-3">
              <div>
                <label className={labelCls}>Follow-up prompt</label>
                <textarea
                  value={fu.sharedPrompt}
                  onChange={e => set({ sharedPrompt: e.target.value })}
                  placeholder={defaultPrompts?.[3] || "Could you tell us a bit more about that?"}
                  rows={2}
                  className={inputCls + ' resize-none'}
                />
              </div>
              <div className="flex gap-4">
                <Toggle value={fu.shareClarify} onChange={v => set({ shareClarify: v })} label="Keyword clarifier" />
                <Toggle value={fu.shareAI} onChange={v => set({ shareAI: v })} label="AI clarifier" />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {scaleOptions.map(opt => {
                const pr = fu.perResponse?.[opt.score] ?? { prompt: '', clarify: false, useAI: false }
                return (
                  <div key={opt.score} className="bg-gray-50 rounded-xl p-3 flex flex-col gap-2">
                    <div className="text-xs font-semibold text-gray-500">{opt.score} — {opt.label}</div>
                    <textarea
                      value={pr.prompt}
                      onChange={e => setPerResponse(opt.score, { prompt: e.target.value })}
                      placeholder={defaultPrompts?.[opt.score] || `Follow-up for "${opt.label}" response...`}
                      rows={2}
                      className={inputCls + ' resize-none text-xs'}
                    />
                    <div className="flex gap-4">
                      <Toggle value={pr.clarify} onChange={v => setPerResponse(opt.score, { clarify: v })} label="Keyword clarifier" />
                      <Toggle value={pr.useAI} onChange={v => setPerResponse(opt.score, { useAI: v })} label="AI clarifier" />
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

// ── Rating variable option ────────────────────────────────────
function RatingVariableOption({
  selected, onSelect, label, sublabel, primaryColor
}: {
  selected:     boolean
  onSelect:     () => void
  label:        string
  sublabel:     string
  primaryColor: string
}) {
  const borderColor = selected ? primaryColor : '#e5e7eb'
  const bg          = selected ? '#fff7ed'    : '#fff'
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex items-center gap-3 w-full rounded-xl px-4 py-3 text-left transition-all border-2"
      style={{ borderColor, background: bg }}
    >
      <span
        className="w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center"
        style={{ borderColor: selected ? primaryColor : '#d1d5db' }}
      >
        {selected && (
          <span className="w-2 h-2 rounded-full block" style={{ background: primaryColor }} />
        )}
      </span>
      <span className="flex flex-col">
        <span className="text-sm font-semibold text-gray-800">{label}</span>
        <span className="text-xs text-gray-400">{sublabel}</span>
      </span>
    </button>
  )
}

// ── Main component ───────────────────────────────────────────
export default function StepOpening({ draft, updateConfig, onNext, onBack }: Props) {
  const c = draft.config
  const [showNpsScale] = useState(true)

  const npsEnabled        = c.npsEnabled !== false
  const experienceEnabled = c.experienceEnabled !== false

  const canNext = c.greeting.trim() &&
    (!experienceEnabled || (c.ratingPrompt.trim() && c.ratingScale.every(r => r.emoji && r.label)))

  const updateScale = (idx: number, field: keyof RatingOption, value: string | number) => {
    const next = c.ratingScale.map((r, i) => i === idx ? { ...r, [field]: value } : r)
    updateConfig({ ratingScale: next })
  }

  const npsScaleOptions = [1,2,3,4,5].map(s => ({
    score: s,
    label: s === 1 ? 'No' : s === 2 ? 'Unlikely' : s === 3 ? 'Maybe' : s === 4 ? 'Likely' : 'Definitely'
  }))

  // Default follow-up prompts keyed by score — used as placeholders so creators know what good looks like
  const npsDefaultPrompts: Record<number, string> = {
    1: "That's really helpful to know. What's the main reason you wouldn't recommend us?",
    2: "We appreciate your honesty. What would need to change for you to feel more confident recommending us?",
    3: "Thanks for that. What's holding you back from recommending us more enthusiastically?",
    4: "Great to hear! What one thing would tip you to a definite yes?",
    5: "That means a lot! What would you say to someone who asked why they should try us?",
  }
  const experienceDefaultPrompts: Record<number, string> = {
    1: "We're sorry to hear that. Can you tell us what went wrong so we can fix it?",
    2: "Thanks for the feedback. What disappointed you most about your experience?",
    3: "Appreciate your honesty. What would have made this a better experience for you?",
    4: "Glad it was a good experience. What's one thing we could do even better?",
    5: "Wonderful! What stood out most that made it such a great experience?",
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800 mb-1">Opening</h2>
        <p className="text-gray-500 text-sm">Greeting, NPS, and experience rating configuration.</p>
      </div>

      {/* Greeting */}
      <Section title="Greeting message" description="The very first thing the bot says.">
        <Input
          value={c.greeting}
          onChange={v => updateConfig({ greeting: v })}
          placeholder={`Hi there — I'm ${draft.bot_name || 'your bot'} 👋 I'm here to collect your feedback. It'll only take a few minutes!`}
          multiline rows={3}
        />
      </Section>

      {/* NPS */}
      <Section
        title="NPS question"
        description="How likely respondents are to recommend you. Shown first."
        action={
          <Toggle
            value={npsEnabled}
            onChange={v => updateConfig({ npsEnabled: v })}
            label={npsEnabled ? 'Enabled' : 'Disabled'}
          />
        }
      >
        {npsEnabled && (
          <div className="flex flex-col gap-4">
            <div className="flex gap-3 items-start">
              <div className="flex-1">
                <label className={labelCls}>Question prompt</label>
                <Input
                  value={c.npsPrompt || ''}
                  onChange={v => updateConfig({ npsPrompt: v })}
                  placeholder="How likely are you to recommend us to a friend or someone you know?"
                  multiline rows={2}
                />
              </div>
              <div className="flex-shrink-0 w-28">
                <label className={labelCls}>Dashboard label</label>
                <input
                  type="text"
                  value={c.npsLabel || ''}
                  onChange={e => updateConfig({ npsLabel: e.target.value })}
                  placeholder="NPS"
                  maxLength={20}
                  className={inputCls}
                />
              </div>
            </div>
            <FollowUpPanel
              followUp={c.npsFollowUp}
              onChange={fu => updateConfig({ npsFollowUp: fu })}
              scaleOptions={npsScaleOptions}
              defaultPrompts={npsDefaultPrompts}
            />
          </div>
        )}
      </Section>

      {/* Experience rating */}
      <Section
        title="Experience rating"
        description="Emoji-based rating of the overall experience. Shown after the sentiment-adapted open-end."
        action={
          <Toggle
            value={experienceEnabled}
            onChange={v => updateConfig({ experienceEnabled: v })}
            label={experienceEnabled ? 'Enabled' : 'Disabled'}
          />
        }
      >
        {experienceEnabled && (
          <div className="flex flex-col gap-4">
            <div>
              <label className={labelCls}>Question prompt</label>
              <Input
                value={c.ratingPrompt}
                onChange={v => updateConfig({ ratingPrompt: v })}
                placeholder="How would you rate your overall experience with us today?"
                multiline rows={2}
              />
            </div>
            <div>
              <label className={labelCls}>Rating scale</label>
              <div className="flex flex-col gap-2">
                {c.ratingScale.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
                    <span className="text-gray-400 text-xs font-bold w-4 flex-shrink-0">{r.score}</span>
                    <select
                      value={r.emoji}
                      onChange={e => updateScale(i, 'emoji', e.target.value)}
                      className="bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-lg outline-none focus:border-orange-400 cursor-pointer flex-shrink-0"
                    >
                      {EMOJI_OPTIONS.map(e => <option key={e} value={e}>{e}</option>)}
                    </select>
                    <input
                      type="text"
                      value={r.label}
                      onChange={e => updateScale(i, 'label', e.target.value)}
                      placeholder={`Score ${r.score} label`}
                      className="flex-1 bg-transparent text-sm text-gray-700 placeholder-gray-400 outline-none border-b border-gray-300 focus:border-orange-400 pb-0.5 transition-colors"
                    />
                  </div>
                ))}
              </div>
              <p className="text-gray-400 text-xs px-1 mt-1">Score 1 = worst, Score 5 = best.</p>
            </div>
            <FollowUpPanel
              followUp={c.experienceFollowUp}
              onChange={fu => updateConfig({ experienceFollowUp: fu })}
              scaleOptions={c.ratingScale.map(r => ({ score: r.score, label: r.label }))}
              defaultPrompts={experienceDefaultPrompts}
            />
          </div>
        )}
      </Section>

      {/* Primary Rating Variable */}
      {(npsEnabled || experienceEnabled) && (
        <Section
          title="Primary rating variable"
          description="The score shown on study cards and at the top of analytics. Pick one."
        >
          <div className="flex flex-col gap-2">
            {npsEnabled && (
              <RatingVariableOption
                selected={c.ratingVariableId === 'nps'}
                onSelect={() => updateConfig({ ratingVariableId: 'nps', ratingVariableLabel: c.npsLabel || 'NPS' })}
                label={(c.npsLabel || 'NPS') + ' Score'}
                sublabel="1-5 recommendation scale"
                primaryColor={c.theme.primaryColor}
              />
            )}
            {experienceEnabled && (
              <RatingVariableOption
                selected={c.ratingVariableId === 'experience'}
                onSelect={() => updateConfig({ ratingVariableId: 'experience', ratingVariableLabel: 'Experience Rating' })}
                label="Experience Rating"
                sublabel="1-5 experience scale"
                primaryColor={c.theme.primaryColor}
              />
            )}
          </div>
          {!c.ratingVariableId && (
            <p className="text-xs text-red-400 mt-2 px-1">Select a primary rating variable to enable study card scoring.</p>
          )}
        </Section>
      )}

      <NavButtons onBack={onBack} onNext={onNext} nextDisabled={!canNext} nextLabel="Next: Conversation" />
    </div>
  )
}
