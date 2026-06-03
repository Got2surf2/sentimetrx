// lib/pptx/agentStudyDeck.ts
// Flattens an AgentStudy analysis object into a DeckSpec (the leave-behind
// PPTX snapshot). The HTML report page holds the interactive drill-down; this
// is the exec/email artifact. Same analysis object backs both.

import type { AgentStudy } from '@/lib/agentStudy'
import type { DeckSpec, SlideSpec } from './slideRenderer'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function buildStudyDeck(study: AgentStudy): DeckSpec {
  const slides: SlideSpec[] = []
  const t = study.totals

  // 1. Engagement & Depth — vertical column chart (the headline). Chart shows
  // USEFUL conversations only; the initiated-but-not-entered count is a note.
  const depthData = study.depth.map(d => ({ label: d.bucket + ' pair' + (d.bucket === '1' ? '' : 's'), value: d.sessions }))
  const rr = study.health.responseRatePct
  slides.push({
    type: 'column_chart',
    title: 'Engagement & Depth',
    subtitle: 'Useful conversations by exchange count (greeting + one-word taps excluded)',
    xAxisLabel: 'Q&A pairs per conversation',
    data: depthData,
    insight: [
      `${t.conversations} useful conversations · median ${t.medianPairs} pair${t.medianPairs === 1 ? '' : 's'} deep.`,
      `Of ${t.conversations + t.initiatedNotEntered + t.abandonedNoInput + t.flaggedExcluded} sessions recorded: ${t.conversations} useful` +
        (t.initiatedNotEntered > 0 ? `, ${t.initiatedNotEntered} one-word taps only` : '') +
        (t.abandonedNoInput > 0 ? `, ${t.abandonedNoInput} no real message` : '') +
        (t.flaggedExcluded > 0 ? `, ${t.flaggedExcluded} flagged for review (troll/bot/off-topic)` : '') + ' (non-useful excluded).',
      rr != null ? `Response rate ${rr}% (engaged of widget opens).` : '',
    ].filter(Boolean).join(' '),
  })

  // 2. Overview KPIs
  const kpis: { value: string; label: string; sub?: string; color?: string }[] = [
    { value: String(t.totalSessions), label: 'Conversations', sub: 'all sessions', color: '0D2B45' },
    { value: String(t.conversations), label: 'Useful Conversations', sub: 'of ' + t.totalSessions + ' total', color: '0D2B45' },
    { value: String(t.totalPairs), label: 'Q&A Pairs', color: '0F7173' },
    { value: String(study.health.medianPairs), label: 'Median Depth', sub: 'pairs / conversation', color: 'E85A1A' },
    { value: String(study.focuses.length), label: 'Focus Areas Touched', color: '0F7173' },
    { value: String(study.entities.length), label: 'Distinct Entities', color: 'E8B84B' },
    { value: String(study.openQuestions.open.length), label: 'Open Questions', sub: 'validated, awaiting follow-up', color: 'DC2626' },
  ]
  slides.push({
    type: 'kpi_grid',
    title: 'Agent Study Overview',
    subtitle: fmtDate(study.range.first) + ' — ' + fmtDate(study.range.last) + ' · ' + study.range.activeDays + ' active days',
    kpis,
    insight: [
      t.initiatedNotEntered > 0 ? `${t.initiatedNotEntered} conversations were initiated but not entered into (visitor tapped a suggestion or replied with one word).` : '',
      t.impressions != null ? `${t.impressions} total widget opens tracked.` : '',
    ].filter(Boolean).join(' ') || undefined,
  })

  // 3. Activity over time — daily conversations (days with activity, last 14)
  const active = study.health.dailyActivity.filter(d => d.conversations > 0 || d.opens > 0).slice(-14)
  if (active.length > 1) {
    slides.push({
      type: 'column_chart',
      title: 'Activity Over Time',
      subtitle: 'Conversations started per day',
      data: active.map(d => ({ label: d.date.slice(5), value: d.conversations })),
      xAxisLabel: study.totals.impressions ? 'Bars = conversations started' : undefined,
    })
  }

  // 4. Focus distribution
  if (study.focuses.length > 0) {
    slides.push({
      type: 'bar_chart',
      title: 'Areas of Focus',
      subtitle: 'Exchanges by focus area',
      data: study.focuses.map(f => ({ label: f.label, value: f.exchanges })),
    })
  }

  // 5. Focus detail table (entities cross-tab + sentiment)
  if (study.focuses.length > 0) {
    slides.push({
      type: 'table',
      title: 'Focus Areas — Detail',
      subtitle: 'Engagement, top entities, and sentiment per focus',
      columns: ['Focus', 'Exchanges', 'Convos', 'Top entities', 'Pos/Neu/Neg'],
      rows: study.focuses.map(f => [
        f.label,
        String(f.exchanges),
        String(f.sessions),
        f.entities.slice(0, 3).map(e => e.name).join(', ') || '—',
        `${f.sentiment.positive}/${f.sentiment.neutral}/${f.sentiment.negative}`,
      ]),
    })
  }

  // 6. Entity analysis
  if (study.entities.length > 0) {
    slides.push({
      type: 'entity_grid',
      title: 'Entity Analysis',
      subtitle: 'Specific things users named, by mention count',
      entities: study.entities.slice(0, 24).map(e => ({ name: e.name, mentions: e.mentions })),
    })
  }

  // 7. Intents
  const firedIntents = study.intents.filter(i => i.detections > 0)
  if (firedIntents.length > 0) {
    slides.push({
      type: 'bar_chart',
      title: 'Intents Detected',
      subtitle: 'Configured intents, by detections across conversations',
      data: firedIntents.map(i => ({ label: i.label, value: i.detections })),
    })
  }

  // 8. Languages
  if (study.languages.length > 1) {
    slides.push({
      type: 'bar_chart',
      title: 'Conversations by Language',
      subtitle: 'Source language (non-English analyzed on translated text)',
      data: study.languages.slice(0, 8).map(l => ({ label: l.language.toUpperCase(), value: l.sessions })),
    })
  }

  // 9. Open questions — validated + restated (false positives filtered out)
  if (study.openQuestions.open.length > 0) {
    const af = study.openQuestions.autoFiltered
    slides.push({
      type: 'bullets',
      title: 'Open Questions',
      subtitle: 'Genuine questions the agent could not answer — validated, awaiting follow-up',
      bullets: study.openQuestions.open.slice(0, 8).map(q => (q.restated || q.question).slice(0, 170)),
      insight: af > 0 ? `${af} flagged item${af === 1 ? '' : 's'} were auto-filtered as not a real question (acks, one-word replies, shared context).` : undefined,
    })
  }

  // 10. Common questions / knowledge gaps / recommendations
  if (study.insights.commonQuestions.length > 0) {
    slides.push({ type: 'bullets', title: 'Most Common Topics', subtitle: 'What users raised most', bullets: study.insights.commonQuestions.slice(0, 6) })
  }
  if (study.insights.knowledgeGaps.length > 0) {
    slides.push({ type: 'bullets', title: 'Knowledge Gaps', subtitle: 'Where the agent needs more content', bullets: study.insights.knowledgeGaps.slice(0, 5), insight: study.insights.dropOff || undefined })
  }
  if (study.insights.recommendations.length > 0) {
    slides.push({ type: 'bullets', title: 'Recommendations', subtitle: 'Actionable improvements', bullets: study.insights.recommendations.slice(0, 5) })
  }

  // 11. Quotes
  if (study.insights.topQuotes.length > 0) {
    slides.push({ type: 'quotes', title: 'In Their Words', subtitle: 'Representative participant quotes', quotes: study.insights.topQuotes.slice(0, 6).map(q => ({ text: q })) })
  }

  // 12. Methodology
  slides.push({
    type: 'bullets',
    title: 'Methodology & Provenance',
    subtitle: 'How this study was produced',
    bullets: [
      `${study.meta.classifiedExchanges} Q&A pairs classified across ${t.conversations} useful conversations. Excluded: ${t.initiatedNotEntered} initiated-but-not-entered (one-word taps) + ${t.abandonedNoInput} no-input.`,
      'A conversation counts as useful only when the visitor sent a real message (≥3 words or a question); greeting/name preamble and chip taps are stripped.',
      'Each question is tagged to one focus area; its paired answer inherits the same focus.',
      'Open questions are AI-validated — false positives (statements, acks, shared context) are filtered, the rest restated.',
      'Non-English conversations analyzed on translated text; counts reported by source language.',
      study.totals.impressions != null
        ? 'Widget opens tracked via on-mount beacon → true invocation + response-rate.'
        : 'Widget-open beacon active going forward; response rate populates as opens accrue.',
    ],
  })

  return {
    title: study.bot.name + ' — Agent Study',
    subtitle: `${study.totals.conversations} conversations · ${fmtDate(study.range.first)} – ${fmtDate(study.range.last)}`,
    slides,
  }
}
