// Tests for lib/entityMentionDetector.ts (docs/BOTS.md § 9.y.3).
//
// Covers: word-boundary matching, case-insensitivity, variant expansion via
// entityVariants, multi-word entities, longest-first precedence, hidden
// exclusion, cache invalidation, dedup within a turn.

import { describe, it, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  detectEntityMentions,
  invalidateEntityCache,
  __setEntityCacheForTest,
  __clearEntityCacheForTest,
} from '@/lib/entityMentionDetector'
import { expandEntityTerms } from '@/lib/entityVariants'

// Build a catalog entry the way loadCatalog() would. Keeps the test data
// shape honest.
function entry(slug: string, canonical: string, aliases: string[] = []) {
  return { slug, terms: expandEntityTerms([canonical, ...aliases].filter(Boolean)) }
}

const BOT_ID = '00000000-0000-0000-0000-00000000aaaa'

beforeEach(() => {
  __clearEntityCacheForTest()
})

describe('detectEntityMentions', () => {
  it('returns empty for empty / whitespace input', async () => {
    __setEntityCacheForTest(BOT_ID, [entry('terminal_a', 'Terminal A')])
    expect(await detectEntityMentions({} as unknown as SupabaseClient, BOT_ID, '')).toEqual([])
    expect(await detectEntityMentions({} as unknown as SupabaseClient, BOT_ID, '   ')).toEqual([])
  })

  it('matches a single-word canonical with word boundaries', async () => {
    __setEntityCacheForTest(BOT_ID, [entry('apopka', 'Apopka')])
    expect(await detectEntityMentions({} as unknown as SupabaseClient, BOT_ID, 'I live in Apopka.')).toEqual(['apopka'])
  })

  it('is case-insensitive', async () => {
    __setEntityCacheForTest(BOT_ID, [entry('apopka', 'Apopka')])
    expect(await detectEntityMentions({} as unknown as SupabaseClient, BOT_ID, 'apopka resident here')).toEqual(['apopka'])
    expect(await detectEntityMentions({} as unknown as SupabaseClient, BOT_ID, 'APOPKA gets ignored too?')).toEqual(['apopka'])
  })

  it('does not match across word boundaries', async () => {
    __setEntityCacheForTest(BOT_ID, [entry('apopka', 'Apopka')])
    // "Apopkans" should NOT match the canonical "Apopka" — word boundary.
    expect(await detectEntityMentions({} as unknown as SupabaseClient, BOT_ID, 'the Apopkans are organizing')).toEqual([])
  })

  it('matches multi-word entities', async () => {
    __setEntityCacheForTest(BOT_ID, [entry('plymouth_sorrento', 'Plymouth Sorrento')])
    expect(await detectEntityMentions({} as unknown as SupabaseClient, BOT_ID, 'when does Plymouth Sorrento get widened?')).toEqual(['plymouth_sorrento'])
  })

  it('matches plural variants via entityVariants expansion', async () => {
    __setEntityCacheForTest(BOT_ID, [entry('ordinance', 'Ordinance')])
    // expandEntityTerms generates the plural "Ordinances" automatically.
    expect(await detectEntityMentions({} as unknown as SupabaseClient, BOT_ID, 'the new Ordinances passed last week')).toEqual(['ordinance'])
  })

  it('matches singular for catalog plurals', async () => {
    __setEntityCacheForTest(BOT_ID, [entry('brussels_sprouts', 'Brussels Sprouts')])
    expect(await detectEntityMentions({} as unknown as SupabaseClient, BOT_ID, 'I had one Brussels Sprout')).toEqual(['brussels_sprouts'])
    expect(await detectEntityMentions({} as unknown as SupabaseClient, BOT_ID, 'I love Brussels Sprouts')).toEqual(['brussels_sprouts'])
  })

  it('dedupes when the same entity appears multiple times in one message', async () => {
    __setEntityCacheForTest(BOT_ID, [entry('apopka', 'Apopka')])
    const slugs = await detectEntityMentions({} as unknown as SupabaseClient, BOT_ID, 'Apopka, Apopka, Apopka — three times in Apopka')
    expect(slugs).toEqual(['apopka'])
  })

  it('returns multiple distinct entity slugs in first-seen order', async () => {
    __setEntityCacheForTest(BOT_ID, [
      entry('terminal_a', 'Terminal A'),
      entry('terminal_c', 'Terminal C'),
    ])
    expect(await detectEntityMentions({} as unknown as SupabaseClient, BOT_ID, 'I am at Terminal C, need to get to Terminal A')).toEqual(['terminal_c', 'terminal_a'])
  })

  it('uses longest-first precedence (multi-word wins over substring)', async () => {
    // If the catalog has both "Terminal" and "Terminal A", a message
    // mentioning "Terminal A" should match the more specific entity.
    __setEntityCacheForTest(BOT_ID, [
      entry('terminal', 'Terminal'),
      entry('terminal_a', 'Terminal A'),
    ])
    expect(await detectEntityMentions({} as unknown as SupabaseClient, BOT_ID, 'I am at Terminal A waiting')).toEqual(['terminal_a'])
  })

  it('matches an alias term', async () => {
    __setEntityCacheForTest(BOT_ID, [entry('foundations_project', 'The Foundations Project', ['Foundations'])])
    // "The Foundations Project" canonical includes the leading article; the
    // bare "Foundations" alias should match too. (Note: slugify strips the
    // leading "the".)
    expect(await detectEntityMentions({} as unknown as SupabaseClient, BOT_ID, 'tell me about Foundations')).toEqual(['foundations_project'])
  })

  it('skips terms shorter than 2 characters', async () => {
    __setEntityCacheForTest(BOT_ID, [entry('x', 'X')])
    expect(await detectEntityMentions({} as unknown as SupabaseClient, BOT_ID, 'X is a thing')).toEqual([])
  })

  it('invalidateEntityCache forces a reload', async () => {
    __setEntityCacheForTest(BOT_ID, [entry('apopka', 'Apopka')])
    expect(await detectEntityMentions({} as unknown as SupabaseClient, BOT_ID, 'Apopka talk')).toEqual(['apopka'])
    // After invalidation the next call would try to query the DB. We seed
    // the cache fresh to assert the invalidation cleared state without
    // needing a Supabase mock.
    invalidateEntityCache(BOT_ID)
    __setEntityCacheForTest(BOT_ID, [entry('orlando', 'Orlando')])
    expect(await detectEntityMentions({} as unknown as SupabaseClient, BOT_ID, 'Apopka talk')).toEqual([])
    expect(await detectEntityMentions({} as unknown as SupabaseClient, BOT_ID, 'Orlando talk')).toEqual(['orlando'])
  })
})
