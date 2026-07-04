// Tests for lib/promotion.ts — the promotion-manifest build/apply layer
// shared by the bot export/import routes and scripts/promote.ts. The
// load-bearing semantics: imports land DORMANT (draft/paused), the column
// allow-lists strip anything that shouldn't cross databases, surveys get a
// FRESH guid, and a failed PulseIQ session insert rolls back its dedicated
// agent instead of stranding it.

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  parseManifest, freeSlug, slugify, PromotionInputError,
  applyAgentManifest, applyPulseiqManifest, applyStudyManifest,
  type AgentManifest, type PulseiqManifest, type StudyManifest,
} from '@/lib/promotion'

// --- minimal fake Supabase client covering the chains lib/promotion uses ---

interface TableBehavior {
  slugs?: Set<string>
  insertError?: { message: string } | null
}

function mockDb(behavior: Record<string, TableBehavior> = {}) {
  const inserts: Record<string, Record<string, unknown>[]> = {}
  const deletes: Record<string, unknown[]> = {}
  const db = {
    from(table: string) {
      const b = behavior[table] || {}
      return {
        select(_cols: string) {
          return {
            eq(_col: string, val: unknown) {
              return {
                limit(_n: number) {
                  return Promise.resolve({ data: b.slugs?.has(String(val)) ? [{ id: 'x' }] : [], error: null })
                },
              }
            },
          }
        },
        insert(row: Record<string, unknown> | Record<string, unknown>[]) {
          const first = Array.isArray(row) ? row[0] : row
          ;(inserts[table] ||= []).push(...(Array.isArray(row) ? row : [row]))
          const data = b.insertError ? null : {
            id: 'new-' + table,
            name: first.name, slug: first.slug, guid: first.guid,
          }
          const result = { data, error: b.insertError ?? null }
          const bare = Promise.resolve({ error: b.insertError ?? null })
          return Object.assign(bare, {
            select: (_c: string) => ({ single: () => Promise.resolve(result) }),
          })
        },
        delete() {
          const chain = {
            eq(_c: string, v: unknown) { (deletes[table] ||= []).push(v); return chain },
            then<T>(resolve: (r: { error: null }) => T) { return Promise.resolve({ error: null }).then(resolve) },
          }
          return chain
        },
      }
    },
  }
  return { db: db as unknown as SupabaseClient, inserts, deletes }
}

// --- parseManifest -----------------------------------------------------------

describe('parseManifest', () => {
  it('detects each manifest family by its version key', () => {
    expect(parseManifest({ bot_export_version: 1, bot: {} }).type).toBe('agent')
    expect(parseManifest({ pulseiq_export_version: 1, session: {} }).type).toBe('pulseiq')
    expect(parseManifest({ study_export_version: 1, study: {} }).type).toBe('survey')
  })
  it('rejects unknown versions and non-manifests', () => {
    expect(() => parseManifest({ bot_export_version: 2, bot: {} })).toThrow(/expected 1/)
    expect(() => parseManifest({ pulseiq_export_version: 1 })).toThrow(/session/)
    expect(() => parseManifest({ hello: 'world' })).toThrow(/export_version/)
    expect(() => parseManifest(null)).toThrow()
  })
})

// --- slug helpers ------------------------------------------------------------

describe('freeSlug', () => {
  const existsIn = (taken: string[]) => (s: string) => Promise.resolve(taken.includes(s))
  it('keeps the base slug when free', async () => {
    expect(await freeSlug('sarina', existsIn([]))).toBe('sarina')
  })
  it('climbs the -copy ladder on collision', async () => {
    expect(await freeSlug('sarina', existsIn(['sarina']))).toBe('sarina-copy')
    expect(await freeSlug('sarina', existsIn(['sarina', 'sarina-copy']))).toBe('sarina-copy2')
  })
})

describe('slugify', () => {
  it('lowercases, hyphenates, trims, and falls back', () => {
    expect(slugify('MVP+ Planning Session', 'x')).toBe('mvp-planning-session')
    expect(slugify('***', 'fallback')).toBe('fallback')
  })
})

// --- applyAgentManifest ------------------------------------------------------

const agentManifest = (over: Partial<AgentManifest['bot']> = {}): AgentManifest => ({
  bot_export_version: 1,
  exported_at: '2026-07-03T00:00:00Z',
  source_bot_id: 'src-1',
  source_bot_name: 'Sarina',
  source_bot_slug: 'sarina',
  bot: { name: 'Sarina', slug: 'sarina', status: 'active', system_prompt: 'p', conversation_count: 999, org_id: 'evil-org', ...over },
  chunks: [
    { title: 'Doc', content: 'This is a knowledge chunk with plenty of content.', metadata: {} },
    { title: 'Tiny', content: 'too short', metadata: {} },
  ],
})

describe('applyAgentManifest', () => {
  it('forces draft status, strips non-allowed keys, imports only real chunks', async () => {
    const { db, inserts } = mockDb()
    const r = await applyAgentManifest(db, agentManifest(), { orgId: 'org-1', createdBy: 'user-1' })
    const row = inserts.agents[0]
    expect(row.status).toBe('draft')
    expect(row.org_id).toBe('org-1')          // target org, not the manifest's
    expect(row.created_by).toBe('user-1')
    expect(row).not.toHaveProperty('conversation_count')
    expect(r.chunksInserted).toBe(1)           // the <20-char chunk is dropped
    expect(inserts.agent_knowledge_chunks[0]).not.toHaveProperty('embedding')
  })
  it('suffixes the slug on collision', async () => {
    const { db, inserts } = mockDb({ agents: { slugs: new Set(['sarina']) } })
    await applyAgentManifest(db, agentManifest(), { orgId: 'org-1', createdBy: null })
    expect(inserts.agents[0].slug).toBe('sarina-copy')
  })
  it('rejects a manifest without a name', async () => {
    const { db } = mockDb()
    await expect(applyAgentManifest(db, agentManifest({ name: undefined }), { orgId: 'o', createdBy: null }))
      .rejects.toThrow(PromotionInputError)
  })
})

// --- applyPulseiqManifest ----------------------------------------------------

const pulseiqManifest = (): PulseiqManifest => ({
  pulseiq_export_version: 1,
  exported_at: '2026-07-03T00:00:00Z',
  source_session_id: 'src-s',
  source_session_name: 'Planning Session',
  source_session_slug: 'planning',
  session: { name: 'Planning Session', slug: 'planning', cohort_config: { pacing: {} }, discussion_guide: { topics: [] }, response_target: 75 },
  agent: { name: 'Facilitator', personality: 'warm', system_prompt: 'facilitate', sensitive_topics: [] },
})

describe('applyPulseiqManifest', () => {
  it('lands a paused dedicated agent and a draft session pointing at it', async () => {
    const { db, inserts } = mockDb()
    const r = await applyPulseiqManifest(db, pulseiqManifest(), { orgId: 'org-1', createdBy: 'u1' })
    const agent = inserts.agents[0]
    const session = inserts.pulseiq_sessions[0]
    expect(agent.status).toBe('paused')
    expect(agent.config).toEqual({ pulseiq_dedicated: true })
    expect(agent.slug).toBe('planning-agent')
    expect(session.status).toBe('draft')
    expect(session.bot_id).toBe('new-agents')
    expect(session.response_target).toBe(75)
    expect(r.slug).toBe('planning')
  })
  it('rolls back the dedicated agent when the session insert fails', async () => {
    const { db, deletes } = mockDb({ pulseiq_sessions: { insertError: { message: 'boom' } } })
    await expect(applyPulseiqManifest(db, pulseiqManifest(), { orgId: 'org-1', createdBy: null }))
      .rejects.toThrow(/Session insert failed/)
    expect(deletes.agents).toContain('new-agents')
  })
})

// --- applyStudyManifest ------------------------------------------------------

const studyManifest = (over: Partial<StudyManifest['study']> = {}): StudyManifest => ({
  study_export_version: 1,
  exported_at: '2026-07-03T00:00:00Z',
  source_study_id: 'src-st',
  source_study_guid: '11111111-1111-1111-1111-111111111111',
  source_study_name: 'Guest Pulse',
  study: { name: 'Guest Pulse', bot_name: 'Ana', bot_emoji: '🦜', config: { questions: [] }, slug: 'guest-pulse', status: 'active', client_id: 'evil-client', ...over },
})

describe('applyStudyManifest', () => {
  it('lands draft with a FRESH guid and no client linkage', async () => {
    const { db, inserts } = mockDb()
    const r = await applyStudyManifest(db, studyManifest(), { orgId: 'org-1', createdBy: 'u1' })
    const row = inserts.studies[0]
    expect(row.status).toBe('draft')
    expect(row.client_id).toBeNull()
    expect(row.org_id).toBe('org-1')
    expect(row.guid).not.toBe('11111111-1111-1111-1111-111111111111')
    expect(String(row.guid)).toMatch(/^[0-9a-f-]{36}$/i)
    expect(r.guid).toBe(row.guid)
  })
  it('suffixes a colliding slug and drops an absent one', async () => {
    const taken = mockDb({ studies: { slugs: new Set(['guest-pulse']) } })
    await applyStudyManifest(taken.db, studyManifest(), { orgId: 'o', createdBy: null })
    expect(taken.inserts.studies[0].slug).toBe('guest-pulse-copy')

    const bare = mockDb()
    await applyStudyManifest(bare.db, studyManifest({ slug: undefined }), { orgId: 'o', createdBy: null })
    expect(bare.inserts.studies[0]).not.toHaveProperty('slug')
  })
})
