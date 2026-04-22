import type { StudyConfig } from './types'
import type { Industry } from './industryDefaults'
import { SUPPORTED_LANGUAGES } from './types'

export interface StudyDraft {
  id?:            string           // set when editing an existing study
  name:           string
  bot_name:       string
  bot_emoji:      string
  slug?:          string           // custom URL slug — e.g. 'acme-feedback-2026'
  config:         StudyConfig
  industry?:      Industry
  otherIndustry?: string
}

export interface StepProps {
  draft:        StudyDraft
  update:       (partial: Partial<StudyDraft>) => void
  updateConfig: (partial: Partial<StudyConfig>) => void
}

/**
 * Compute a fingerprint of all translatable English content in the config.
 * Any change to prompts, options, psychographics, questions, etc. changes the hash.
 */
export function computeSourceHash(config: StudyConfig): string {
  const parts: string[] = []
  // Core prompts
  for (const k of ['greeting', 'q3', 'q4', 'promoterQ1', 'passiveQ1', 'detractorQ1', 'ratingPrompt', 'npsPrompt', 'closingMessage', 'closingCard', 'readyPrompt', 'readyYes', 'readyNo'] as const) {
    if ((config as any)[k]) parts.push(k + ':' + (config as any)[k])
  }
  // Rating scale labels
  for (const r of (config.ratingScale || [])) { if (r.label) parts.push('rs:' + r.label) }
  // Questions
  for (const q of (config.questions || [])) {
    if (q.enabled === false || q.type === 'hidden') continue
    parts.push('q:' + q.id + ':' + q.prompt)
    if (q.options) parts.push('qo:' + q.options.join('|'))
    if (q.likertScale) parts.push('ql:' + q.likertScale.map((s: any) => s.label).join('|'))
  }
  // Psychographics
  for (const p of (config.psychographicBank || [])) {
    parts.push('p:' + p.key + ':' + p.q + ':' + p.opts.join('|'))
  }
  // Follow-ups
  for (const k of ['experienceFollowUp', 'npsFollowUp'] as const) {
    const fu = (config as any)[k]
    if (fu?.enabled && fu.sharedPrompt) parts.push('fu:' + k + ':' + fu.sharedPrompt)
  }
  // Demo fields
  for (const df of (config.demoFields || [])) {
    if (!df.enabled) continue
    parts.push('d:' + df.key + ':' + df.label)
    if (df.options) parts.push('do:' + df.options.map((o: any) => o[1]).join('|'))
  }
  // Contact fields
  for (const cf of (config.contactFields || [])) {
    if (!cf.enabled) continue
    parts.push('c:' + cf.key + ':' + cf.label)
  }
  const str = parts.join('\n')
  let h = 0
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0 }
  return h.toString(36)
}

/**
 * Returns language codes that need (re-)translation.
 * A language is stale if it's missing entirely, has missing content,
 * or if the English source content has changed since translation.
 */
export function getStaleLanguages(config: StudyConfig): string[] {
  const langs = config.languages || ['en']
  const nonEn = langs.filter(c => c !== 'en')
  if (nonEn.length === 0) return []

  const currentHash = computeSourceHash(config)

  return nonEn.filter(code => {
    const trans = config.translations?.[code]
    if (!trans) return true
    // Check fingerprint — if source content changed, translation is stale
    if ((trans as any)._sourceHash !== currentHash) return true
    return false
  })
}

/**
 * Auto-translate all stale languages before publishing.
 * Returns updated translations object merged with existing translations.
 */
export async function autoTranslateStale(config: StudyConfig): Promise<Record<string, any> | null> {
  const stale = getStaleLanguages(config)
  if (stale.length === 0) return null

  const results = await Promise.all(stale.map(async code => {
    const lang = SUPPORTED_LANGUAGES.find(l => l.code === code)
    if (!lang) return null
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, targetLanguage: code, targetLanguageName: lang.name }),
        signal: AbortSignal.timeout(65000),
      })
      if (!res.ok) return null
      const data = await res.json()
      return { code, translation: { ...data.translation, _sourceHash: computeSourceHash(config) } }
    } catch {
      return null
    }
  }))

  const merged = { ...(config.translations || {}) }
  for (const r of results) {
    if (r) merged[r.code] = r.translation
  }
  return merged
}
