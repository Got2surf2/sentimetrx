// app/api/recordings/[id]/extractions/[extractionId]/regenerate/route.ts
//
// POST § 4.10 — per-card regenerate. Sonnet 4.6 on a single extraction
// + the ±30s transcript window. Auth + same-tenant; status='complete'
// required (you can't regenerate cards on a recording that's still
// mid-pipeline). Body: { instructions?: string }.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { regenerateExtraction } from '@/lib/recordings/regenerate'

export const dynamic = 'force-dynamic'

interface Body {
  instructions?: string
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; extractionId: string }> },
) {
  const { id: recording_id, extractionId: extraction_id } = (await ctx.params)
  if (!recording_id || !extraction_id) {
    return NextResponse.json({ error: 'missing ids' }, { status: 400 })
  }

  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: userRow } = await supabase
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()
  const org_id = userRow?.org_id as string | undefined
  if (!org_id) return NextResponse.json({ error: 'org not found' }, { status: 403 })

  // Same-tenant guard: recording must belong to the caller's org. Service-role
  // queries inside regenerateExtraction also pair (id, org_id), but the outer
  // check returns a cleaner 404 if the user is poking at another org's id.
  const service = createServiceRoleClient()
  const { data: rec, error: rErr } = await service
    .from('recordings')
    .select('id')
    .eq('id', recording_id)
    .eq('org_id', org_id)
    .single()
  if (rErr || !rec) return NextResponse.json({ error: 'not found' }, { status: 404 })

  let body: Body = {}
  if (req.body) {
    try { body = (await req.json()) as Body } catch { /* empty body is fine */ }
  }
  const instructions = body.instructions?.trim() || undefined
  if (instructions && instructions.length > 2000) {
    return NextResponse.json({ error: 'instructions too long (2000 char max)' }, { status: 400 })
  }

  try {
    const result = await regenerateExtraction({
      recording_id,
      org_id,
      extraction_id,
      instructions,
    })
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'regenerate failed'
    // Map a couple known throw-strings to better HTTP codes.
    if (message === 'extraction not found' || message === 'recording not found') {
      return NextResponse.json({ error: message }, { status: 404 })
    }
    if (message === 'transcript not found — cannot regenerate without context') {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    if (message.startsWith('recording must be status=')) {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
