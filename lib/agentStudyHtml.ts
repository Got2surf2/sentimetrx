// lib/agentStudyHtml.ts
//
// Point-in-time HTML bake of an Agent Study. Pure function — takes the same
// AgentStudy object the report page and PPTX export consume, and emits a
// self-contained, inline-styled HTML document. No React, no fetch, no client
// JS: drill-downs use native <details>/<summary> so the whole thing renders
// inside the sandboxed (script-disabled) iframe of /shared/agent-study/[token].
//
// This mirrors app/bots/[id]/report/ReportClient.tsx section-for-section so the
// shared snapshot reads identically to the live report — it's just frozen at
// share time. Every piece of user/agent-derived text is escaped.

import type { AgentStudy } from '@/lib/agentStudy'

const TEAL = '#0F7173'
const INK = '#111827'
const MUTE = '#6b7280'
const DOT_COLOR: Record<string, string> = { green: '#059669', amber: '#D97706', red: '#DC2626', idle: '#9CA3AF' }

function esc(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtRel(iso: string | null): string {
  if (!iso) return 'never'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return days + 'd ago'
  return fmtDate(iso)
}

const CARD = 'background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:18px 20px;margin-bottom:16px'
const H2 = 'font-size:15px;font-weight:700;color:' + INK + ';margin:0 0 12px'

// A flex-1 progress bar matching ReportClient's <Bar>.
function bar(value: number, max: number, color: string = TEAL): string {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return '<div style="height:8px;background:#F1F3F5;border-radius:6px;overflow:hidden;flex:1">'
    + '<div style="width:' + pct + '%;height:100%;background:' + color + ';border-radius:6px"></div></div>'
}

export function renderAgentStudyHtml(study: AgentStudy): string {
  const s = study
  const t = s.totals
  const botUpper = esc(s.bot.name.toUpperCase().slice(0, 8))

  const parts: string[] = []

  // ── Header ──
  parts.push(
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">'
    + '<span style="width:12px;height:12px;border-radius:50%;background:' + (DOT_COLOR[s.health.dot] || DOT_COLOR.idle) + ';flex-shrink:0"></span>'
    + '<div><h1 style="font-size:22px;font-weight:700;color:' + INK + ';margin:0">' + esc(s.bot.name) + ' — Agent Study</h1>'
    + '<p style="font-size:12px;color:' + MUTE + ';margin:2px 0 0">' + fmtDate(s.range.first) + ' – ' + fmtDate(s.range.last)
    + ' · ' + s.range.activeDays + ' active days · last active ' + fmtRel(s.health.lastActiveAt) + '</p></div></div>'
  )

  // ── Overview KPIs ──
  // Hide opens/response-rate until the beacon has real coverage (see ReportClient).
  const showOpens = t.impressions != null && t.impressions >= t.totalSessions
  const kpis: { v: string | number; l: string; sub?: string; color?: string }[] = [
    { v: t.totalSessions, l: 'Conversations', sub: 'all sessions' },
    { v: t.conversations, l: 'Useful Conversations', sub: 'of ' + t.totalSessions + ' total' },
    ...(t.answerRatePct != null ? [{ v: t.answerRatePct + '%', l: 'Answer Rate', sub: t.answeredPairs + ' of ' + t.totalPairs + ' answered', color: '#059669' }] : []),
    { v: t.totalPairs, l: 'Q&A Pairs' },
    { v: s.health.medianPairs, l: 'Median Depth', sub: 'pairs' },
    { v: s.openQuestions.open.length, l: 'Open Questions', sub: 'unanswered', color: s.openQuestions.open.length > 0 ? '#DC2626' : INK },
    ...(showOpens ? [
      { v: s.health.responseRatePct != null ? s.health.responseRatePct + '%' : '—', l: 'Response Rate', sub: s.health.responseRatePct != null ? 'engaged of opens (7d)' : 'gathering open data' },
      { v: t.impressions as number, l: 'Widget Opens' },
    ] : []),
  ]
  parts.push(
    '<div style="' + CARD + '"><div style="' + H2 + '">Overview</div>'
    + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px">'
    + kpis.map(k =>
        '<div style="background:#F9FAFB;border-radius:10px;padding:12px 14px">'
        + '<div style="font-size:24px;font-weight:700;color:' + (k.color || INK) + '">' + esc(String(k.v)) + '</div>'
        + '<div style="font-size:12px;font-weight:600;color:#374151;margin-top:2px">' + esc(k.l) + '</div>'
        + (k.sub ? '<div style="font-size:10px;color:' + MUTE + '">' + esc(k.sub) + '</div>' : '')
        + '</div>'
      ).join('')
    + '</div></div>'
  )

  // ── Engagement & Depth ──
  const depthMax = Math.max(...s.depth.map(d => d.sessions), t.abandonedNoInput, t.openedNotEngaged || 0, 1)
  let depthBlock = '<div style="' + CARD + '"><div style="' + H2 + '">Engagement &amp; Depth</div>'
    + '<p style="font-size:12px;color:' + MUTE + ';margin:0 0 12px">Useful conversations by Q&amp;A-pair count (greeting preamble + one-word taps excluded).</p>'
  depthBlock += s.depth.map(d =>
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">'
    + '<span style="width:84px;font-size:12px;color:#374151;text-align:right">' + esc(d.bucket) + ' pair' + (d.bucket === '1' ? '' : 's') + '</span>'
    + bar(d.sessions, depthMax)
    + '<span style="width:32px;font-size:12px;font-weight:600;color:' + INK + '">' + d.sessions + '</span></div>'
  ).join('')
  if (t.initiatedNotEntered > 0 || t.abandonedNoInput > 0 || t.flaggedExcluded > 0 || (t.openedNotEngaged ?? 0) > 0) {
    const recorded = t.conversations + t.initiatedNotEntered + t.abandonedNoInput + t.flaggedExcluded
    let note = '<div style="margin-top:12px;padding-top:10px;border-top:1px dashed #e5e7eb;font-size:11px;color:' + MUTE + ';line-height:1.5">'
      + '<strong>' + recorded + '</strong> sessions recorded: <strong>' + t.conversations + '</strong> useful'
    if (t.initiatedNotEntered > 0) note += ' · <strong>' + t.initiatedNotEntered + '</strong> initiated but one-word only (tapped a suggestion / replied "yes")'
    if (t.abandonedNoInput > 0) note += ' · <strong>' + t.abandonedNoInput + '</strong> with no real message (e.g. opened, switched language, never typed)'
    if (t.flaggedExcluded > 0) note += ' · <strong>' + t.flaggedExcluded + '</strong> flagged for review (troll / bot / off-topic) — kept in the database, out of the report'
    note += '. The non-useful groups are excluded from analysis.'
    if (t.openedNotEngaged != null && t.openedNotEngaged > 0) note += ' Separately, <strong>' + t.openedNotEngaged + '</strong> widget open' + (t.openedNotEngaged !== 1 ? 's' : '') + ' never became a conversation at all.'
    note += '</div>'
    depthBlock += note
  }
  depthBlock += '</div>'
  parts.push(depthBlock)

  // ── Activity Over Time ──
  const dailyActive = s.health.dailyActivity.filter(d => d.conversations > 0 || d.opens > 0).slice(-21)
  if (dailyActive.length > 1) {
    const dailyMax = Math.max(...dailyActive.map(d => Math.max(d.conversations, d.opens)), 1)
    // Bar width scales to the number of days (fat when few, capped when many).
    const barW = Math.max(12, Math.min(40, Math.round(560 / dailyActive.length)))
    const opensW = Math.max(6, Math.round(barW * 0.5))
    let chart = '<div style="' + CARD + '"><div style="' + H2 + '">Activity Over Time</div>'
      + '<div style="display:flex;align-items:flex-end;gap:6px;height:120px;padding:8px 0">'
    chart += dailyActive.map(d => {
      const opensBar = showOpens
        ? '<div style="width:' + opensW + 'px;height:' + Math.round((d.opens / dailyMax) * 90) + 'px;background:#D7E3E3;border-radius:3px"></div>'
        : ''
      const convBar = '<div style="width:' + barW + 'px;height:' + Math.max(2, Math.round((d.conversations / dailyMax) * 90)) + 'px;background:' + TEAL + ';border-radius:3px"></div>'
      return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px" title="' + esc(d.date) + ': ' + d.conversations + ' conversations' + (showOpens ? ', ' + d.opens + ' opens' : '') + '">'
        + '<div style="width:100%;display:flex;align-items:flex-end;justify-content:center;gap:3px;height:90px">' + opensBar + convBar + '</div>'
        + '<span style="font-size:9px;color:' + MUTE + '">' + esc(d.date.slice(5)) + '</span></div>'
    }).join('')
    chart += '</div><div style="font-size:10px;color:' + MUTE + '">' + (showOpens ? 'Teal = conversations · light = widget opens' : 'Conversations started per day') + '</div></div>'
    parts.push(chart)
  }

  // ── Areas of Focus ──
  if (s.focuses.length > 0) {
    const focusMax = Math.max(...s.focuses.map(f => f.exchanges), 1)
    let block = '<div style="' + CARD + '"><div style="' + H2 + '">Areas of Focus</div>'
      + '<p style="font-size:12px;color:' + MUTE + ';margin:0 0 12px">Each question is tagged to one focus; its paired answer carries the same focus. Expand to read real exchanges.</p>'
    block += s.focuses.map(f => {
      let det = '<details style="border-bottom:1px solid #f3f4f6;padding:8px 0">'
        + '<summary style="cursor:pointer;display:flex;align-items:center;gap:12px;list-style:none">'
        + '<span style="width:200px;font-size:13px;font-weight:600;color:' + INK + '">' + esc(f.label) + '</span>'
        + bar(f.exchanges, focusMax)
        + '<span style="width:80px;font-size:11px;color:' + MUTE + ';text-align:right">' + f.exchanges + ' · ' + f.sessions + ' conv</span>'
        + '<span style="font-size:10px;display:flex;gap:4px">'
        + '<span style="color:#059669">+' + f.sentiment.positive + '</span>'
        + '<span style="color:' + MUTE + '">' + f.sentiment.neutral + '</span>'
        + '<span style="color:#DC2626">−' + f.sentiment.negative + '</span></span></summary>'
        + '<div style="padding-left:12px;margin-top:8px">'
      if (f.entities.length > 0) {
        det += '<div style="font-size:11px;color:' + MUTE + ';margin-bottom:8px">Entities here: ' + esc(f.entities.map(e => e.name + ' (' + e.mentions + ')').join(', ')) + '</div>'
      }
      det += f.samples.map(sm =>
        '<div style="margin-bottom:10px">'
        + '<div style="display:flex;gap:6px">'
        + '<span style="font-size:9px;font-weight:700;color:#0369A1;background:#E0F2FE;padding:1px 6px;border-radius:6px;height:fit-content;flex-shrink:0">USER' + (sm.language !== 'en' ? ' · ' + esc(sm.language) : '') + '</span>'
        + '<span style="font-size:12px;color:' + INK + '">' + esc(sm.question) + '</span></div>'
        + (sm.answer
            ? '<div style="display:flex;gap:6px;margin-top:3px"><span style="font-size:9px;font-weight:700;color:#374151;background:#F3F4F6;padding:1px 6px;border-radius:6px;height:fit-content;flex-shrink:0">' + botUpper + '</span><span style="font-size:12px;color:#374151">' + esc(sm.answer) + '</span></div>'
            : '')
        + '</div>'
      ).join('')
      det += '</div></details>'
      return det
    }).join('')
    block += '</div>'
    parts.push(block)
  }

  // ── Entity Analysis ──
  if (s.entities.length > 0) {
    const entMax = Math.max(...s.entities.map(e => e.mentions), 1)
    let block = '<div style="' + CARD + '"><div style="' + H2 + '">Entity Analysis</div>'
      + '<p style="font-size:12px;color:' + MUTE + ';margin:0 0 12px">Specific things users named — by mention count, with the focus areas they came up under.</p>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px">'
    block += s.entities.slice(0, 24).map(e =>
      '<div style="display:flex;align-items:center;gap:8px;background:#F9FAFB;border-radius:8px;padding:6px 10px">'
      + '<span style="flex:1;font-size:12px;font-weight:600;color:' + INK + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(e.focuses.join(', ')) + '">' + esc(e.name) + '</span>'
      + bar(e.mentions, entMax)
      + '<span style="width:24px;font-size:12px;font-weight:700;color:' + TEAL + ';text-align:right">' + e.mentions + '</span></div>'
    ).join('')
    block += '</div></div>'
    parts.push(block)
  }

  // ── Intents + Languages (side by side) ──
  const hasIntents = s.intents.some(i => i.detections > 0)
  const hasLangs = s.languages.length > 1
  if (hasIntents || hasLangs) {
    let row = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px">'
    if (hasIntents) {
      const intentMax = Math.max(...s.intents.map(i => i.detections), 1)
      row += '<div style="' + CARD + '"><div style="' + H2 + '">Intents Detected</div>'
        + s.intents.filter(i => i.detections > 0).map(i =>
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">'
            + '<span style="width:120px;font-size:12px;color:#374151">' + esc(i.label) + '</span>'
            + bar(i.detections, intentMax, '#1D4ED8')
            + '<span style="width:70px;font-size:11px;color:' + MUTE + ';text-align:right">' + i.detections + ' · ' + i.sessions + ' conv</span></div>'
          ).join('')
        + '</div>'
    }
    if (hasLangs) {
      const langMax = Math.max(...s.languages.map(l => l.sessions), 1)
      row += '<div style="' + CARD + '"><div style="' + H2 + '">Conversations by Language</div>'
        + '<p style="font-size:11px;color:' + MUTE + ';margin:0 0 10px">Non-English analyzed on translated text.</p>'
        + s.languages.map(l =>
            '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">'
            + '<span style="width:50px;font-size:12px;font-weight:600;color:#374151">' + esc(l.language.toUpperCase()) + '</span>'
            + bar(l.sessions, langMax, '#E8B84B')
            + '<span style="width:70px;font-size:11px;color:' + MUTE + ';text-align:right">' + l.sessions + ' · ' + l.pct + '%</span></div>'
          ).join('')
        + '</div>'
    }
    row += '</div>'
    parts.push(row)
  }

  // ── Open Questions ──
  if (s.openQuestions.open.length > 0 || s.openQuestions.autoFiltered > 0) {
    let block = '<div style="' + CARD + '"><div style="' + H2 + '">Open Questions <span style="font-size:12px;font-weight:400;color:' + MUTE + '">(' + s.openQuestions.open.length + ' validated)</span></div>'
      + '<p style="font-size:12px;color:' + MUTE + ';margin:0 0 12px">Genuine questions the agent couldn&rsquo;t answer — AI-validated, restated, with the conversation context. Expand each for the full exchange.</p>'
    block += s.openQuestions.open.map(q => {
      let det = '<details style="border-bottom:1px solid #f3f4f6;padding:8px 0">'
        + '<summary style="cursor:pointer;display:flex;align-items:center;gap:8px;list-style:none">'
        + '<span style="font-size:9px;font-weight:700;color:#92400E;background:#FEF3C7;padding:1px 6px;border-radius:6px;flex-shrink:0">' + esc(q.classification.replace(/_/g, ' ')) + '</span>'
        + '<span style="font-size:13px;color:' + INK + '">' + esc(q.restated || q.question) + '</span></summary>'
        + '<div style="padding-left:12px;margin-top:6px;font-size:12px;color:' + MUTE + ';line-height:1.5">'
      if (q.context) det += '<div style="margin-bottom:4px"><span style="font-size:9px;font-weight:700;color:#374151;background:#F3F4F6;padding:1px 6px;border-radius:6px">' + botUpper + ' BEFORE</span> <span style="color:#374151">' + esc(q.context.slice(0, 240)) + '</span></div>'
      det += '<div style="margin-bottom:4px"><span style="font-size:9px;font-weight:700;color:#0369A1;background:#E0F2FE;padding:1px 6px;border-radius:6px">USER' + (q.language && q.language !== 'en' ? ' · ' + esc(q.language) : '') + '</span> <span style="color:#374151">' + esc(q.question) + '</span></div>'
      if (q.after) det += '<div style="margin-bottom:4px"><span style="font-size:9px;font-weight:700;color:#374151;background:#F3F4F6;padding:1px 6px;border-radius:6px">' + botUpper + ' AFTER</span> <span style="color:#374151">' + esc(q.after.slice(0, 280)) + '</span></div>'
      det += 'Logged ' + fmtRel(q.createdAt)
      if (q.suggestedKb) det += '<div style="margin-top:4px;color:#374151"><strong>Suggested KB addition:</strong> ' + esc(q.suggestedKb) + '</div>'
      det += '</div></details>'
      return det
    }).join('')
    if (s.openQuestions.autoFiltered > 0) {
      block += '<div style="margin-top:10px;font-size:11px;color:' + MUTE + '"><strong>' + s.openQuestions.autoFiltered + '</strong> flagged item'
        + (s.openQuestions.autoFiltered !== 1 ? 's were' : ' was') + ' auto-filtered as not a real question (acks, one-word replies, shared context)'
        + (s.openQuestions.filteredExamples.length > 0 ? ' — e.g. ' + s.openQuestions.filteredExamples.map(f => '“' + esc(f.question.slice(0, 40)) + '”').join(', ') : '')
        + '.</div>'
    }
    block += '</div>'
    parts.push(block)
  }

  // ── Insights (common / gaps / recs) ──
  const insightBlocks = [
    { title: 'Most Common Topics', items: s.insights.commonQuestions },
    { title: 'Knowledge Gaps', items: s.insights.knowledgeGaps },
    { title: 'Recommendations', items: s.insights.recommendations },
  ].filter(b => b.items.length > 0)
  if (insightBlocks.length > 0) {
    let row = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px">'
    row += insightBlocks.map(b =>
      '<div style="' + CARD + '"><div style="' + H2 + '">' + esc(b.title) + '</div>'
      + '<ul style="margin:0;padding-left:18px">' + b.items.map(it => '<li style="font-size:12px;color:#374151;margin-bottom:6px;line-height:1.5">' + esc(it) + '</li>').join('') + '</ul></div>'
    ).join('')
    row += '</div>'
    parts.push(row)
  }

  // ── Quotes ──
  if (s.insights.topQuotes.length > 0) {
    let block = '<div style="' + CARD + '"><div style="' + H2 + '">In Their Words</div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px">'
    block += s.insights.topQuotes.map(q =>
      '<div style="border-left:3px solid ' + TEAL + ';padding-left:12px;font-size:12px;color:#374151;font-style:italic;line-height:1.5">&ldquo;' + esc(q) + '&rdquo;</div>'
    ).join('')
    block += '</div></div>'
    parts.push(block)
  }

  // ── Methodology ──
  parts.push(
    '<div style="' + CARD + ';background:#F9FAFB"><div style="' + H2 + '">Methodology &amp; Provenance</div>'
    + '<ul style="margin:0;padding-left:18px;font-size:11px;color:' + MUTE + '">'
    + '<li style="margin-bottom:4px">' + s.meta.classifiedExchanges + ' Q&amp;A pairs classified; ' + s.meta.excludedZeroPair + ' input-less session(s) excluded.</li>'
    + '<li style="margin-bottom:4px">' + esc(s.meta.method) + '</li>'
    + '<li style="margin-bottom:4px">' + (showOpens ? 'Widget opens tracked via on-mount beacon → true invocation + response rate.' : 'Widget-open beacon active going forward; response rate populates as opens accrue.') + '</li>'
    + '<li>Snapshot generated ' + fmtDate(s.generatedAt) + '.</li>'
    + '</ul></div>'
  )

  // ── Footer ──
  parts.push(
    '<div style="text-align:center;font-size:12px;color:#9ca3af;margin-top:24px">'
    + 'Powered by <span style="color:#E8632A;font-weight:600">sentimetrx.ai</span> — to learn more go to '
    + '<a href="https://www.datanautix.com" target="_blank" rel="noopener noreferrer" style="color:#E8632A;font-weight:600;text-decoration:underline">datanautix.com</a></div>'
  )

  return '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + esc(s.bot.name) + ' — Agent Study</title>'
    + '<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f3f4f6;margin:0}'
    + 'details summary::-webkit-details-marker{display:none}</style></head>'
    + '<body><div style="max-width:1000px;margin:0 auto;padding:28px 24px 64px">'
    + parts.join('')
    + '</div></body></html>'
}
