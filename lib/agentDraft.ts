// lib/agentDraft.ts
// Shared "draft a suggested answer from the agent's own knowledge" helper, used
// by BOTH the admin question-review route and the public client-review page so
// the grounding + no-fabrication prompt never drift. Grounded ONLY in the agent's
// system prompt + KB full-text chunks (no embedding needed); if the knowledge
// doesn't cover it, it drafts an honest "we don't have that / next step" rather
// than inventing specifics.

import type { SupabaseClient } from '@supabase/supabase-js'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'

export async function draftAnswerFromKB(
  service: SupabaseClient,
  bot: { id: string; org_id: string; name: string; system_prompt: string | null },
  questionText: string,
  agentReply = '',
  opts: { asyncReply?: boolean } = {},
): Promise<string> {
  let kb = ''
  try {
    const { data: chunks } = await service.rpc('search_knowledge_chunks', { p_bot_id: bot.id, p_query: questionText, p_limit: 4 })
    kb = ((chunks || []) as { title: string; content: string }[]).map(c => `- ${c.title}: ${c.content}`).join('\n').slice(0, 4000)
  } catch { /* RPC absent / no chunks → system prompt alone */ }

  const knowledge = [(bot.system_prompt || '').slice(0, 8000), kb].filter(s => s && s.trim()).join('\n\n---\n\n')

  // Async submissions (website comment cards / forms) are one-way — the submitter
  // isn't in a live chat to answer back — so the reply must be complete and must
  // not pose a follow-up question to them.
  const asyncRule = opts.asyncReply
    ? `\nThis was submitted via a website comment card / form — it is a ONE-WAY submission. The person is NOT in a conversation and CANNOT answer you back. Therefore:
- Your reply MUST NOT contain ANY question directed at the submitter — no clarifying questions, no "could you…", "would you…", "can you tell us…". Never end with a question mark aimed at them.
- If the submission is general commentary or feedback rather than a question, do NOT turn it into a Q&A. Acknowledge their input, confirm it has been recorded for the team, add any directly relevant information from the knowledge, and stop.
- Write in complete, final statements addressed courteously to the person.`
    : ''
  const system = `You are drafting a SUGGESTED answer for a human reviewer to approve or edit — it is NOT sent to anyone directly. Write the answer the agent "${bot.name}" should give to the visitor's question next time: concise, plain, factual, in the agent's voice.
GROUND IT ONLY in the agent knowledge below. Do NOT invent facts, numbers, hours, dates, names, URLs, prices, or policies that aren't in the knowledge. If the knowledge does not contain the answer, draft a short honest response that acknowledges what isn't available and points the visitor to a reasonable next step — never fabricate specifics.${asyncRule}
Return ONLY the drafted answer text — no preamble, no quotes, no "Draft:" label.

AGENT KNOWLEDGE:
${knowledge || '(no agent knowledge available)'}`

  const userContent = `Visitor asked: ${questionText}\n\nThe agent previously replied (flagged as inadequate): ${agentReply || '(no reply captured)'}`

  const res = await callAI({ tier: 'standard', maxTokens: 500, timeoutMs: 30000, system, messages: [{ role: 'user', content: userContent }] })
  logUsage({ org_id: bot.org_id, resource_type: 'bot', resource_id: bot.id, event_type: 'question_answer_draft' }, res.usage)
  return res.text.trim()
}
