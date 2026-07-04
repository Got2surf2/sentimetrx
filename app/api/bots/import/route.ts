// app/api/bots/import/route.ts
// POST — create a new bot from a bot_export_version=1 JSON payload.
// Slug is auto-suffixed if it collides. Knowledge chunks are inserted
// without embeddings; the existing knowledge UI can re-embed on demand.
// Manifest validation + insert logic live in lib/promotion.ts (shared
// with scripts/promote.ts).

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { serverError } from '@/lib/apiError'
import { logBotChange } from '@/lib/auditLog'
import { parseManifest, applyAgentManifest } from '@/lib/promotion'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  const userOrgId = (userData as any)?.org_id as string | null
  if (!userOrgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let payload: unknown
  try { payload = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  let manifest
  try {
    const parsed = parseManifest(payload)
    if (parsed.type !== 'agent') {
      return NextResponse.json({ error: 'Unsupported bot_export_version (expected 1)' }, { status: 400 })
    }
    manifest = parsed.manifest
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid manifest' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  let result
  try {
    result = await applyAgentManifest(service, manifest, { orgId: userOrgId, createdBy: user.id })
  } catch (e) {
    return serverError(e, 'bots.import', { orgId: userOrgId })
  }
  if (result.chunkError) console.error('[bot import] chunk insert error:', result.chunkError)

  void logBotChange({
    botId: result.id,
    orgId: userOrgId,
    actorId: user.id,
    actorEmail: user.email || null,
    action: 'import',
    summary: 'Imported "' + result.name + '" with ' + result.chunksInserted + ' knowledge chunk' + (result.chunksInserted === 1 ? '' : 's') + (manifest.source_bot_name ? ' (from "' + manifest.source_bot_name + '")' : ''),
    metadata: {
      source_bot_id: manifest.source_bot_id || null,
      source_bot_name: manifest.source_bot_name || null,
      source_bot_slug: manifest.source_bot_slug || null,
      chunks_imported: result.chunksInserted,
    },
  })

  return NextResponse.json({ id: result.id, slug: result.slug, chunks_imported: result.chunksInserted }, { status: 201 })
}
