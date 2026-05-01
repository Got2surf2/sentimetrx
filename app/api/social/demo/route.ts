// app/api/social/demo/route.ts
// POST — generate realistic demo comments for a candidate/org
// DELETE — clear all demo comments

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { callAI } from '@/lib/ai'
import { auditContent } from '@/lib/contentGuard'
import { POSITIVE_WORDS, NEGATIVE_WORDS, NEGATORS } from '@/lib/sentimentLexicon'

export const dynamic = 'force-dynamic'

function scoreSentiment(text: string): 'positive' | 'negative' | 'neutral' {
  const words = text.toLowerCase().replace(/[^a-z\s']/g, '').split(/\s+/)
  let score = 0
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    const negated = i > 0 && NEGATORS.has(words[i - 1])
    if (POSITIVE_WORDS.has(w)) score += negated ? -1 : 1
    else if (NEGATIVE_WORDS.has(w)) score += negated ? 1 : -1
  }
  if (score > 0) return 'positive'
  if (score < 0) return 'negative'
  return 'neutral'
}

async function getAuth(supabase: ReturnType<typeof createClient>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('users').select('org_id, organizations(is_admin_org)').eq('id', user.id).single()
  const org = Array.isArray(data?.organizations) ? data.organizations[0] : data?.organizations
  return { userId: user.id, orgId: data?.org_id as string | null, isAdmin: !!(org as any)?.is_admin_org }
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId || !auth.isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { candidate, context, count = 25 } = await req.json()
  if (!candidate) return NextResponse.json({ error: 'candidate name is required' }, { status: 400 })

  const total = Math.min(count, 50)

  const result = await callAI({
    tier: 'standard',
    maxTokens: 4000,
    timeoutMs: 30000,
    system: `You generate realistic social media comments (Facebook/Instagram) for demo purposes. Generate exactly ${total} comments that would appear on a political candidate's or organization's social media page.

Include a realistic mix:
- 40% supportive/positive comments from genuine supporters
- 20% neutral questions (policy questions, event info, how to help)
- 15% negative but civil criticism (policy disagreements, skepticism)
- 10% trolling/hate (racist remarks, personal attacks, profanity, threats — make these realistic but clearly offensive)
- 10% spam or off-topic (promotions, irrelevant links, random stuff)
- 5% intent signals (want to donate, volunteer, attend events)

Each comment should feel authentic — use casual social media language, typos, emoji, hashtags, varying lengths (some 3 words, some a full paragraph). Include realistic usernames.

Output as JSON array: [{"author": "Display Name", "text": "comment text", "platform": "facebook"|"instagram"}]
Output ONLY the JSON array, nothing else.`,
    messages: [{ role: 'user', content: `Candidate/Org: ${candidate}\nContext: ${context || 'Political campaign, running for office'}\n\nGenerate ${total} realistic comments.` }],
  })

  // Parse the AI response
  let comments: Array<{ author: string; text: string; platform: string }>
  try {
    const jsonMatch = result.text.match(/\[[\s\S]*\]/)
    comments = JSON.parse(jsonMatch?.[0] || '[]')
  } catch {
    return NextResponse.json({ error: 'Failed to parse generated comments' }, { status: 500 })
  }

  if (comments.length === 0) {
    return NextResponse.json({ error: 'No comments generated' }, { status: 500 })
  }

  const service = createServiceRoleClient()

  // Get or create a connection for demo purposes
  let connectionId: string
  const { data: existingConn } = await service
    .from('social_connections')
    .select('id')
    .eq('org_id', auth.orgId)
    .limit(1)
    .single()

  if (existingConn) {
    connectionId = existingConn.id
  } else {
    const { data: newConn } = await service
      .from('social_connections')
      .insert({
        org_id: auth.orgId,
        platform: 'facebook',
        account_id: 'demo_' + auth.orgId,
        account_name: candidate + ' (Demo)',
        access_token: 'demo_token',
        token_expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        connected_by: auth.userId,
      })
      .select('id')
      .single()
    connectionId = newConn?.id || ''
  }

  // Process each comment through content guard + sentiment
  // Assign moderation actions based on severity and content
  const now = new Date()
  let autoHiddenCount = 0
  let autoDeletedCount = 0
  let flaggedForReviewCount = 0

  const rows = comments.map(function(cm, i) {
    const sentiment = scoreSentiment(cm.text)
    const audit = auditContent(cm.text)
    const flags: Array<{ type: string; severity: string | null; action?: string }> = audit.flags.map(f => ({ type: f, severity: audit.maxSeverity }))

    let isHidden = false
    let isDeleted = false

    if (audit.maxSeverity === 'severe') {
      // Threats and slurs → auto-delete
      const hasThreatsOrSlurs = audit.flags.some(f => f === 'threat' || f === 'slur')
      if (hasThreatsOrSlurs) {
        isDeleted = true
        autoDeletedCount++
        flags.push({ type: 'auto_delete', severity: 'severe', action: 'Auto-deleted: threats/slurs' })
      } else {
        // Other severe (profanity, sexual) → auto-hide
        isHidden = true
        autoHiddenCount++
        flags.push({ type: 'auto_hide', severity: 'severe', action: 'Auto-hidden: severe content' })
      }
    } else if (audit.maxSeverity === 'rude') {
      // Rude content → flag for review
      flaggedForReviewCount++
      flags.push({ type: 'review', severity: 'rude', action: 'Flagged for review' })
    }

    // Detect spam patterns
    if (/https?:\/\/|buy now|click here|free money|earn \$/i.test(cm.text)) {
      flags.push({ type: 'spam', severity: 'moderate', action: 'Auto-hidden: spam detected' })
      if (!isHidden && !isDeleted) { isHidden = true; autoHiddenCount++ }
    }

    // Detect competitor mentions
    if (/competitor|qualtrics|surveymonkey|typeform|medallia/i.test(cm.text)) {
      flags.push({ type: 'competitor', severity: null, action: 'Competitor mention detected' })
    }

    // Detect intent signals
    if (/donat|volunteer|sign up|join|help|contribute|campaign/i.test(cm.text)) {
      flags.push({ type: 'intent', severity: null, action: 'Engagement signal detected' })
    }

    // Spread comments over the last 24 hours
    const minutesAgo = Math.floor((i / comments.length) * 24 * 60)
    const ts = new Date(now.getTime() - minutesAgo * 60000).toISOString()

    return {
      org_id: auth.orgId,
      connection_id: connectionId,
      platform: cm.platform || (i % 3 === 0 ? 'instagram' : 'facebook'),
      post_id: 'demo_post_' + candidate.toLowerCase().replace(/\s+/g, '_'),
      post_text: candidate + ' — Campaign Update',
      comment_id: 'demo_' + Date.now() + '_' + i,
      author_name: cm.author,
      author_id: 'demo_user_' + i,
      text: cm.text,
      sentiment,
      flags,
      is_hidden: isHidden,
      is_deleted: isDeleted,
      is_reply: false,
      platform_created_at: ts,
    }
  })

  const { error } = await service.from('social_comments').insert(rows)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const flagged = rows.filter(r => r.flags.length > 0).length

  return NextResponse.json({
    generated: rows.length,
    flagged,
    autoHidden: autoHiddenCount,
    autoDeleted: autoDeletedCount,
    flaggedForReview: flaggedForReviewCount,
    sentiment: {
      positive: rows.filter(r => r.sentiment === 'positive').length,
      negative: rows.filter(r => r.sentiment === 'negative').length,
      neutral: rows.filter(r => r.sentiment === 'neutral').length,
    },
  })
}

export async function DELETE(req: NextRequest) {
  const supabase = createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId || !auth.isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()

  // Delete demo comments (comment_id starts with demo_ or test_comment_)
  const { data: deleted } = await service
    .from('social_comments')
    .delete()
    .eq('org_id', auth.orgId)
    .or('comment_id.like.demo_%,comment_id.like.test_comment_%')
    .select('id')

  return NextResponse.json({ deleted: deleted?.length || 0 })
}
