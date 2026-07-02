import { createClient, getAuthUser } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { generateStudyGuid } from '@/lib/guid'
import { SLUG_REGEX } from '@/lib/constants'
import type { StudyConfig } from '@/lib/types'
import { serverError } from '@/lib/apiError'

// GET /api/studies — list studies for the current user's client
export async function GET() {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('studies')
    .select(`
      id, guid, slug, name, bot_name, bot_emoji, status, created_at, updated_at,
      config->theme,
      responses(count)
    `)
    .order('created_at', { ascending: false })

  if (error) return serverError(error, 'studies.list')
  return NextResponse.json(data)
}

// POST /api/studies — create a new study
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get the user's client_id
  const { data: userData } = await supabase
    .from('users')
    .select('client_id, org_id')
    .eq('id', user.id)
    .single()

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  const { name, bot_name, bot_emoji, config, slug: rawSlug } = body

  if (!name || !bot_name || !config) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Validate slug if provided
  let slug: string | null = null
  if (rawSlug && typeof rawSlug === 'string' && rawSlug.trim()) {
    slug = rawSlug.toLowerCase().trim()
    if (!SLUG_REGEX.test(slug)) {
      return NextResponse.json({ error: 'Slug must be 3-50 characters: lowercase letters, numbers, and hyphens only' }, { status: 400 })
    }
    const { data: conflict } = await supabase
      .from('studies')
      .select('id')
      .eq('slug', slug)
      .limit(1)
    if (conflict && conflict.length > 0) {
      return NextResponse.json({ error: 'This URL is already taken' }, { status: 409 })
    }
  }

  const guid = generateStudyGuid()

  const insertData: Record<string, unknown> = {
    guid,
    client_id:  userData?.client_id || null,
    org_id:     userData?.org_id    || null,
    created_by: user.id,
    name,
    bot_name,
    bot_emoji:  bot_emoji || '💬',
    status:     body.status === 'active' ? 'active' : 'draft',
    config,
  }
  if (slug) insertData.slug = slug

  const { data, error } = await supabase
    .from('studies')
    .insert(insertData)
    .select('id, guid, slug')
    .single()

  if (error) return serverError(error, 'studies.create', { orgId: userData?.org_id })
  return NextResponse.json(data, { status: 201 })
}
