// app/api/social/comments/[id]/ai-reply/route.ts
// POST — generate AI reply using agent engine, then post to platform

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { callAI } from '@/lib/ai'

export const dynamic = 'force-dynamic'

async function getAuth(supabase: ReturnType<typeof createClient>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  return { userId: user.id, orgId: data?.org_id as string | null }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const autoPost = body.autoPost !== false // default: post to platform

  const service = createServiceRoleClient()

  // Get the comment
  const { data: comment } = await service
    .from('social_comments')
    .select('*, social_connections(access_token, account_name)')
    .eq('id', params.id)
    .eq('org_id', auth.orgId)
    .single()

  if (!comment) return NextResponse.json({ error: 'Comment not found' }, { status: 404 })

  // Look for an agent (bot) linked to this org to use its personality/guardrails
  const { data: bot } = await service
    .from('bots')
    .select('id, name, config, system_prompt')
    .eq('org_id', auth.orgId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .single()

  // Build system prompt
  const systemParts: string[] = []
  systemParts.push('You are a social media manager replying to a comment on ' + comment.platform + '.')
  systemParts.push('Keep replies concise (1-3 sentences), friendly, and on-brand.')
  systemParts.push('Never be defensive or argumentative. Be helpful and warm.')

  if (bot) {
    const config = bot.config as any
    if (config?.personality) systemParts.push('PERSONALITY:\n' + config.personality)
    if (bot.system_prompt) systemParts.push(bot.system_prompt)
    if (Array.isArray(config?.guardrails) && config.guardrails.length > 0) {
      const rules = config.guardrails.map((g: any, i: number) => (i + 1) + '. ' + (typeof g === 'string' ? g : g.rule)).join('\n')
      systemParts.push('\nRULES:\n' + rules)
    }
  }

  if (comment.post_text) {
    systemParts.push('\nORIGINAL POST:\n' + comment.post_text)
  }

  const result = await callAI({
    tier: 'fast',
    maxTokens: 200,
    timeoutMs: 15000,
    system: systemParts.join('\n'),
    messages: [{ role: 'user', content: 'Reply to this comment: "' + comment.text + '"' }],
  })

  const replyText = result.text.trim()

  // Optionally post to platform
  if (autoPost) {
    const token = (comment as any).social_connections?.access_token
    if (token) {
      const res = await fetch(`https://graph.facebook.com/v19.0/${comment.comment_id}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: replyText, access_token: token }),
      })
      if (!res.ok) {
        console.error('[social/ai-reply] Meta API error:', await res.text())
        // Still return the generated text even if posting failed
        return NextResponse.json({ reply: replyText, posted: false, error: 'Failed to post to platform' })
      }

      await service
        .from('social_comments')
        .update({ our_reply: replyText, replied_at: new Date().toISOString() })
        .eq('id', params.id)
    }
  }

  await service.from('social_moderation_log').insert({
    org_id: auth.orgId,
    comment_id: params.id,
    action: 'ai_reply',
    reply_text: replyText,
    performed_by: auth.userId,
  })

  return NextResponse.json({ reply: replyText, posted: autoPost })
}
