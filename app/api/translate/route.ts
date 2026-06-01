// app/api/translate/route.ts
// POST — translate study content to a target language using Claude

import { createClient, getAuthUser, createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import type { StudyTranslation } from '@/lib/types'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { config, targetLanguage, targetLanguageName, studyId } = body
  if (!config || !targetLanguage) return NextResponse.json({ error: 'config and targetLanguage required' }, { status: 400 })

  // Look up org_id from studies if studyId provided so usage rolls up under the study.
  let studyOrgId: string | undefined
  if (studyId && typeof studyId === 'string') {
    const { data: userRow } = await supabase
      .from('users').select('org_id').eq('id', user.id).single()
    if (userRow?.org_id) {
      const svc = createServiceRoleClient()
      const { data: studyRow } = await svc
        .from('studies').select('org_id').eq('id', studyId).eq('org_id', userRow.org_id).maybeSingle()
      if (studyRow?.org_id) studyOrgId = studyRow.org_id as string
    }
  }

  // Build content to translate
  const contentToTranslate: Record<string, string> = {}
  if (config.greeting) contentToTranslate.greeting = config.greeting
  if (config.q3) contentToTranslate.q3 = config.q3
  if (config.q4) contentToTranslate.q4 = config.q4
  if (config.promoterQ1) contentToTranslate.promoterQ1 = config.promoterQ1
  if (config.passiveQ1) contentToTranslate.passiveQ1 = config.passiveQ1
  if (config.detractorQ1) contentToTranslate.detractorQ1 = config.detractorQ1
  if (config.ratingPrompt) contentToTranslate.ratingPrompt = config.ratingPrompt
  if (config.npsPrompt) contentToTranslate.npsPrompt = config.npsPrompt
  if (config.closingMessage) contentToTranslate.closingMessage = config.closingMessage
  if (config.closingCard) contentToTranslate.closingCard = config.closingCard
  if (config.readyPrompt) contentToTranslate.readyPrompt = config.readyPrompt
  if (config.readyYes) contentToTranslate.readyYes = config.readyYes
  if (config.readyNo) contentToTranslate.readyNo = config.readyNo

  // Adaptive follow-up prompts (experience rating & NPS)
  const followUpsToTranslate: Record<string, any> = {}
  for (const key of ['experienceFollowUp', 'npsFollowUp'] as const) {
    const fu = config[key]
    if (!fu?.enabled) continue
    const entry: any = {}
    if (fu.sharedPrompt) entry.sharedPrompt = fu.sharedPrompt
    if (fu.perResponse) {
      entry.perResponse = {} as Record<string, string>
      for (const [score, pr] of Object.entries(fu.perResponse)) {
        if ((pr as any).prompt) entry.perResponse[score] = (pr as any).prompt
      }
    }
    followUpsToTranslate[key] = entry
  }

  // Custom question follow-ups
  for (const q of (config.questions || [])) {
    if (q.enabled === false || !q.followUp?.enabled) continue
    const entry: any = {}
    if (q.followUp.sharedPrompt) entry.sharedPrompt = q.followUp.sharedPrompt
    if (q.followUp.perResponse) {
      entry.perResponse = {} as Record<string, string>
      for (const [score, pr] of Object.entries(q.followUp.perResponse)) {
        if ((pr as any).prompt) entry.perResponse[score] = (pr as any).prompt
      }
    }
    followUpsToTranslate['question_' + q.id] = entry
  }

  // Opening flow open-end prompts
  const openingFlowToTranslate: Record<string, string> = {}
  for (const item of (config.openingFlow || [])) {
    if (item.type === 'open_end' && item.prompt) {
      openingFlowToTranslate[item.id] = item.prompt
    }
  }

  // Demographic field labels
  const demoLabelsToTranslate: Record<string, string> = {}
  const demoOptionsToTranslate: Record<string, string[]> = {}
  for (const df of (config.demoFields || [])) {
    if (!df.enabled) continue
    demoLabelsToTranslate[df.key] = df.label
    if (df.type === 'select' && df.options?.length) {
      demoOptionsToTranslate[df.key] = df.options.map((o: any) => o[1])
    }
  }

  // Contact field labels
  const contactLabelsToTranslate: Record<string, string> = {}
  for (const cf of (config.contactFields || [])) {
    if (!cf.enabled) continue
    contactLabelsToTranslate[cf.key] = cf.label
    if (cf.placeholder) contactLabelsToTranslate[cf.key + '_placeholder'] = cf.placeholder
  }
  if (config.contactTransition?.enabled !== false && config.contactTransition?.text) {
    contentToTranslate.contactTransition = config.contactTransition.text
  }

  // Custom questions
  const questionsToTranslate: Record<string, { prompt: string; options?: string[]; likertLabels?: string[] }> = {}
  for (const q of (config.questions || [])) {
    if (q.enabled === false || q.type === 'hidden') continue
    const entry: { prompt: string; options?: string[]; likertLabels?: string[] } = { prompt: q.prompt }
    if (q.options && q.options.length > 0) entry.options = q.options
    if (q.type === 'likert' && q.likertScale?.length) entry.likertLabels = q.likertScale.map((s: any) => s.label)
    questionsToTranslate[q.id] = entry
  }

  // Psychographics
  const psychoToTranslate: Record<string, { q: string; opts: string[] }> = {}
  for (const p of (config.psychographicBank || [])) {
    psychoToTranslate[p.key] = { q: p.q, opts: p.opts }
  }

  // UI chrome strings
  const uiStrings: Record<string, string> = {
    readyPrompt:    'Are you ready to share your feedback?',
    readyYes:       "Yes, let's go! 👍",
    readyNo:        'Not right now',
    thankYouAck:    'No problem at all -- thanks for your time! 😊',
    skip:           'Skip',
    done:           'Done',
    confirm:        'Confirm',
    allDone:        'All done!',
    selectOption:   'Select an option...',
    sharePlaceholder: 'Share your thoughts...',
    selectAtLeastOne: 'Select at least one',
    ackDecline1:    'No worries at all -- thanks for being honest.',
    ackDecline2:    'Totally fine -- appreciate you letting me know.',
    ackDecline3:    "That's okay -- thanks for taking the time.",
    ackDecline4:    "Understood -- let's keep going.",
    ackShort:       'Got it -- thanks for sharing that.',
    ackPositive:    "That's wonderful to hear -- thank you for sharing!",
    ackNegative:    'We really appreciate you sharing that -- it helps us understand what needs to change.',
    ackDefault1:    "Got it -- that's genuinely helpful.",
    ackDefault2:    "Thank you -- that's really useful feedback.",
    ackDefault3:    "Appreciate you sharing that -- it makes a difference.",
    clarifyPlaceholder: 'Feel free to add a bit more...',
  }

  // Rating scale labels (e.g. "Very poor", "Good", "Excellent")
  const ratingLabels: Record<string, string> = {}
  for (const r of (config.ratingScale || [])) {
    if (r.label) ratingLabels[r.label] = r.label
  }

  // NPS labels
  const npsLabels: Record<string, string> = {
    '1 - No': '1 - No',
    '2 - Unlikely': '2 - Unlikely',
    '3 - Maybe': '3 - Maybe',
    '4 - Likely': '4 - Likely',
    '5 - Definitely!': '5 - Definitely!',
  }

  // Section transition messages
  const transitionStrings: Record<string, string> = {}
  const trans = config.sectionTransitions || {}
  if (trans.psychographics?.enabled !== false)
    transitionStrings.psychographics = trans.psychographics?.text || 'Just a few quick questions to round things out -- helps us understand the range of people sharing feedback.'
  if (trans.demographics?.enabled !== false)
    transitionStrings.demographics = trans.demographics?.text || 'Almost done -- a couple of optional questions about you. Completely up to you.'
  if (trans.customQuestions?.enabled)
    transitionStrings.customQuestions = trans.customQuestions?.text || 'Now for a few more specific questions.'
  if (trans.contact?.enabled !== false)
    transitionStrings.contact = trans.contact?.text || ''

  const payload: Record<string, any> = {
    strings: contentToTranslate,
    questions: questionsToTranslate,
    psychographics: psychoToTranslate,
    ui: uiStrings,
    ratingLabels,
    npsLabels,
    transitions: transitionStrings,
  }
  if (Object.keys(followUpsToTranslate).length > 0) payload.followUps = followUpsToTranslate
  if (Object.keys(openingFlowToTranslate).length > 0) payload.openingFlow = openingFlowToTranslate
  if (Object.keys(demoLabelsToTranslate).length > 0) payload.demoLabels = demoLabelsToTranslate
  if (Object.keys(demoOptionsToTranslate).length > 0) payload.demoOptions = demoOptionsToTranslate
  if (Object.keys(contactLabelsToTranslate).length > 0) payload.contactLabels = contactLabelsToTranslate

  const prompt = `Translate the following survey content from English to ${targetLanguageName || targetLanguage}.
Return a JSON object with the exact same structure and keys, but with translated values.
Keep merge tags like {{first_name}} and {{survey_link}} unchanged.
Keep HTML tags like <a href="..."> unchanged.
Keep emoji characters unchanged (do not remove or replace them).
Maintain the same tone — warm, conversational, professional.

Content to translate:
${JSON.stringify(payload, null, 2)}

Return ONLY valid JSON, no markdown, no explanation.`

  async function attemptTranslation(): Promise<any> {
    const result = await callAI({
      tier: 'fast',
      maxTokens: 16000,
      timeoutMs: 45000,
      messages: [{ role: 'user', content: prompt }],
    })
    logUsage({
      org_id:        studyOrgId,
      resource_type: studyId ? 'study' : 'system',
      resource_id:   studyId && studyOrgId ? studyId : undefined,
      event_type:    'translate',
    }, result.usage)
    let text = result.text?.trim() || ''
    text = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim()
    return JSON.parse(text)
  }

  try {
    let parsed: any
    try {
      parsed = await attemptTranslation()
    } catch (firstErr) {
      console.warn('[translate] first attempt failed, retrying:', (firstErr as Error).message)
      parsed = await attemptTranslation()
    }

    // Build the StudyTranslation
    const translation: StudyTranslation = {
      greeting: parsed.strings?.greeting || '',
      q3: parsed.strings?.q3,
      q4: parsed.strings?.q4,
      promoterQ1: parsed.strings?.promoterQ1,
      passiveQ1: parsed.strings?.passiveQ1,
      detractorQ1: parsed.strings?.detractorQ1,
      ratingPrompt: parsed.strings?.ratingPrompt,
      npsPrompt: parsed.strings?.npsPrompt,
      closingMessage: parsed.strings?.closingMessage,
      closingCard: parsed.strings?.closingCard,
      readyPrompt: parsed.strings?.readyPrompt,
      readyYes: parsed.strings?.readyYes,
      readyNo: parsed.strings?.readyNo,
      contactTransition: parsed.strings?.contactTransition,
      questions: parsed.questions,
      psychographics: parsed.psychographics,
      followUps: parsed.followUps,
      openingFlow: parsed.openingFlow,
      demoLabels: parsed.demoLabels,
      demoOptions: parsed.demoOptions,
      contactLabels: parsed.contactLabels,
      ui: {
        ...parsed.ui,
        ratingLabels: parsed.ratingLabels,
        npsLabels: parsed.npsLabels,
        transitions: parsed.transitions,
      },
    }

    return NextResponse.json({ translation })

  } catch (err: any) {
    console.error('Translation error:', err)
    return NextResponse.json({ error: err.message || 'Translation failed' }, { status: 500 })
  }
}
