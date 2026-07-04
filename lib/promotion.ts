// lib/promotion.ts
// Promotion manifests — "config flows up" (prod/test isolation block, part 3;
// counterpart of scripts/clone-org-to-test.ts which flows data DOWN).
//
// A manifest is a versioned, reviewable JSON snapshot of ONE configurable
// entity — an agent, a PulseIQ session, or a survey — stripped of ids,
// org linkage, and runtime data. Build one from a source database, review
// the file, then apply it to a target database where it lands dormant
// (agents: draft, PulseIQ sessions: draft, surveys: draft) so the owner
// activates deliberately in the UI.
//
// The agent format is the pre-existing `bot_export_version: 1` shape used by
// app/api/bots/[id]/export + app/api/bots/import — those routes now call
// this module, so route downloads and scripts/promote.ts files interoperate.
//
// All functions take a service-role SupabaseClient so the same code serves
// in-app routes (same-project import) and the cross-project promote CLI.

import type { SupabaseClient } from '@supabase/supabase-js'
import { generateStudyGuid } from './guid'

export type ManifestType = 'agent' | 'pulseiq' | 'survey'

export interface AgentManifest {
  bot_export_version: 1
  exported_at: string
  source_host?: string
  source_bot_id: string
  source_bot_name: string | null
  source_bot_slug: string | null
  bot: Record<string, unknown>
  chunks: { title: string | null; content: string; metadata: unknown }[]
}

export interface PulseiqManifest {
  pulseiq_export_version: 1
  exported_at: string
  source_host?: string
  source_session_id: string
  source_session_name: string | null
  source_session_slug: string | null
  session: {
    name: string
    slug: string
    cohort_config: Record<string, unknown>
    discussion_guide: unknown
    response_target: number | null
  }
  // The session's dedicated facilitator agent (persona travels with the
  // session; topics do NOT — seed topics regenerate on activate, same as
  // the duplicate route).
  agent: {
    name: string | null
    personality: string | null
    system_prompt: string | null
    sensitive_topics: string[] | null
  }
}

export interface StudyManifest {
  study_export_version: 1
  exported_at: string
  source_host?: string
  source_study_id: string
  source_study_guid: string | null
  source_study_name: string | null
  study: Record<string, unknown>
}

export interface ImportTarget {
  orgId: string
  createdBy: string | null
}

// Bad manifest content (as opposed to a database failure) — routes map this
// to a 4xx instead of a 500.
export class PromotionInputError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

// ---------------------------------------------------------------------------
// Shared helpers

// Fields stripped from an agent export — ids / timestamps / FKs that don't
// round-trip into a new row. The importer re-creates them.
const AGENT_STRIP = new Set([
  'id', 'org_id', 'created_at', 'updated_at', 'last_session_at', 'created_by', 'next_review_at',
])

// Columns an agent import may write. Anything else in the payload is dropped.
export const AGENT_ALLOWED_KEYS = new Set([
  'name', 'slug', 'status', 'config', 'system_prompt', 'personality',
  'knowledge_base', 'training_urls', 'review_interval_hours',
  'faq', 'facts', 'guardrails', 'subject', 'negative_content_mode',
  'opponents', 'contrast_mode', 'sensitive_topics', 'focus_topics',
  'deflection_enabled', 'deflection_message', 'ask_profile',
  'profile_question', 'intents', 'focuses', 'demographic_inference',
])

// Columns a survey import may write. Everything configurable lives in the
// `config` jsonb; there is no child config table.
export const STUDY_ALLOWED_KEYS = new Set([
  'name', 'bot_name', 'bot_emoji', 'config', 'slug', 'visibility',
])

export function slugify(name: string, fallback: string): string {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || fallback
}

// Find a free slug: base, base-copy, base-copy2, … (same ladder the bot
// import route has always used).
export async function freeSlug(base: string, exists: (slug: string) => Promise<boolean>): Promise<string> {
  let slug = base
  let n = 0
  while (await exists(slug)) {
    n += 1
    slug = base + '-copy' + (n === 1 ? '' : n)
    if (n > 50) throw new PromotionInputError('Could not find a free slug for "' + base + '"', 409)
  }
  return slug
}

function slugExistsIn(db: SupabaseClient, table: string) {
  return async (slug: string): Promise<boolean> => {
    const { data, error } = await db.from(table).select('id').eq('slug', slug).limit(1)
    if (error) throw new Error('Slug check on ' + table + ' failed: ' + error.message)
    return !!data && data.length > 0
  }
}

// ---------------------------------------------------------------------------
// Manifest detection / validation

export function parseManifest(payload: unknown):
  | { type: 'agent'; manifest: AgentManifest }
  | { type: 'pulseiq'; manifest: PulseiqManifest }
  | { type: 'survey'; manifest: StudyManifest } {
  const p = payload as Record<string, unknown> | null
  if (!p || typeof p !== 'object') throw new Error('Manifest is not a JSON object')
  if ('bot_export_version' in p) {
    if (p.bot_export_version !== 1) throw new Error('Unsupported bot_export_version (expected 1)')
    if (!p.bot || typeof p.bot !== 'object') throw new Error('Missing or invalid bot payload')
    return { type: 'agent', manifest: p as unknown as AgentManifest }
  }
  if ('pulseiq_export_version' in p) {
    if (p.pulseiq_export_version !== 1) throw new Error('Unsupported pulseiq_export_version (expected 1)')
    if (!p.session || typeof p.session !== 'object') throw new Error('Missing or invalid session payload')
    return { type: 'pulseiq', manifest: p as unknown as PulseiqManifest }
  }
  if ('study_export_version' in p) {
    if (p.study_export_version !== 1) throw new Error('Unsupported study_export_version (expected 1)')
    if (!p.study || typeof p.study !== 'object') throw new Error('Missing or invalid study payload')
    return { type: 'survey', manifest: p as unknown as StudyManifest }
  }
  throw new Error('Not a promotion manifest (no *_export_version field)')
}

// ---------------------------------------------------------------------------
// Agent (bots)

export async function buildAgentManifest(db: SupabaseClient, agentId: string, opts?: { sourceHost?: string }): Promise<AgentManifest> {
  const { data: bot, error } = await db.from('agents').select('*').eq('id', agentId).single()
  if (error || !bot) throw new Error('Agent not found: ' + agentId)

  const { data: chunks } = await db
    .from('agent_knowledge_chunks')
    .select('title, content, metadata')
    .eq('bot_id', agentId)
    .order('created_at', { ascending: true })

  const row = bot as Record<string, unknown>
  const cleanBot: Record<string, unknown> = {}
  for (const k of Object.keys(row)) {
    if (!AGENT_STRIP.has(k)) cleanBot[k] = row[k]
  }

  return {
    bot_export_version: 1,
    exported_at: new Date().toISOString(),
    ...(opts?.sourceHost ? { source_host: opts.sourceHost } : {}),
    source_bot_id: agentId,
    source_bot_name: (row.name as string) ?? null,
    source_bot_slug: (row.slug as string) ?? null,
    bot: cleanBot,
    chunks: (chunks || []).map(c => ({ title: c.title, content: c.content, metadata: c.metadata })),
  }
}

export interface AgentImportResult {
  id: string
  name: string
  slug: string
  chunksInserted: number
  chunkError: string | null
}

export async function applyAgentManifest(db: SupabaseClient, manifest: AgentManifest, target: ImportTarget): Promise<AgentImportResult> {
  const incomingBot: Record<string, unknown> = {}
  for (const k of Object.keys(manifest.bot)) {
    if (AGENT_ALLOWED_KEYS.has(k)) incomingBot[k] = manifest.bot[k]
  }
  if (!incomingBot.name) throw new PromotionInputError('Bot name missing in payload')

  const baseSlug = String(incomingBot.slug || slugify(incomingBot.name as string, 'imported-bot')).slice(0, 40) || 'imported-bot'
  incomingBot.slug = await freeSlug(baseSlug, slugExistsIn(db, 'agents'))
  // Imported agents start as draft so the new owner can review before activating.
  incomingBot.status = 'draft'

  const { data: newBot, error: insErr } = await db.from('agents').insert({
    ...incomingBot,
    org_id: target.orgId,
    created_by: target.createdBy,
  }).select('id, name, slug').single()
  if (insErr || !newBot) throw new Error('Agent insert failed: ' + (insErr?.message || 'no row returned'))

  // Insert chunks WITHOUT embeddings — the bot edit page or a rescan run can
  // backfill them; embedding inline would block on OpenAI for potentially
  // hundreds of chunks.
  let chunksInserted = 0
  let chunkError: string | null = null
  if (Array.isArray(manifest.chunks) && manifest.chunks.length > 0) {
    const rows = manifest.chunks
      .filter(c => c && typeof c.content === 'string' && c.content.trim().length >= 20)
      .map(c => ({
        bot_id: newBot.id as string,
        title: typeof c.title === 'string' && c.title.length > 0 ? c.title : 'Imported',
        content: c.content,
        metadata: c.metadata && typeof c.metadata === 'object' ? c.metadata : {},
      }))
    if (rows.length > 0) {
      const { error: chunkErr } = await db.from('agent_knowledge_chunks').insert(rows)
      if (!chunkErr) chunksInserted = rows.length
      else chunkError = chunkErr.message
    }
  }

  return { id: newBot.id as string, name: newBot.name as string, slug: newBot.slug as string, chunksInserted, chunkError }
}

// ---------------------------------------------------------------------------
// PulseIQ session

export async function buildPulseiqManifest(db: SupabaseClient, sessionId: string, opts?: { sourceHost?: string }): Promise<PulseiqManifest> {
  const { data: session, error } = await db
    .from('pulseiq_sessions')
    .select('id, name, slug, cohort_config, discussion_guide, response_target, org_id, bot_id')
    .eq('id', sessionId)
    .maybeSingle()
  if (error || !session) throw new Error('PulseIQ session not found: ' + sessionId)

  // The archived flag is runtime state, not config.
  const cohortConfig = { ...((session.cohort_config as Record<string, unknown> | null) || {}) }
  delete cohortConfig.archived

  const { data: agent } = await db
    .from('agents')
    .select('name, personality, system_prompt, sensitive_topics')
    .eq('id', session.bot_id)
    .eq('org_id', session.org_id)
    .maybeSingle()

  return {
    pulseiq_export_version: 1,
    exported_at: new Date().toISOString(),
    ...(opts?.sourceHost ? { source_host: opts.sourceHost } : {}),
    source_session_id: sessionId,
    source_session_name: session.name ?? null,
    source_session_slug: session.slug ?? null,
    session: {
      name: session.name,
      slug: session.slug,
      cohort_config: cohortConfig,
      discussion_guide: session.discussion_guide,
      response_target: session.response_target ?? null,
    },
    agent: {
      name: agent?.name ?? null,
      personality: agent?.personality ?? null,
      system_prompt: agent?.system_prompt ?? null,
      sensitive_topics: agent?.sensitive_topics ?? null,
    },
  }
}

export interface PulseiqImportResult {
  id: string
  slug: string
  agentId: string
  agentSlug: string
}

export async function applyPulseiqManifest(db: SupabaseClient, manifest: PulseiqManifest, target: ImportTarget): Promise<PulseiqImportResult> {
  const s = manifest.session
  if (!s.name) throw new PromotionInputError('Session name missing in payload')

  const baseSlug = String(s.slug || slugify(s.name, 'pulseiq')).slice(0, 40) || 'pulseiq'
  const slug = await freeSlug(baseSlug, slugExistsIn(db, 'pulseiq_sessions'))
  const agentSlug = await freeSlug(slug + '-agent', slugExistsIn(db, 'agents'))

  // Dedicated facilitator agent: status 'paused' + pulseiq_dedicated marker —
  // same contract as session creation: never publicly chattable, safe for
  // session DELETE to remove.
  const { data: agentRow, error: agentErr } = await db
    .from('agents')
    .insert({
      org_id: target.orgId,
      created_by: target.createdBy,
      name: manifest.agent?.name || s.name,
      slug: agentSlug,
      status: 'paused',
      config: { pulseiq_dedicated: true },
      personality: manifest.agent?.personality || 'Warm, curious facilitator. Keeps questions short and conversational, one at a time. Never lectures.',
      system_prompt: manifest.agent?.system_prompt || 'You facilitate a live group feedback session. Draw out specific, honest feedback. Keep replies brief.',
      sensitive_topics: manifest.agent?.sensitive_topics || [],
    })
    .select('id, slug')
    .single()
  if (agentErr || !agentRow) throw new Error('Dedicated agent insert failed: ' + (agentErr?.message || 'no row returned'))

  const { data: sessionRow, error: sessErr } = await db
    .from('pulseiq_sessions')
    .insert({
      org_id: target.orgId,
      bot_id: agentRow.id as string,
      created_by: target.createdBy,
      name: s.name,
      slug,
      status: 'draft',
      cohort_config: s.cohort_config || {},
      discussion_guide: s.discussion_guide || {},
      ...(typeof s.response_target === 'number' ? { response_target: s.response_target } : {}),
    })
    .select('id, slug')
    .single()
  if (sessErr || !sessionRow) {
    // Don't strand the just-created agent if the session insert failed.
    await db.from('agents').delete().eq('id', agentRow.id as string).eq('org_id', target.orgId)
    throw new Error('Session insert failed: ' + (sessErr?.message || 'no row returned'))
  }

  return {
    id: sessionRow.id as string,
    slug: sessionRow.slug as string,
    agentId: agentRow.id as string,
    agentSlug: agentRow.slug as string,
  }
}

// ---------------------------------------------------------------------------
// Survey (studies)

export async function buildStudyManifest(db: SupabaseClient, studyId: string, opts?: { sourceHost?: string }): Promise<StudyManifest> {
  const { data: study, error } = await db.from('studies').select('*').eq('id', studyId).single()
  if (error || !study) throw new Error('Survey not found: ' + studyId)

  const row = study as Record<string, unknown>
  const cleanStudy: Record<string, unknown> = {}
  for (const k of Object.keys(row)) {
    if (STUDY_ALLOWED_KEYS.has(k)) cleanStudy[k] = row[k]
  }

  return {
    study_export_version: 1,
    exported_at: new Date().toISOString(),
    ...(opts?.sourceHost ? { source_host: opts.sourceHost } : {}),
    source_study_id: studyId,
    source_study_guid: (row.guid as string) ?? null,
    source_study_name: (row.name as string) ?? null,
    study: cleanStudy,
  }
}

export interface StudyImportResult {
  id: string
  guid: string
  slug: string | null
}

export async function applyStudyManifest(db: SupabaseClient, manifest: StudyManifest, target: ImportTarget): Promise<StudyImportResult> {
  const incoming: Record<string, unknown> = {}
  for (const k of Object.keys(manifest.study)) {
    if (STUDY_ALLOWED_KEYS.has(k)) incoming[k] = manifest.study[k]
  }
  if (!incoming.name) throw new PromotionInputError('Survey name missing in payload')

  // Fresh guid — the public /s/<guid> link never carries over between
  // databases. The vanity slug does, with the usual collision ladder.
  const guid = generateStudyGuid()
  if (typeof incoming.slug === 'string' && incoming.slug.trim()) {
    incoming.slug = await freeSlug(String(incoming.slug).slice(0, 40), slugExistsIn(db, 'studies'))
  } else {
    delete incoming.slug
  }

  const { data: newStudy, error: insErr } = await db.from('studies').insert({
    ...incoming,
    guid,
    client_id: null,
    org_id: target.orgId,
    created_by: target.createdBy,
    status: 'draft',
    bot_name: incoming.bot_name || 'Assistant',
    bot_emoji: incoming.bot_emoji || '💬',
  }).select('id, guid, slug').single()
  if (insErr || !newStudy) throw new Error('Survey insert failed: ' + (insErr?.message || 'no row returned'))

  return { id: newStudy.id as string, guid: newStudy.guid as string, slug: (newStudy.slug as string) ?? null }
}
