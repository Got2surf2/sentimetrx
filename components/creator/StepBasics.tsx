'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { StepProps } from '@/lib/studyDraft'
import { Input, Section, NavButtons } from './CreatorUI'
import { INDUSTRY_LABELS, INDUSTRY_DEFAULTS, INDUSTRY_EMOJI_SETS, type Industry } from '@/lib/industryDefaults'
import { SUPPORTED_LANGUAGES } from '@/lib/types'
import EmojiPickerPopover from './EmojiPickerPopover'

const HERMES = '#E8632A'


// ── Color presets ─────────────────────────────────────────────
const PRESETS = [
  { name: 'Ocean',  primary: '#00b4d8', gradient: 'linear-gradient(135deg,#00b4d8,#0077a8)', accent: '#00d4ff' },
  { name: 'Forest', primary: '#1a7a4a', gradient: 'linear-gradient(135deg,#1a7a4a,#0d4a2a)', accent: '#4ade80' },
  { name: 'Sunset', primary: '#e85d04', gradient: 'linear-gradient(135deg,#e85d04,#9d0208)', accent: '#ffba08' },
  { name: 'Violet', primary: '#7c3aed', gradient: 'linear-gradient(135deg,#7c3aed,#4c1d95)', accent: '#a78bfa' },
  { name: 'Rose',   primary: '#e11d48', gradient: 'linear-gradient(135deg,#e11d48,#9f1239)', accent: '#fb7185' },
  { name: 'Slate',  primary: '#475569', gradient: 'linear-gradient(135deg,#475569,#1e293b)', accent: '#94a3b8' },
  { name: 'Gold',   primary: '#d97706', gradient: 'linear-gradient(135deg,#d97706,#92400e)', accent: '#fbbf24' },
]


// ── Main ──────────────────────────────────────────────────────
interface Props extends StepProps { onNext: () => void; onTranslatingChange?: (v: boolean) => void }

export default function StepBasics({ draft, update, updateConfig, onNext, onTranslatingChange }: Props) {
  const theme   = draft.config.theme
  const canNext = draft.name.trim() && draft.bot_name.trim()
  const presetIndustry = (draft.config.industry || (draft as any).industry || '') as Industry | ''
  const [industry,      setIndustry]      = useState<Industry>(presetIndustry || '' as Industry)
  const [otherIndustry, setOtherIndustry] = useState(draft.config.otherIndustry || (draft as any).otherIndustry || '')
  const [applied,       setApplied]       = useState(!!presetIndustry)
  const isEditing = !!presetIndustry   // true when editing an existing study

  // ── Slug (custom URL) ──────────────────────────────────────
  const [slugInput,    setSlugInput]    = useState(draft.slug || '')
  const [slugStatus,   setSlugStatus]   = useState<'idle' | 'checking' | 'available' | 'taken' | 'invalid'>('idle')
  const slugTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)

  const checkSlug = useCallback((val: string) => {
    if (slugTimer.current) clearTimeout(slugTimer.current)
    const clean = val.toLowerCase().trim()
    if (!clean) { setSlugStatus('idle'); return }
    if (clean.length < 3 || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(clean)) {
      setSlugStatus('invalid'); return
    }
    setSlugStatus('checking')
    slugTimer.current = setTimeout(async () => {
      try {
        const studyId = draft.id || ''
        const res = await fetch(`/api/studies/check-slug?slug=${encodeURIComponent(clean)}&exclude=${studyId}`)
        const data = await res.json()
        setSlugStatus(data.available ? 'available' : 'taken')
      } catch { setSlugStatus('idle') }
    }, 400)
  }, [draft])

  const handleSlugChange = (val: string) => {
    const clean = slugify(val)
    setSlugInput(clean)
    update({ slug: clean || undefined })
    checkSlug(clean)
  }

  const handleSlugBlur = () => {
    // Auto-suggest from study name if empty
    if (!slugInput && draft.name.trim()) {
      const suggested = slugify(draft.name)
      if (suggested.length >= 3) {
        setSlugInput(suggested)
        update({ slug: suggested })
        checkSlug(suggested)
      }
    }
  }

  const inputCls = 'w-full px-4 py-2.5 rounded-xl text-sm text-gray-800 placeholder-gray-400 bg-white border border-gray-300 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-colors'

  function applyPreset(p: typeof PRESETS[0]) {
    updateConfig({
      theme: { ...theme, primaryColor: p.primary, headerGradient: p.gradient, accentColor: p.accent, botAvatarGradient: p.gradient }
    })
  }

  function applyIndustryDefaults() {
    if (!industry || industry === 'other') return
    const defaults = INDUSTRY_DEFAULTS[industry as Exclude<Industry, 'other'>]
    updateConfig({ ...defaults, industry, otherIndustry })
    setApplied(true)
  }

  function handleIndustrySelect(val: Industry) {
    setIndustry(val)
    setApplied(false)
    // Save selection immediately into config so it persists even without applying defaults
    updateConfig({ industry: val })
  }

  function handleBotNameChange(v: string) {
    const oldName = draft.bot_name
    update({ bot_name: v })
    if (oldName && draft.config.greeting.includes(oldName)) {
      updateConfig({ greeting: draft.config.greeting.replaceAll(oldName, v) })
    }
  }

  function handleEmojiSelect(e: string) {
    const oldEmoji = draft.bot_emoji
    update({ bot_emoji: e })
    if (oldEmoji && draft.config.greeting.includes(oldEmoji)) {
      updateConfig({ greeting: draft.config.greeting.replaceAll(oldEmoji, e) })
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-bold text-gray-800 mb-1">Study basics</h2>
        <p className="text-gray-500 text-sm">Name your study, choose an industry, and set up your bot.</p>
      </div>

      {/* Industry */}
      <Section title="Industry" description="Select your industry and we'll pre-fill sensible defaults for all prompts, adaptive follow-ups, and psychographic questions. You can edit everything afterwards.">
        {/* Show badge when industry is already set (editing existing study) */}
        {applied && industry && industry !== 'other' && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 rounded-xl px-4 py-2.5">
              <span className="text-orange-500 font-bold text-sm">✦</span>
              <span className="text-sm font-semibold text-gray-800">{INDUSTRY_LABELS[industry as Industry]}</span>
              <span className="text-xs text-orange-500 bg-orange-100 px-2 py-0.5 rounded-full">Industry set</span>
            </div>
            <button
              type="button"
              onClick={() => setApplied(false)}
              className="text-xs text-gray-400 hover:text-gray-600 underline transition-colors"
            >
              Change industry
            </button>
          </div>
        )}

        {/* Industry selector — shown when not yet set or changing */}
        {!applied && isEditing && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
            <span className="text-amber-500 text-sm">⚠</span>
            <span className="text-xs text-amber-700 font-medium">Changing industry and re-applying defaults will overwrite your current prompts and questions.</span>
          </div>
        )}
        {!applied && (
          <>
            <select value={industry} onChange={e => handleIndustrySelect(e.target.value as Industry)} className={inputCls}>
              <option value="">— Select an industry —</option>
              {(Object.keys(INDUSTRY_LABELS) as Industry[]).sort((a, b) => INDUSTRY_LABELS[a].localeCompare(INDUSTRY_LABELS[b])).map(k => (
                <option key={k} value={k}>{INDUSTRY_LABELS[k]}</option>
              ))}
            </select>
            {industry === 'other' && (
              <input type="text" value={otherIndustry} onChange={e => setOtherIndustry(e.target.value)}
                placeholder="Describe your industry or context…" className={inputCls} />
            )}
            {industry && industry !== 'other' && (
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={applyIndustryDefaults}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all"
                  style={{ background: HERMES }}>
                  ✦ Apply industry defaults
                </button>
                <p className="text-xs text-gray-400">Pre-fills all prompts, follow-ups &amp; psychographic questions for {INDUSTRY_LABELS[industry as Industry]}</p>
              </div>
            )}
          </>
        )}
      </Section>

      {/* Study name */}
      <Section title="Study name">
        <Input value={draft.name} onChange={v => update({ name: v })}
          placeholder="e.g. Q2 Patient Satisfaction Study"
          hint="Internal name — respondents don't see this" />
      </Section>

      {/* Custom URL */}
      <Section title="Custom survey URL" description="Give your survey a short, memorable link. Leave blank to use the default.">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-0 rounded-xl border border-gray-300 overflow-hidden bg-white focus-within:border-orange-400 focus-within:ring-2 focus-within:ring-orange-100 transition-all">
            <span className="px-3 py-2.5 text-sm text-gray-400 bg-gray-50 border-r border-gray-200 whitespace-nowrap flex-shrink-0">sentimetrx.ai/s/</span>
            <input
              value={slugInput}
              onChange={e => handleSlugChange(e.target.value)}
              onBlur={handleSlugBlur}
              placeholder="your-survey-name"
              className="flex-1 px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 outline-none bg-transparent min-w-0"
              spellCheck={false}
              autoComplete="off"
            />
            {slugStatus === 'checking' && <span className="px-3 text-gray-400 text-xs animate-pulse">checking...</span>}
            {slugStatus === 'available' && <span className="px-3 text-green-500 text-sm font-bold">{'\u2713'}</span>}
            {slugStatus === 'taken' && <span className="px-3 text-red-500 text-xs font-semibold">taken</span>}
            {slugStatus === 'invalid' && <span className="px-3 text-amber-500 text-xs font-semibold">3+ chars</span>}
          </div>
          {slugInput && slugStatus === 'available' && (
            <p className="text-xs text-green-600">
              {'\u2713'} Your survey will be available at <strong>sentimetrx.ai/s/{slugInput}</strong>
            </p>
          )}
          {!slugInput && (
            <p className="text-xs text-gray-400">The default UUID link will always work too.</p>
          )}
        </div>
      </Section>

      {/* Bot identity */}
      <Section title="Bot name & emoji">
        <div className="flex gap-3 items-center">
          <Input value={draft.bot_name} onChange={handleBotNameChange} placeholder="e.g. Aria" className="flex-1" />
          <EmojiPickerPopover
            value={draft.bot_emoji || '💬'}
            onChange={handleEmojiSelect}
            industryEmojis={industry && industry !== 'other' ? (INDUSTRY_EMOJI_SETS[industry] || undefined) : undefined}
            industryLabel={industry && industry !== 'other' ? (INDUSTRY_LABELS[industry as Industry] || undefined) : undefined}
            size="md"
          />
        </div>
        <p className="text-gray-400 text-xs">The name and emoji respondents see in the chat.</p>
      </Section>

      {/* Header text */}
      <Section title="Header text" description="Customize the subtitle and status text shown in the survey header bar.">
        <div className="flex flex-col gap-2">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Subtitle (below bot name)</label>
            <Input
              value={draft.config.headerSubtitle || ''}
              onChange={v => updateConfig({ headerSubtitle: v })}
              placeholder={draft.name || 'Study name (default)'}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Status line (with green dot)</label>
            <Input
              value={draft.config.headerStatus || ''}
              onChange={v => updateConfig({ headerStatus: v })}
              placeholder="Ready for your feedback"
            />
          </div>
        </div>
      </Section>

      {/* Color theme */}
      <Section title="Color theme">
        <div className="grid grid-cols-4 gap-2 mb-3">
          {PRESETS.map(p => (
            <button key={p.name} onClick={() => applyPreset(p)}
              className={'rounded-xl p-3 text-center transition-all border-2 ' + (theme.primaryColor === p.primary ? 'border-white/70 shadow-md' : 'border-transparent hover:border-white/30')}
              style={{ background: p.gradient }}>
              <span className="text-white text-xs font-semibold drop-shadow">{p.name}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3">
          <span className="text-gray-700 text-sm font-semibold flex-1">Custom primary color</span>
          <span className="text-gray-400 text-xs font-mono">{theme.primaryColor || '#000000'}</span>
          <input type="color" value={theme.primaryColor || '#00b4d8'}
            onChange={e => {
              const c = e.target.value
              updateConfig({ theme: { ...theme, primaryColor: c, headerGradient: `linear-gradient(135deg,${c},${c}cc)`, accentColor: c, botAvatarGradient: `linear-gradient(135deg,${c},${c}cc)` } })
            }}
            className="w-10 h-10 rounded-lg cursor-pointer border border-gray-300 bg-white p-0.5" />
        </div>
      </Section>

      <Section title="Response limits" description="Control whether respondents can submit more than once from the same device.">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => updateConfig({ allowMultipleResponses: draft.config.allowMultipleResponses === false ? true : false })}
            className={`relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 border-2 border-transparent ${draft.config.allowMultipleResponses === false ? 'bg-orange-500' : 'bg-gray-200'}`}
          >
            <span className={`inline-block w-5 h-5 bg-white rounded-full shadow-md transition-transform transform ${draft.config.allowMultipleResponses === false ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
          <span className="text-sm text-gray-600">
            {draft.config.allowMultipleResponses === false
              ? <><strong className="text-gray-800">One response per device</strong> — prevents duplicate submissions</>
              : <><strong className="text-gray-800">Multiple responses allowed</strong> — same device can submit again</>}
          </span>
        </div>
      </Section>

      <Section title="Response capture" description="How single-choice, likert, and rating questions are recorded.">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => updateConfig({ confirmBeforeRecord: draft.config.confirmBeforeRecord === true ? false : true })}
            className={`relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 border-2 border-transparent ${!draft.config.confirmBeforeRecord ? 'bg-orange-500' : 'bg-gray-200'}`}
          >
            <span className={`inline-block w-5 h-5 bg-white rounded-full shadow-md transition-transform transform ${!draft.config.confirmBeforeRecord ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
          <span className="text-sm text-gray-600">
            {!draft.config.confirmBeforeRecord
              ? <><strong className="text-gray-800">Instant capture</strong> — single tap records the answer immediately</>
              : <><strong className="text-gray-800">Tap then confirm</strong> — respondent selects an option, then presses Confirm</>}
          </span>
        </div>
      </Section>

      <Section title="Testing mode" description="Show AI reasoning inline during the conversation — for testing only, disable before publishing.">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => updateConfig({ testing: !draft.config.testing })}
            className={`relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 border-2 border-transparent ${draft.config.testing ? 'bg-orange-500' : 'bg-gray-200'}`}
          >
            <span className={`inline-block w-5 h-5 bg-white rounded-full shadow-md transition-transform transform ${draft.config.testing ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
          <span className="text-sm text-gray-600">
            {draft.config.testing
              ? <><strong className="text-gray-800">Testing ON</strong> — AI thinking panels shown inline (yellow boxes)</>
              : <><strong className="text-gray-800">Testing OFF</strong> — normal participant experience</>}
          </span>
        </div>
        <div className="mt-4">
          <label className="text-sm font-medium text-gray-700 block mb-1">Debug password <span className="text-xs text-gray-400 font-normal">— anyone can activate verbose mode by typing <code className="bg-gray-100 px-1 rounded">#debug PASSWORD</code> in the chat or adding <code className="bg-gray-100 px-1 rounded">?debug=PASSWORD</code> to the URL</span></label>
          <input type="text" value={draft.config.debugPassword || ''} onChange={e => updateConfig({ debugPassword: e.target.value || undefined })}
            placeholder="e.g. showme123"
            className="w-64 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400" />
        </div>
      </Section>

      <Section title="Branding" description="Control the 'by' label shown in the survey header.">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => updateConfig({ showBranding: draft.config.showBranding === false ? true : false })}
            className={`relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 border-2 border-transparent ${draft.config.showBranding !== false ? 'bg-orange-500' : 'bg-gray-200'}`}
          >
            <span className={`inline-block w-5 h-5 bg-white rounded-full shadow-md transition-transform transform ${draft.config.showBranding !== false ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
          <span className="text-sm text-gray-600">
            {draft.config.showBranding !== false
              ? <><strong className="text-gray-800">Branding visible</strong> — shows &ldquo;by {draft.config.brandingLabel || 'DATANAUTIX'}&rdquo; in header</>
              : <><strong className="text-gray-800">Branding hidden</strong></>}
          </span>
        </div>
        {draft.config.showBranding !== false && (
          <div className="flex flex-col gap-1.5 mt-2">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Label (max 15 characters)</label>
            <input
              value={draft.config.brandingLabel ?? 'DATANAUTIX'}
              onChange={e => updateConfig({ brandingLabel: e.target.value.slice(0, 15) })}
              placeholder="DATANAUTIX"
              maxLength={15}
              className="w-full max-w-xs px-3 py-2 rounded-lg bg-white border border-gray-300 text-gray-800 text-sm placeholder-gray-400 outline-none focus:border-orange-400 transition-colors"
            />
          </div>
        )}
      </Section>

      <Section title="Survey font size" description="Set the base text size for respondents. Larger sizes improve readability for older audiences.">
        <div className="flex items-center gap-2 flex-wrap">
          {[
            { value: 14, label: 'Small', desc: '14px' },
            { value: 16, label: 'Normal', desc: '16px' },
            { value: 18, label: 'Large', desc: '18px — default' },
            { value: 20, label: 'X-Large', desc: '20px' },
            { value: 22, label: 'XX-Large', desc: '22px' },
          ].map(function(opt) {
            var current = draft.config.surveyFontSize || 18
            var active = current === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={function() { updateConfig({ surveyFontSize: opt.value }) }}
                className="flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl transition-all"
                style={{
                  background: active ? '#fff4ef' : '#f9fafb',
                  border: '1.5px solid ' + (active ? '#e8622a' : '#e5e7eb'),
                  cursor: 'pointer',
                  minWidth: 64,
                }}
              >
                <span className="font-bold" style={{ fontSize: opt.value, lineHeight: 1.2, color: active ? '#e8622a' : '#374151' }}>Aa</span>
                <span className="text-xs" style={{ color: active ? '#e8622a' : '#6b7280', fontWeight: active ? 600 : 400 }}>{opt.label}</span>
              </button>
            )
          })}
        </div>
        <p className="text-xs text-gray-400 mt-1">
          Preview: all survey text will render at {draft.config.surveyFontSize || 18}px base size
        </p>
      </Section>

      {/* Typing animation speed */}
      <Section title="Typing Animation Duration" description="How long the typing indicator bubble shows between bot messages.">
        <div className="flex gap-2 flex-wrap">
          {[
            { value: 0.25, label: '0.25s', desc: 'Minimal' },
            { value: 0.5,  label: '0.5s',  desc: 'Default' },
            { value: 1.0,  label: '1s',    desc: 'Deliberate' },
            { value: 1.5,  label: '1.5s',  desc: 'Relaxed' },
            { value: 2.0,  label: '2s',    desc: 'Slow' },
          ].map(function(opt) {
            var current = draft.config.typingSpeed ?? 0.5
            var active = current === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={function() { updateConfig({ typingSpeed: opt.value }) }}
                className="flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl transition-all"
                style={{
                  background: active ? '#fff4ef' : '#f9fafb',
                  border: '1.5px solid ' + (active ? '#e8622a' : '#e5e7eb'),
                  cursor: 'pointer',
                  minWidth: 64,
                }}
              >
                <span className="font-bold text-sm" style={{ color: active ? '#e8622a' : '#374151' }}>{opt.label}</span>
                <span className="text-xs" style={{ color: active ? '#e8622a' : '#6b7280', fontWeight: active ? 600 : 400 }}>{opt.desc}</span>
              </button>
            )
          })}
        </div>
      </Section>

      {/* Multi-language */}
      <LanguageSection draft={draft} updateConfig={updateConfig} onTranslatingChange={onTranslatingChange} />

      <NavButtons onNext={onNext} nextDisabled={!canNext} nextLabel="Next: Opening" />
    </div>
  )
}

// ── Language picker + translate ──────────────────────────────
function LanguageSection({ draft, updateConfig, onTranslatingChange }: Pick<Props, 'draft' | 'updateConfig' | 'onTranslatingChange'>) {
  const langs = draft.config.languages || ['en']
  const [translating, setTranslating] = useState<string | null>(null)
  const [error, setError]             = useState<string | null>(null)

  // Notify parent when translating state changes
  useEffect(() => { onTranslatingChange?.(translating !== null) }, [translating, onTranslatingChange])

  function toggleLang(code: string) {
    if (code === 'en') return // English is always enabled
    const wasEnabled = langs.includes(code)
    const next = wasEnabled ? langs.filter(c => c !== code) : [...langs, code]
    // Remove translations for unchecked languages
    const translations = { ...(draft.config.translations || {}) }
    for (const k of Object.keys(translations)) { if (!next.includes(k)) delete translations[k] }
    const updatedConfig = { ...draft.config, languages: next, translations }
    updateConfig({ languages: next, translations })
    // Auto-translate when adding a new language
    if (!wasEnabled) translateLang(code, updatedConfig)
  }

  async function translateLang(code: string, configOverride?: typeof draft.config) {
    const lang = SUPPORTED_LANGUAGES.find(l => l.code === code)
    if (!lang) return
    setTranslating(code)
    setError(null)
    try {
      const cfgToUse = configOverride || draft.config
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: cfgToUse,
          targetLanguage: code,
          targetLanguageName: lang.name,
        }),
        signal: AbortSignal.timeout(35000),
      })
      if (!res.ok) throw new Error('Translation failed — please try again')
      const data = await res.json()
      const translations = { ...(cfgToUse.translations || {}), [code]: data.translation }
      updateConfig({ translations })
    } catch (err: any) {
      if (err.name === 'TimeoutError') {
        setError('Translation timed out — try clicking Translate again')
      } else {
        setError(err.message || 'Translation failed')
      }
    } finally {
      setTranslating(null)
    }
  }

  function isTranslationStale(code: string): boolean {
    const trans = draft.config.translations?.[code]
    if (!trans) return true
    const psychoKeys = (draft.config.psychographicBank || []).map(p => p.key)
    const questionIds = (draft.config.questions || []).filter(q => q.enabled !== false && q.type !== 'hidden').map(q => q.id)
    if (psychoKeys.length > 0 && psychoKeys.some(k => !trans.psychographics?.[k])) return true
    if (questionIds.length > 0 && questionIds.some(id => !trans.questions?.[id])) return true
    return false
  }

  async function translateAll() {
    const toTranslate = langs.filter(c => c !== 'en' && (!draft.config.translations?.[c] || isTranslationStale(c)))
    for (const code of toTranslate) {
      await translateLang(code)
    }
  }

  const nonEnLangs = langs.filter(c => c !== 'en')
  const untranslated = nonEnLangs.filter(c => !draft.config.translations?.[c] || isTranslationStale(c))

  return (
    <Section title="Languages" description="Enable multiple languages. Respondents choose their language before starting the survey. Translations are AI-generated from your English content.">
      <div className="flex flex-wrap gap-2">
        {SUPPORTED_LANGUAGES.map(lang => {
          const checked = langs.includes(lang.code)
          const isEn = lang.code === 'en'
          return (
            <button
              key={lang.code}
              type="button"
              onClick={() => toggleLang(lang.code)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-all"
              style={{
                background: checked ? '#fff4ef' : '#f9fafb',
                border: '1.5px solid ' + (checked ? '#e8622a' : '#e5e7eb'),
                cursor: isEn ? 'default' : 'pointer',
                opacity: isEn ? 0.7 : 1,
              }}
              disabled={isEn}
            >
              <span className="w-4 h-4 rounded border flex items-center justify-center text-[10px] flex-shrink-0"
                style={{
                  borderColor: checked ? '#e8622a' : '#d1d5db',
                  background: checked ? '#e8622a' : 'white',
                  color: checked ? 'white' : 'transparent',
                }}>
                {checked ? '✓' : ''}
              </span>
              <span style={{ color: checked ? '#e8622a' : '#6b7280', fontWeight: checked ? 600 : 400 }}>
                {lang.nativeName}
              </span>
              <span className="text-xs" style={{ color: '#9ca3af' }}>
                {lang.name !== lang.nativeName ? lang.name : ''}
              </span>
            </button>
          )
        })}
      </div>

      {/* Translate controls */}
      {nonEnLangs.length > 0 && (
        <div className="flex flex-col gap-2 mt-2">
          <div className="flex items-center gap-2 flex-wrap">
            {nonEnLangs.map(code => {
              const lang = SUPPORTED_LANGUAGES.find(l => l.code === code)
              const trans = draft.config.translations?.[code]
              const hasTranslation = !!trans
              // Check if translation is stale (missing psychographics or questions that exist in config)
              const psychoKeys = (draft.config.psychographicBank || []).map(p => p.key)
              const questionIds = (draft.config.questions || []).filter(q => q.enabled !== false && q.type !== 'hidden').map(q => q.id)
              const missingPsycho = hasTranslation && psychoKeys.length > 0 && psychoKeys.some(k => !trans?.psychographics?.[k])
              const missingQuestions = hasTranslation && questionIds.length > 0 && questionIds.some(id => !trans?.questions?.[id])
              const isStale = missingPsycho || missingQuestions
              return (
                <div key={code} className="flex items-center gap-1.5 bg-white border border-gray-200 rounded-lg px-3 py-1.5">
                  <span className="text-sm font-medium text-gray-700">{lang?.nativeName || code}</span>
                  {hasTranslation && !isStale ? (
                    <span className="text-green-500 text-xs font-bold">✓</span>
                  ) : hasTranslation && isStale ? (
                    <span className="text-amber-500 text-xs font-bold" title="Translation is incomplete — click Redo">!</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => translateLang(code)}
                      disabled={translating !== null}
                      className="text-xs font-semibold px-2 py-0.5 rounded-full transition-all"
                      style={{ background: '#e8622a', color: 'white', opacity: translating ? 0.5 : 1 }}
                    >
                      {translating === code ? 'Translating...' : 'Translate'}
                    </button>
                  )}
                  {hasTranslation && (
                    <button
                      type="button"
                      onClick={() => translateLang(code)}
                      disabled={translating !== null}
                      className={'text-xs underline ' + (isStale ? 'text-amber-500 hover:text-amber-600 font-semibold' : 'text-gray-400 hover:text-gray-600')}
                    >
                      {translating === code ? '...' : isStale ? 'Redo (incomplete)' : 'Redo'}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          {untranslated.length > 1 && (
            <button
              type="button"
              onClick={translateAll}
              disabled={translating !== null}
              className="self-start px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all"
              style={{ background: translating ? '#ccc' : '#e8622a' }}
            >
              {translating ? 'Translating...' : `Translate all (${untranslated.length})`}
            </button>
          )}
          {error && <p className="text-xs text-red-500">{error}</p>}

          {/* Auto-translate responses toggle */}
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-100">
            <button
              type="button"
              onClick={() => updateConfig({ autoTranslateResponses: !draft.config.autoTranslateResponses })}
              className={`relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 border-2 border-transparent ${draft.config.autoTranslateResponses ? 'bg-orange-500' : 'bg-gray-200'}`}
            >
              <span className={`inline-block w-5 h-5 bg-white rounded-full shadow-md transition-transform transform ${draft.config.autoTranslateResponses ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
            <span className="text-sm text-gray-600">
              {draft.config.autoTranslateResponses
                ? <><strong className="text-gray-800">Auto-translate responses</strong> — non-English answers are translated to English on submission (originals preserved)</>
                : <><strong className="text-gray-800">Keep original language</strong> — responses are saved as-is in the respondent&apos;s language</>}
            </span>
          </div>
        </div>
      )}
    </Section>
  )
}
