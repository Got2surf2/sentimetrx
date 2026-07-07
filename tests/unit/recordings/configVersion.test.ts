// tests/unit/recordings/configVersion.test.ts
//
// Drift detection (§5.4/§5.7, edit-anytime Phase 4): isAnalysisConfigDrifted is
// true only when an ANALYSIS-SHAPING field (setup_inputs / meeting_profile /
// objectives) differs from the snapshot that produced the live analysis —
// metadata edits (name/location/analysts/…) are NOT drift. The version lookup is
// stubbed; the assertion is the shaping-vs-metadata comparison.

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isAnalysisConfigDrifted, buildSnapshot } from '@/lib/recordings/configVersion'

const base: Record<string, unknown> = {
  name: 'Town hall', session_type: 'qa', meeting_date: null, location: 'City Hall', language: 'en',
  setup_inputs: { agenda: ['Budget'], panel: [{ name: 'Jane' }] },
  meeting_profile: null, presentation_outline: null, brand_tag: null, underlying_agent_id: null,
  analysis_org: 'Datanautix', analysts: [{ name: 'A' }], objectives: { summary: 'X', questions: [] },
  confidentiality_class: 'client_confidential',
}

// A fake service whose recording_config_versions lookup returns `snapshot`
// (undefined → no row, i.e. the analyzed snapshot is missing).
interface QueryChain {
  select: () => QueryChain
  eq: () => QueryChain
  maybeSingle: () => Promise<{ data: { snapshot: unknown } | null; error: null }>
}
function svc(snapshot: unknown): SupabaseClient {
  const chain: QueryChain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: snapshot === undefined ? null : { snapshot }, error: null }),
  }
  return { from: () => chain } as unknown as SupabaseClient
}

describe('isAnalysisConfigDrifted', () => {
  it('false when never analyzed (analyzedVersion null)', async () => {
    expect(await isAnalysisConfigDrifted(svc(buildSnapshot(base)), 'r', 'o', base, null)).toBe(false)
  })

  it('false when shaping config matches the analyzed snapshot', async () => {
    expect(await isAnalysisConfigDrifted(svc(buildSnapshot(base)), 'r', 'o', base, 1)).toBe(false)
  })

  it('false when only metadata changed (name/location/analysts) — not shaping', async () => {
    const current = { ...base, name: 'Renamed', location: 'Elsewhere', analysts: [{ name: 'B' }], analysis_org: 'Acme' }
    expect(await isAnalysisConfigDrifted(svc(buildSnapshot(base)), 'r', 'o', current, 1)).toBe(false)
  })

  it('true when the agenda (setup_inputs) changed', async () => {
    const current = { ...base, setup_inputs: { agenda: ['Budget', 'Roads'], panel: [{ name: 'Jane' }] } }
    expect(await isAnalysisConfigDrifted(svc(buildSnapshot(base)), 'r', 'o', current, 1)).toBe(true)
  })

  it('true when objectives changed', async () => {
    const current = { ...base, objectives: { summary: 'Different', questions: [] } }
    expect(await isAnalysisConfigDrifted(svc(buildSnapshot(base)), 'r', 'o', current, 1)).toBe(true)
  })

  it('true when the meeting profile changed', async () => {
    const current = { ...base, meeting_profile: { preset_id: 'community_meeting' } }
    expect(await isAnalysisConfigDrifted(svc(buildSnapshot(base)), 'r', 'o', current, 1)).toBe(true)
  })

  it('false when the analyzed snapshot row is missing', async () => {
    expect(await isAnalysisConfigDrifted(svc(undefined), 'r', 'o', base, 1)).toBe(false)
  })
})
