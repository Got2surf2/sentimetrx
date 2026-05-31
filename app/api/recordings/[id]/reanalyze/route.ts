// app/api/recordings/[id]/reanalyze/route.ts
//
// POST § 4.11 — re-extract pairs with optional user instructions.
// Body: { scope: 'all' | 'topic', topic?: string, instructions?: string }.
// scope='all'   → ~$1, replaces every extraction.
// scope='topic' → scales with the scoped span, ~$0.10–$0.40 typical.
//
// Auth + same-tenant + status='complete'.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { reanalyzeRecording, type ReanalyzeScope } from '@/lib/recordings/reanalyze'

export const dynamic = 'force-dynamic'

interface Body {
  scope?: ReanalyzeScope
  topic?: string
  instructions?: string
}

export async function POST(req: Request, ctx: { params: { id: string } }) {
  const recording_id = ctx.params.id
  if (!recording_id) return NextResponse.json({ error: 'missing recording id' }, { status: 400 })

  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: userRow } = await supabase
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()
  const org_id = userRow?.org_id as string | undefined
  if (!org_id) return NextResponse.json({ error: 'org not found' }, { status: 403 })

  // Same-tenant check before we hand to the service-role path.
  const service = createServiceRoleClient()
  const { data: rec, error: rErr } = await service
    .from('recordings')
    .select('id')
    .eq('id', recording_id)
    .eq('org_id', org_id)
    .single()
  if (rErr || !rec) return NextResponse.json({ error: 'not found' }, { status: 404 })

  let body: Body = {}
  try { body = (await req.json()) as Body } catch { /* empty body → scope='all' default below */ }

  const scope: ReanalyzeScope = body.scope ?? 'all'
  if (scope !== 'all' && scope !== 'topic') {
    return NextResponse.json({ error: `scope must be 'all' or 'topic' (got '${scope}')` }, { status: 400 })
  }
  if (scope === 'topic' && !body.topic?.trim()) {
    return NextResponse.json({ error: "scope='topic' requires a topic string" }, { status: 400 })
  }
  const instructions = body.instructions?.trim() || undefined
  if (instructions && instructions.length > 4000) {
    return NextResponse.json({ error: 'instructions too long (4000 char max)' }, { status: 400 })
  }

  try {
    const result = await reanalyzeRecording({
      recording_id,
      org_id,
      scope,
      topic: body.topic?.trim() || undefined,
      instructions,
    })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'reanalyze failed'
    if (message === 'recording not found' || message.startsWith('no existing pairs found with topic=')) {
      return NextResponse.json({ error: message }, { status: 404 })
    }
    if (message.includes('transcript not found') || message.startsWith('topic-scoped transcript window is empty') || message.startsWith('recording must be status=')) {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
