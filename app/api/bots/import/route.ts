// app/api/bots/import/route.ts
// POST — create a new bot from a bot_export_version=1 JSON payload.
// Slug is auto-suffixed if it collides. Knowledge chunks are inserted
// without embeddings; the existing knowledge UI can re-embed on demand.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { logBotChange } from '@/lib/auditLog'

export const dynamic = 'force-dynamic'

const BOT_ALLOWED_KEYS = new Set([
  'name', 'slug', 'status', 'config', 'system_prompt', 'personality',
  'knowledge_base', 'training_urls', 'review_interval_hours',
  'faq', 'facts', 'guardrails', 'subject', 'negative_content_mode',
  'opponents', 'contrast_mode', 'sensitive_topics', 'focus_topics',
  'deflection_enabled', 'deflection_message', 'ask_profile',
  'profile_question', 'intents', 'focuses', 'demographic_inference',
])

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

  let payload: any
  try { payload = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (payload?.bot_export_version !== 1) {
    return NextResponse.json({ error: 'Unsupported bot_export_version (expected 1)' }, { status: 400 })
  }
  if (!payload.bot || typeof payload.bot !== 'object') {
    return NextResponse.json({ error: 'Missing or invalid bot payload' }, { status: 400 })
  }

  const incomingBot: Record<string, unknown> = {}
  for (const k of Object.keys(payload.bot)) {
    if (BOT_ALLOWED_KEYS.has(k)) incomingBot[k] = (payload.bot as any)[k]
  }
  if (!incomingBot.name) return NextResponse.json({ error: 'Bot name missing in payload' }, { status: 400 })

  const service = createServiceRoleClient()

  // Slug collision handling: append -copy, -copy2, etc.
  let baseSlug = String(incomingBot.slug || (incomingBot.name as string).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).slice(0, 40) || 'imported-bot'
  let slug = baseSlug
  let suffix = 1
  while (true) {
    const { data: existing } = await service.from('agents').select('id').eq('slug', slug).limit(1)
    if (!existing || existing.length === 0) break
    suffix += 1
    slug = baseSlug + '-copy' + (suffix === 2 ? '' : suffix)
    if (suffix > 50) return NextResponse.json({ error: 'Could not find a free slug' }, { status: 409 })
  }
  incomingBot.slug = slug
  // Imported bots start as draft so the new owner can review before activating.
  incomingBot.status = 'draft'

  const { data: newBot, error: insErr } = await service.from('agents').insert({
    ...incomingBot,
    org_id: userOrgId,
    created_by: user.id,
  }).select('id, name, slug').single()
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  // Insert chunks (without embeddings — the bot edit page or a rescan run
  // can backfill them; trying to embed inline would block on OpenAI for
  // potentially hundreds of chunks).
  let chunksInserted = 0
  if (Array.isArray(payload.chunks) && payload.chunks.length > 0) {
    const rows = payload.chunks
      .filter((c: any) => c && typeof c.content === 'string' && c.content.trim().length >= 20)
      .map((c: any) => ({
        bot_id: newBot.id,
        title: typeof c.title === 'string' && c.title.length > 0 ? c.title : 'Imported',
        content: c.content,
        metadata: c.metadata && typeof c.metadata === 'object' ? c.metadata : {},
      }))
    if (rows.length > 0) {
      const { error: chunkErr } = await service.from('agent_knowledge_chunks').insert(rows)
      if (!chunkErr) chunksInserted = rows.length
      else console.error('[bot import] chunk insert error:', chunkErr.message)
    }
  }

  void logBotChange({
    botId: newBot.id,
    orgId: userOrgId,
    actorId: user.id,
    actorEmail: user.email || null,
    action: 'import',
    summary: 'Imported "' + newBot.name + '" with ' + chunksInserted + ' knowledge chunk' + (chunksInserted === 1 ? '' : 's') + (payload.source_bot_name ? ' (from "' + payload.source_bot_name + '")' : ''),
    metadata: {
      source_bot_id: payload.source_bot_id || null,
      source_bot_name: payload.source_bot_name || null,
      source_bot_slug: payload.source_bot_slug || null,
      chunks_imported: chunksInserted,
    },
  })

  return NextResponse.json({ id: newBot.id, slug: newBot.slug, chunks_imported: chunksInserted }, { status: 201 })
}
