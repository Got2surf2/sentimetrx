// app/api/bots/[id]/probes/route.ts
// Research-probe results (BOTS.md §14.6): per-probe outcome funnel, rates,
// quota progress, coded distribution, wording variants and verbatim answers.
// Read-only aggregation over agent_probe_responses + agent_probe_quota.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { enabledProbes, PROBE_OUTCOMES, type ProbeOutcome } from '@/lib/researchProbes'
import { fetchAllRows } from '@/lib/townHallAdapter'
import { serverError } from '@/lib/apiError'

interface Params { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: userData } = await supabase
    .from('users').select('org_id, organizations(is_admin_org)').eq('id', user.id).single()
  const orgId = userData?.org_id as string | null
  const orgRel = userData?.organizations as unknown
  const orgRec = (Array.isArray(orgRel) ? orgRel[0] : orgRel) as { is_admin_org?: boolean } | null | undefined
  const isAdmin = !!orgRec?.is_admin_org
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  try {
    const { data: bot, error: botErr } = await service
      .from('agents')
      .select('id, org_id, name, research_probes')
      .eq('id', params.id)
      .single()
    if (botErr || !bot) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    // Service-role read: pair id with the caller's org (admin org may view any).
    if (!isAdmin && bot.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const probes = enabledProbes(bot)
    const allProbeDefs = Array.isArray(bot.research_probes) ? bot.research_probes as { id?: string }[] : []

    const responses = await fetchAllRows<{
      probe_id: string; probe_version: number; outcome: ProbeOutcome
      asked_wording: string | null; asked_turn: number | null; answer_text: string | null
      followup_text: string | null; coded: Record<string, unknown> | null; created_at: string
    }>((from, to) =>
      service.from('agent_probe_responses')
        .select('probe_id, probe_version, outcome, asked_wording, asked_turn, answer_text, followup_text, coded, created_at')
        .eq('agent_id', bot.id).eq('org_id', bot.org_id)
        .order('created_at', { ascending: false })
        .range(from, to),
      10000,
    )
    const { data: quotaRows } = await service
      .from('agent_probe_quota')
      .select('probe_id, probe_version, answered_count')
      .eq('agent_id', bot.id)

    // Group per (probe_id, version) — §14.2 rule 7: analysis only runs within a version.
    const keyOf = (pid: string, v: number) => pid + '@' + v
    const groups = new Map<string, typeof responses>()
    for (const r of responses) {
      const k = keyOf(r.probe_id, r.probe_version)
      if (!groups.has(k)) groups.set(k, [])
      groups.get(k)!.push(r)
    }
    const seen = new Set<string>()
    const results: unknown[] = []
    const buildGroup = (probeId: string, version: number, def?: Record<string, unknown>) => {
      const rows = groups.get(keyOf(probeId, version)) || []
      const counts = Object.fromEntries(PROBE_OUTCOMES.map(o => [o, 0])) as Record<ProbeOutcome, number>
      for (const r of rows) counts[r.outcome] = (counts[r.outcome] || 0) + 1
      const asked = counts.asked_answered + counts.asked_declined + counts.asked_ignored
      const assigned = asked + counts.never_fit + counts.quota_closed
      const yesNo = { yes: 0, no: 0 }
      const emotionCounts: Record<string, number> = {}
      const wordings: Record<string, number> = {}
      for (const r of rows) {
        if (r.coded && (r.coded as { yes_no?: unknown }).yes_no === true) yesNo.yes++
        if (r.coded && (r.coded as { yes_no?: unknown }).yes_no === false) yesNo.no++
        const flags = (r.coded as { emotion_flags?: unknown } | null)?.emotion_flags
        if (Array.isArray(flags)) for (const f of flags) emotionCounts[String(f)] = (emotionCounts[String(f)] || 0) + 1
        if (r.asked_wording) wordings[r.asked_wording] = (wordings[r.asked_wording] || 0) + 1
      }
      const quota = (quotaRows || []).find(q => q.probe_id === probeId && q.probe_version === version)
      return {
        probe_id: probeId,
        version,
        question: (def?.question as string) || rows.find(r => r.asked_wording)?.asked_wording || probeId,
        mode: (def?.mode as string) || null,
        enabled: def ? (def as { enabled?: boolean }).enabled !== false : false,
        target_n: (def as { sampling?: { target_n?: number } } | undefined)?.sampling?.target_n ?? null,
        answered_quota: quota?.answered_count ?? counts.asked_answered,
        funnel: { assigned, asked, ...counts },
        response_rate: asked > 0 ? counts.asked_answered / asked : null,
        decline_rate: asked > 0 ? counts.asked_declined / asked : null,
        coded: { yes_no: yesNo, emotion: emotionCounts },
        wording_variants: Object.entries(wordings).map(([wording, n]) => ({ wording, n })).sort((a, b) => b.n - a.n),
        answers: rows
          .filter(r => r.outcome === 'asked_answered' && r.answer_text)
          .slice(0, 50)
          .map(r => ({ answer_text: r.answer_text, followup_text: r.followup_text, asked_wording: r.asked_wording, asked_turn: r.asked_turn, coded: r.coded, created_at: r.created_at })),
      }
    }
    // Current library first (live definitions, even with zero data yet)…
    for (const def of allProbeDefs) {
      const pid = typeof def.id === 'string' ? def.id : ''
      if (!pid) continue
      const version = (def as { version?: number }).version || 1
      seen.add(keyOf(pid, version))
      results.push(buildGroup(pid, version, def as Record<string, unknown>))
    }
    // …then historical versions / removed probes that still have data.
    for (const k of groups.keys()) {
      if (seen.has(k)) continue
      const [pid, v] = [k.slice(0, k.lastIndexOf('@')), Number(k.slice(k.lastIndexOf('@') + 1))]
      results.push(buildGroup(pid, v))
    }

    return NextResponse.json({
      agent: { id: bot.id, name: bot.name },
      enabled_count: probes.length,
      probes: results,
    })
  } catch (e) {
    return serverError(e, 'bots.probes', { orgId: orgId ?? undefined })
  }
}
