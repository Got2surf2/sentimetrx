// app/api/admin/content-guard-test/route.ts
// POST — run text samples through content guard + tagging pipeline
// Returns per-sample flags, severity, sentiment, and actions

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { resolveOrg } from '@/lib/resolveOrg'
import { auditContent } from '@/lib/contentGuard'
import { tagComment } from '@/lib/socialTagging'
import { moderateTexts } from '@/lib/moderation'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations) as any
  if (!orgData?.is_admin_org) return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const { texts, labels, useModeration } = await req.json() as {
    texts: string[]
    labels?: string[]       // optional: 'hate'|'offensive'|'clean' per text
    useModeration?: boolean // whether to call OpenAI moderation
  }

  if (!texts?.length) return NextResponse.json({ error: 'texts required' }, { status: 400 })
  const batch = texts.slice(0, 500) // cap at 500

  // Optionally call OpenAI moderation
  var moderationScores = useModeration ? await moderateTexts(batch) : null

  var results = batch.map(function(text, i) {
    var audit = auditContent(text)
    var mod = moderationScores ? moderationScores[i] : null
    var tagged = tagComment(text, null, mod)
    var action = tagged.isDeleted ? 'auto_delete' : tagged.isHidden ? 'auto_hide' : tagged.flags.some(function(f) { return f.type === 'review' }) ? 'review' : 'none'
    return {
      text: text.substring(0, 200),
      label: labels?.[i] || null,
      sentiment: tagged.sentiment,
      flags: audit.flags,
      maxSeverity: audit.maxSeverity,
      action: action,
      moderation: mod ? {
        toxicity: Math.round(mod.toxicity * 100),
        threat: Math.round(mod.threat * 100),
        sexual: Math.round(mod.sexual * 100),
        identity: Math.round(mod.identity * 100),
        categories: mod.categories,
      } : null,
    }
  })

  // Compute summary stats
  var stats = { total: results.length, flagged: 0, deleted: 0, hidden: 0, review: 0, missed: 0, falsePositive: 0 }
  var byLabel: Record<string, { total: number, flagged: number, deleted: number, hidden: number, review: number, missed: number }> = {}

  for (var r of results) {
    var acted = r.action !== 'none'
    if (acted) stats.flagged++
    if (r.action === 'auto_delete') stats.deleted++
    if (r.action === 'auto_hide') stats.hidden++
    if (r.action === 'review') stats.review++

    if (r.label) {
      if (!byLabel[r.label]) byLabel[r.label] = { total: 0, flagged: 0, deleted: 0, hidden: 0, review: 0, missed: 0 }
      var lb = byLabel[r.label]
      lb.total++
      if (acted) lb.flagged++
      if (r.action === 'auto_delete') lb.deleted++
      if (r.action === 'auto_hide') lb.hidden++
      if (r.action === 'review') lb.review++
      if (!acted && r.label !== 'clean') lb.missed++
      if (acted && r.label === 'clean') stats.falsePositive++
    }
  }

  return NextResponse.json({ results, stats, byLabel })
}
