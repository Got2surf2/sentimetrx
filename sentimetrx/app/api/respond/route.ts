import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { createHash } from 'crypto'
import type { SubmitResponseBody, Sentiment } from '@/lib/types'

// POST /api/respond
// Public endpoint -- no auth required.
// Uses service role client to insert.

export async function POST(req: NextRequest) {
  let body: SubmitResponseBody

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { study_guid, payload, duration_sec } = body

  if (!study_guid || !payload) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Stage 2a: NPS and experience rating are individually optional.
  // Only reject if BOTH are missing (truly empty payload).
  const hasNps        = payload.npsRecommend?.score != null
  const hasExperience = payload.experienceRating?.score != null
  if (!hasNps && !hasExperience) {
    return NextResponse.json({ error: 'Incomplete survey payload' }, { status: 400 })
  }

  const supabase = createServiceRoleClient()

  const { data: study, error: studyError } = await supabase
    .from('studies')
    .select('id, client_id, status')
    .eq('guid', study_guid)
    .single()

  if (studyError || !study) {
    return NextResponse.json({ error: 'Study not found' }, { status: 404 })
  }

  if (study.status !== 'active') {
    return NextResponse.json({ error: 'Study is not accepting responses' }, { status: 403 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
             || req.headers.get('x-real-ip')
             || 'unknown'
  const ip_hash = createHash('sha256').update(ip).digest('hex')

  // Sentiment: from NPS if available, else from experienceRating, else null
  const sentiment: Sentiment | null =
    (payload.npsRecommend?.score != null
      ? (payload.npsRecommend.score >= 5 ? 'promoter' : payload.npsRecommend.score >= 4 ? 'passive' : 'detractor')
      : payload.experienceRating?.sentiment as Sentiment ?? null)

  const experience_score = payload.experienceRating?.score ?? null
  const nps_score        = payload.npsRecommend?.score ?? null

  const { data: response, error: insertError } = await supabase
    .from('responses')
    .insert({
      study_id:         study.id,
      study_guid,
      client_id:        study.client_id,
      sentiment,
      experience_score,
      nps_score,
      payload,
      duration_sec:     duration_sec ?? null,
      ip_hash,
    })
    .select('id')
    .single()

  if (insertError) {
    console.error('Response insert error:', insertError)
    return NextResponse.json({ error: 'Failed to save response' }, { status: 500 })
  }

  return NextResponse.json({ success: true, response_id: response.id }, { status: 201 })
}
