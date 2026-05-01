// app/api/social/demo/route.ts
// POST — generate realistic demo comments for a candidate/org
// DELETE — clear all demo comments

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { callAI } from '@/lib/ai'
import { tagComment } from '@/lib/socialTagging'

export const dynamic = 'force-dynamic'

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

  const { candidate, context, postText: userPostText, count = 25 } = await req.json()
  if (!candidate) return NextResponse.json({ error: 'candidate name is required' }, { status: 400 })

  const total = Math.min(count, 50)
  const service = createServiceRoleClient()

  // Auto-clear previous demo data before generating new
  await service.from('social_comments').delete().eq('org_id', auth.orgId).like('comment_id', 'demo_%')
  await service.from('social_comments').delete().eq('org_id', auth.orgId).like('comment_id', 'test_comment_%')

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
    messages: [{ role: 'user', content: `Candidate/Org: ${candidate}\nContext: ${context || 'Political campaign, running for office'}${userPostText ? '\nOriginal Post: "' + userPostText + '"' : ''}\n\nGenerate ${total} realistic comments${userPostText ? ' responding to that specific post' : ''}.` }],
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

  // Inject hardcoded offensive comments to guarantee content guard flags fire
  // AI self-censors so these ensure the demo shows auto-hide and auto-delete in action
  const offensiveInjections = [
    { author: 'TrollMaster420', text: 'fuck off nobody wants you in office you piece of shit', platform: 'facebook' },
    { author: 'AngryVoter99', text: 'kill yourself you worthless corrupt politician', platform: 'facebook' },
    { author: 'HateAccount', text: 'go back where you came from you stupid bitch', platform: 'instagram' },
    { author: 'SpamBot3000', text: 'CLICK HERE for FREE MONEY https://scam-site.com/earn-cash-now BUY NOW!!!', platform: 'facebook' },
    { author: 'EdgeLord', text: 'shut up you dumbass nobody gives a crap about your policies idiot', platform: 'instagram' },
    { author: 'ToxicUser', text: 'what a retarded idea from a retarded person lmao', platform: 'facebook' },
  ]
  // Replace the last N AI-generated comments with offensive ones
  const injectCount = Math.min(offensiveInjections.length, Math.floor(comments.length * 0.25))
  for (let i = 0; i < injectCount; i++) {
    comments[comments.length - 1 - i] = offensiveInjections[i]
  }

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

  // Process each comment through the shared tagging pipeline
  const now = new Date()
  const demoPostText = userPostText || (candidate + ' — Campaign Update')
  let autoHiddenCount = 0
  let autoDeletedCount = 0
  let flaggedForReviewCount = 0

  const rows = comments.map(function(cm, i) {
    const tagged = tagComment(cm.text, demoPostText)
    if (tagged.isDeleted) autoDeletedCount++
    if (tagged.isHidden) autoHiddenCount++
    if (tagged.flags.some(function(f) { return f.type === 'review' })) flaggedForReviewCount++

    // Spread comments over the last 24 hours
    const minutesAgo = Math.floor((i / comments.length) * 24 * 60)
    const ts = new Date(now.getTime() - minutesAgo * 60000).toISOString()

    return {
      org_id: auth.orgId,
      connection_id: connectionId,
      platform: cm.platform || (i % 3 === 0 ? 'instagram' : 'facebook'),
      post_id: 'demo_post_' + candidate.toLowerCase().replace(/\s+/g, '_'),
      post_text: demoPostText,
      comment_id: 'demo_' + Date.now() + '_' + i,
      author_name: cm.author,
      author_id: 'demo_user_' + i,
      text: cm.text,
      sentiment: tagged.sentiment,
      flags: tagged.flags,
      is_hidden: tagged.isHidden,
      is_deleted: tagged.isDeleted,
      is_reply: false,
      platform_created_at: ts,
    }
  })

  // Insert comments and log moderation actions for each flagged one
  const { data: inserted, error } = await service.from('social_comments').insert(rows).select('id, comment_id, flags, is_hidden, is_deleted')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Create moderation log entries for auto-actioned comments
  const modLogs: Array<{ org_id: string; comment_id: string; action: string; reply_text: string | null; performed_by: string | null }> = []
  for (const row of (inserted || [])) {
    const rowFlags = row.flags as any[]
    if (row.is_deleted) {
      modLogs.push({ org_id: auth.orgId, comment_id: row.id, action: 'delete', reply_text: 'Auto-deleted: threats/slurs detected', performed_by: null })
    } else if (row.is_hidden) {
      modLogs.push({ org_id: auth.orgId, comment_id: row.id, action: 'hide', reply_text: 'Auto-hidden: severe content or spam', performed_by: null })
    }
    // Log review flags too
    if (Array.isArray(rowFlags) && rowFlags.some((f: any) => f.type === 'review')) {
      modLogs.push({ org_id: auth.orgId, comment_id: row.id, action: 'hide', reply_text: 'Flagged for human review', performed_by: null })
    }
  }
  if (modLogs.length > 0) {
    await service.from('social_moderation_log').insert(modLogs)
  }

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
  const { data: d1 } = await service
    .from('social_comments')
    .delete()
    .eq('org_id', auth.orgId)
    .like('comment_id', 'demo_%')
    .select('id')

  const { data: d2 } = await service
    .from('social_comments')
    .delete()
    .eq('org_id', auth.orgId)
    .like('comment_id', 'test_comment_%')
    .select('id')

  return NextResponse.json({ deleted: (d1?.length || 0) + (d2?.length || 0) })
}
