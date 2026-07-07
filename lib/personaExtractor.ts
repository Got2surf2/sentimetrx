// lib/personaExtractor.ts
// Extracts user persona from early conversation turns for agent style matching.
// Uses AI to identify life stage, occupation, location, concerns, and communication style.

import { callAI } from '@/lib/ai'
import { logUsage, type UsageContext } from '@/lib/usageLog'

// Usage attribution is passed per-call (was a mutable module-global, which
// misattributed cost across concurrent requests on Fluid Compute).

export interface PersonaField {
  value: string
  source: 'explicit' | 'inferred'
  confidence: 'high' | 'medium' | 'low'
}

export interface Persona {
  life_stage?: PersonaField
  occupation?: PersonaField
  industry?: PersonaField
  location_type?: PersonaField
  concerns?: { values: string[]; source: 'explicit' | 'inferred'; confidence: 'high' | 'medium' | 'low' }
  communication_style?: PersonaField
}

export interface Demographics {
  age_range?: PersonaField    // e.g. "18-24", "25-34", "35-44", "45-54", "55-64", "65+"
  gender?: PersonaField       // e.g. "male", "female", "non-binary"
  education?: PersonaField    // e.g. "high school", "some college", "bachelors", "graduate"
  socioeconomic?: PersonaField // e.g. "lower", "lower-middle", "middle", "upper-middle", "upper"
}

/**
 * Extract persona fields from user messages using a fast AI call.
 * Only extracts what the user actually shared — does NOT infer race, ethnicity, or income.
 */
export async function extractPersona(userMessages: string[], usageCtx?: UsageContext): Promise<Persona> {
  if (userMessages.length === 0) return {}

  var combined = userMessages.join('\n---\n')

  try {
    var result = await callAI({
      tier: 'fast',
      maxTokens: 300,
      timeoutMs: 5000,
      messages: [{ role: 'user', content: 'Extract persona from these user messages.' }],
      system: 'Analyze these user messages and extract persona fields. Return ONLY valid JSON.\n\n' +
        'User messages:\n"' + combined + '"\n\n' +
        'Extract ONLY fields the user explicitly mentioned or strongly implied. For each field, set source to "explicit" if they directly stated it, or "inferred" if you deduced it from context. Set confidence to "high", "medium", or "low".\n\n' +
        'Fields to extract (omit if no evidence):\n' +
        '- life_stage: e.g., "student", "young professional", "working parent", "retiree", "stay-at-home parent"\n' +
        '- occupation: their job/role if mentioned\n' +
        '- industry: their field/sector if mentioned\n' +
        '- location_type: "urban", "suburban", "rural" if mentioned or implied\n' +
        '- concerns: array of topics/issues they care about\n' +
        '- communication_style: "casual", "formal", "technical", "conversational" — based on how they write\n\n' +
        'Do NOT infer race, ethnicity, gender, age, or income unless explicitly stated.\n' +
        'communication_style should always be inferred from writing patterns.\n\n' +
        'Return format:\n' +
        '{"life_stage":{"value":"...","source":"explicit","confidence":"high"},"concerns":{"values":["..."],"source":"explicit","confidence":"high"},...}\n\n' +
        'ONLY output the JSON object. No explanation.',
    })

    if (usageCtx) logUsage({ ...usageCtx, event_type: 'persona' }, result.usage)
    var text = (result.text || '').trim()
    // Extract JSON from response (handle markdown code blocks)
    var jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return {}

    var parsed = JSON.parse(jsonMatch[0]) as Persona
    return parsed
  } catch {
    return {}
  }
}

/**
 * Merge a new persona extraction into an existing one.
 * New explicit fields override existing inferred ones.
 * Confidence can only upgrade, never downgrade.
 */
export function mergePersona(existing: Persona, update: Persona): Persona {
  var merged = { ...existing }
  type SimplePersonaKey = 'life_stage' | 'occupation' | 'industry' | 'location_type' | 'communication_style'
  var simpleFields: SimplePersonaKey[] = ['life_stage', 'occupation', 'industry', 'location_type', 'communication_style']

  for (var i = 0; i < simpleFields.length; i++) {
    var key = simpleFields[i]
    var newVal = update[key]
    var oldVal = merged[key]
    if (!newVal) continue
    if (!oldVal) {
      merged[key] = newVal
    } else if (newVal.source === 'explicit' && oldVal.source === 'inferred') {
      merged[key] = newVal
    } else if (confRank(newVal.confidence) > confRank(oldVal.confidence)) {
      merged[key] = newVal
    }
  }

  // Merge concerns (union of values)
  if (update.concerns && update.concerns.values.length > 0) {
    if (!merged.concerns) {
      merged.concerns = update.concerns
    } else {
      var existing_values = merged.concerns.values
      var new_values = update.concerns.values.filter(function(v) {
        return !existing_values.some(function(e) { return e.toLowerCase() === v.toLowerCase() })
      })
      merged.concerns = {
        values: [...existing_values, ...new_values],
        source: update.concerns.source === 'explicit' ? 'explicit' : merged.concerns.source,
        confidence: confRank(update.concerns.confidence) > confRank(merged.concerns.confidence) ? update.concerns.confidence : merged.concerns.confidence,
      }
    }
  }

  return merged
}

/**
 * Convert persona into a short prompt injection for style matching.
 */
export function personaToPromptContext(persona: Persona): string {
  var parts: string[] = []

  if (persona.life_stage) parts.push('Life stage: ' + persona.life_stage.value)
  if (persona.occupation) parts.push('Occupation: ' + persona.occupation.value)
  if (persona.industry) parts.push('Industry: ' + persona.industry.value)
  if (persona.location_type) parts.push('Location: ' + persona.location_type.value)
  if (persona.concerns && persona.concerns.values.length > 0) parts.push('Key concerns: ' + persona.concerns.values.join(', '))
  if (persona.communication_style) parts.push('Communication style: ' + persona.communication_style.value)

  if (parts.length === 0) return ''

  return '\n\nUSER PROFILE (adapt your tone and examples accordingly):\n' + parts.join('\n') +
    '\n\nMatch their communication style — if they\'re casual, be casual. If they\'re technical, use precise language. Tailor examples and analogies to their life stage and concerns.'
}

/**
 * Extract demographic estimates from user messages.
 * Only runs when demographic_inference is enabled on the bot.
 * Designed to piggyback on existing AI calls — lightweight prompt, fast tier.
 */
export async function extractDemographics(userMessages: string[], usageCtx?: UsageContext): Promise<Demographics> {
  if (userMessages.length < 3) return {} // need enough signal

  var combined = userMessages.join('\n---\n')

  try {
    var result = await callAI({
      tier: 'fast',
      maxTokens: 200,
      timeoutMs: 5000,
      messages: [{ role: 'user', content: 'Estimate demographics from these user messages.' }],
      system: 'Analyze these user messages and estimate demographic attributes. Return ONLY valid JSON.\n\n' +
        'User messages:\n"' + combined + '"\n\n' +
        'Estimate ONLY fields you have reasonable evidence for. For each field, set source to "explicit" if they directly stated it, or "inferred" if you deduced it from writing style, vocabulary, references, or context. Set confidence to "high", "medium", or "low".\n\n' +
        'Fields to estimate (omit if insufficient evidence):\n' +
        '- age_range: "18-24", "25-34", "35-44", "45-54", "55-64", or "65+"\n' +
        '- gender: "male", "female", or "non-binary"\n' +
        '- education: "high school", "some college", "bachelors", or "graduate"\n' +
        '- socioeconomic: "lower", "lower-middle", "middle", "upper-middle", or "upper"\n\n' +
        'Use writing style, vocabulary complexity, cultural references, topics discussed, and any explicit mentions as signals.\n' +
        'Be conservative — only include a field if you have meaningful evidence. Prefer "medium" or "low" confidence for inferred fields.\n\n' +
        'Return format:\n' +
        '{"age_range":{"value":"25-34","source":"inferred","confidence":"medium"},...}\n\n' +
        'ONLY output the JSON object. No explanation.',
    })

    if (usageCtx) logUsage({ ...usageCtx, event_type: 'demographics' }, result.usage)
    var text = (result.text || '').trim()
    var jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return {}

    return JSON.parse(jsonMatch[0]) as Demographics
  } catch {
    return {}
  }
}

/**
 * Merge new demographic estimates into existing ones.
 * Same logic as mergePersona — explicit overrides inferred, confidence only upgrades.
 */
export function mergeDemographics(existing: Demographics, update: Demographics): Demographics {
  var merged = { ...existing }
  var fields: (keyof Demographics)[] = ['age_range', 'gender', 'education', 'socioeconomic']

  for (var i = 0; i < fields.length; i++) {
    var key = fields[i]
    var newVal = update[key]
    var oldVal = merged[key]
    if (!newVal) continue
    if (!oldVal) {
      merged[key] = newVal
    } else if (newVal.source === 'explicit' && oldVal.source === 'inferred') {
      merged[key] = newVal
    } else if (confRank(newVal.confidence) > confRank(oldVal.confidence)) {
      merged[key] = newVal
    }
  }

  return merged
}

/**
 * Convert demographics into a short prompt context string.
 */
export function demographicsToPromptContext(demographics: Demographics): string {
  var parts: string[] = []
  if (demographics.age_range) parts.push('Age range: ' + demographics.age_range.value)
  if (demographics.gender) parts.push('Gender: ' + demographics.gender.value)
  if (demographics.education) parts.push('Education: ' + demographics.education.value)
  if (demographics.socioeconomic) parts.push('Socioeconomic: ' + demographics.socioeconomic.value)

  if (parts.length === 0) return ''
  return '\n\nESTIMATED DEMOGRAPHICS (use to tailor examples and tone):\n' + parts.join('\n')
}

function confRank(c: string): number {
  if (c === 'high') return 3
  if (c === 'medium') return 2
  return 1
}
