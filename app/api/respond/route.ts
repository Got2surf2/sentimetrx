import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { createHash } from 'crypto'
import { checkRateLimit } from '@/lib/rateLimit'
import type { SubmitResponseBody, Sentiment } from '@/lib/types'
import { auditContent, auditConversationLog, type ContentFlag } from '@/lib/contentGuard'

// POST /api/respond
// Public endpoint -- no auth required.
// Uses service role client to insert/upsert.
//
// Supports two modes:
//   1. Partial save (status='incomplete') — upserts by session_id after each question
//   2. Final submit (status='complete')   — marks response complete, checks device limits
//
// `completed_at` is stamped on EVERY save (partial or final), so it's really
// "last activity" — partial/abandoned surveys still carry a real date. `status`
// is the authoritative complete-vs-incomplete signal, not the presence of a
// timestamp.

export async function POST(req: NextRequest) {
  var ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'

  // Reject oversized bodies before parsing (cheap header check; the key below
  // is read from the body so it must be parsed first).
  if (Number(req.headers.get('content-length') || 0) > 100_000) {
    return NextResponse.json({ error: 'Request too large' }, { status: 413 })
  }

  let body: SubmitResponseBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { study_guid, payload, duration_sec, session_id, status } = body

  // Two-tier rate limiting (perf review §7 Brief D). A QR-code-on-TV burst puts
  // a whole venue-WiFi crowd behind ONE NAT IP, where the old flat
  // `respond:<ip>` at 120/min capped the ROOM at ~2 saves/s. Key primarily by
  // (ip, session_id) so each respondent gets their own bucket, with a high
  // per-IP backstop that still stops a single abusive source. Cellular
  // scanners (own IP) are unaffected either way.
  const rlKey = 'respond:' + ip + ':' + (typeof session_id === 'string' && session_id ? session_id : 'anon')
  const rlSession = await checkRateLimit(rlKey, 20, 60000)
  if (rlSession.limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  const rlIp = await checkRateLimit('respond-ip:' + ip, 600, 60000)
  if (rlIp.limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  const isPartial = status === 'incomplete'
  const isFinal   = status === 'complete' || !status

  if (!study_guid || !payload) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Note: we no longer require NPS or experience scores for final submissions.
  // Studies can have both NPS and experience rating disabled (e.g. open-ended only
  // or custom questions only). The survey engine decides when the survey is complete;
  // the API trusts the client's status field.

  const supabase = createServiceRoleClient()

  const { data: study, error: studyError } = await supabase
    .from('studies')
    .select('id, client_id, status, config')
    .eq('guid', study_guid)
    .single()

  if (studyError || !study) {
    return NextResponse.json({ error: 'Study not found' }, { status: 404 })
  }

  if (study.status !== 'active') {
    return NextResponse.json({ error: 'Study is not accepting responses' }, { status: 403 })
  }

  const ip_hash = createHash('sha256').update(ip).digest('hex')

  // ── Device limit check (final submit only) ───────────────────────────────
  const config = study.config as Record<string, unknown> || {}
  if (isFinal && !isPartial && config.allowMultipleResponses === false) {
    // Check if this IP already submitted a complete response for this study
    const { data: existing } = await supabase
      .from('responses')
      .select('id')
      .eq('study_id', study.id)
      .eq('ip_hash', ip_hash)
      .eq('status', 'complete')
      .limit(1)

    // Also check browser fingerprint if provided
    const fp = (payload as Record<string, unknown>).deviceFingerprint as string | undefined
    let fpMatch = false
    if (fp) {
      const fp_hash = createHash('sha256').update(fp).digest('hex')
      const { data: fpExisting } = await supabase
        .from('responses')
        .select('id')
        .eq('study_id', study.id)
        .eq('fp_hash', fp_hash)
        .eq('status', 'complete')
        .limit(1)
      fpMatch = (fpExisting && fpExisting.length > 0) || false
    }

    if ((existing && existing.length > 0) || fpMatch) {
      return NextResponse.json(
        { error: 'ALREADY_COMPLETED', message: 'A response has already been submitted from this device.' },
        { status: 409 }
      )
    }
  }

  // ── Build row data ────────────────────────────────────────────────────────
  // Sentiment: prefer experience rating (derived client-side from actual scale range)
  // Fallback to NPS: 4-5 positive, 3 neutral, 1-2 negative (1-5 scale)
  const sentiment: Sentiment | null =
    (payload.experienceRating?.sentiment as Sentiment
      ?? (payload.npsRecommend?.score != null
        ? (payload.npsRecommend.score >= 4 ? 'positive' : payload.npsRecommend.score >= 3 ? 'neutral' : 'negative')
        : null))

  const experience_score = payload.experienceRating?.score ?? null
  const nps_score        = payload.npsRecommend?.score ?? null

  // Build fingerprint hash if provided
  const deviceFp = (payload as Record<string, unknown>).deviceFingerprint as string | undefined
  const fp_hash  = deviceFp ? createHash('sha256').update(deviceFp).digest('hex') : null

  const rowData: Record<string, unknown> = {
    study_id:         study.id,
    study_guid,
    client_id:        study.client_id,
    sentiment,
    experience_score,
    nps_score,
    payload,
    duration_sec:     duration_sec ?? null,
    ip_hash,
    status:           isPartial ? 'incomplete' : 'complete',
    // Always stamped — see header note. On a partial save this is the
    // last-activity time; on the final submit it's the completion time.
    completed_at:     new Date().toISOString(),
  }
  if (fp_hash) rowData.fp_hash = fp_hash
  if (session_id) rowData.session_id = session_id

  // ── Content safety flagging (when enabled on the study) ────────────────────
  const studyConfig = study.config as Record<string, unknown> | null
  if (studyConfig?.contentSafety) {
    const flagSet: Record<string, boolean> = {}

    // Scan conversation log
    if (payload.conversationLog && Array.isArray(payload.conversationLog)) {
      const logResult = auditConversationLog(payload.conversationLog)
      logResult.flags.forEach(function(f) { flagSet[f] = true })
    }

    // Scan open-ended responses
    const oe = payload.openEnded as Record<string, string> | undefined
    if (oe) {
      Object.values(oe).forEach(function(text) {
        if (text) auditContent(text).flags.forEach(function(f) { flagSet[f] = true })
      })
    }

    // Scan custom answers (free-text ones)
    const ca = payload.customAnswers as Record<string, string | string[]> | undefined
    if (ca) {
      Object.values(ca).forEach(function(val) {
        var texts = Array.isArray(val) ? val : [val]
        texts.forEach(function(t) {
          if (typeof t === 'string' && t.length > 3) {
            auditContent(t).flags.forEach(function(f) { flagSet[f] = true })
          }
        })
      })
    }

    const allFlags = Object.keys(flagSet)
    if (allFlags.length > 0) {
      rowData.content_flags = allFlags
    }
  }

  // ── Upsert by session_id (partial saves) or insert (legacy) ───────────────
  if (session_id) {
    // Check if this session already has a row
    const { data: existingSession } = await supabase
      .from('responses')
      .select('id, status')
      .eq('session_id', session_id)
      .limit(1)

    if (existingSession && existingSession.length > 0) {
      // Don't overwrite a completed response — insert a new row instead
      if (existingSession[0].status === 'complete') {
        if (isPartial) {
          return NextResponse.json({ success: true, response_id: existingSession[0].id, already_complete: true })
        }
        // New complete submission for same session_id = new response (don't overwrite)
        // Fall through to INSERT below with a fresh session_id
        rowData.session_id = session_id + '_' + Date.now().toString(36)
      } else {
        // Update existing incomplete row
        // For partial saves: add a WHERE guard so a late partial can't overwrite a completed row
        let updateQuery = supabase
          .from('responses')
          .update(rowData)
          .eq('id', existingSession[0].id)

        if (isPartial) {
          // Only update if the row is still incomplete — prevents race condition
          // where a late partial save arrives after the final submit completed the row
          updateQuery = updateQuery.eq('status', 'incomplete')
        }

        const { error: updateError } = await updateQuery

        if (updateError) {
          console.error('Response update error:', updateError)
          return NextResponse.json({ error: 'Failed to update response' }, { status: 500 })
        }

        // Update campaign respondent if this was a final submit via campaign link
        const recipientGuidUpdate = body.recipient_guid
        if (isFinal && recipientGuidUpdate) {
          try {
            await supabase
              .from('campaign_respondents')
              .update({
                status: 'completed',
                completed_at: new Date().toISOString(),
                response_id: existingSession[0].id,
              })
              .eq('recipient_guid', recipientGuidUpdate)
              .in('status', ['pending', 'sent', 'opened', 'clicked'])
          } catch {}
        }

        return NextResponse.json({ success: true, response_id: existingSession[0].id })
      }
    }
  }

  // Insert new row
  const { data: response, error: insertError } = await supabase
    .from('responses')
    .insert(rowData)
    .select('id')
    .single()

  if (insertError) {
    console.error('Response insert error:', insertError)
    return NextResponse.json({ error: 'Failed to save response' }, { status: 500 })
  }

  // ── Update campaign respondent status if this came via a campaign link ─────
  const recipientGuid = body.recipient_guid
  if (isFinal && recipientGuid && response) {
    try {
      await supabase
        .from('campaign_respondents')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          response_id: response.id,
        })
        .eq('recipient_guid', recipientGuid)
        .in('status', ['pending', 'sent', 'opened', 'clicked'])
    } catch {}
  }

  // study_response_stats is maintained LIVE by the responses trigger (sql/174)
  // — no per-submit materialized-view refresh (which scanned every response
  // platform-wide; the QR-burst I/O sink the perf review flagged).

  return NextResponse.json({ success: true, response_id: response.id }, { status: 201 })
}
