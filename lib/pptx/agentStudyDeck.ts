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

  // 1. Engagement & Depth — vertical column chart (the headline)
  const depthData = study.depth.map(d => ({ label: d.bucket + (d.bucket === '10+' ? '' : '') + ' pair' + (d.bucket === '1' ? '' : 's'), value: d.sessions }))
  if (t.abandonedNoInput > 0) depthData.push({ label: 'No input', value: t.abandonedNoInput, muted: true } as any)
  if (t.openedNotEngaged != null && t.openedNotEngaged > 0) depthData.push({ label: 'Opened, left', value: t.openedNotEngaged, muted: true } as any)
  const rr = study.health.responseRatePct
  slides.push({
    type: 'column_chart',
    title: 'Engagement & Depth',
    subtitle: 'Conversations by exchange count (greeting preamble excluded)',
    xAxisLabel: 'Q&A pairs per conversation',
    data: depthData,
    insight: [
      `${t.conversations} analyzable conversations · median ${t.medianPairs} pair${t.medianPairs === 1 ? '' : 's'} deep.`,
      rr != null ? `Response rate ${rr}% (engaged of widget opens).` : 'Open→engage response rate available once the widget beacon collects data.',
      t.abandonedNoInput > 0 ? `${t.abandonedNoInput} opened but never engaged (excluded from analysis).` : '',
    ].filter(Boolean).join(' '),
  })

  // 2. Overview KPIs
  const kpis: { value: string; label: string; sub?: string; color?: string }[] = [
    { value: String(t.conversations), label: 'Conversations', color: '0D2B45' },
    { value: String(t.totalPairs), label: 'Q&A Pairs', color: '0F7173' },
    { value: String(study.health.medianPairs), label: 'Median Depth', sub: 'pairs / conversation', color: 'E85A1A' },
    { value: String(study.focuses.length), label: 'Focus Areas Touched', color: '0F7173' },
    { value: String(study.entities.length), label: 'Distinct Entities', color: 'E8B84B' },
    { value: String(study.health.openQuestions), label: 'Open Questions', sub: 'awaiting follow-up', color: 'DC2626' },
  ]
  slides.push({
    type: 'kpi_grid',
    title: 'Agent Study Overview',
    subtitle: fmtDate(study.range.first) + ' — ' + fmtDate(study.range.last) + ' · ' + study.range.activeDays + ' active days',
    kpis,
    insight: t.impressions != null ? `${t.impressions} total widget opens tracked.` : undefined,
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

  // 9. Open questions
  if (study.openQuestions.open.length > 0) {
    const classBreak = study.openQuestions.byClassification.map(c => `${c.count} ${c.classification.replace(/_/g, ' ')}`).join(' · ')
    slides.push({
      type: 'bullets',
      title: 'Open Questions',
      subtitle: 'Questions the agent could not answer — awaiting follow-up',
      bullets: study.openQuestions.open.slice(0, 8).map(q => q.question.slice(0, 160)),
      insight: classBreak || undefined,
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
      `${study.meta.classifiedExchanges} Q&A pairs classified; ${study.meta.excludedZeroPair} input-less session(s) excluded.`,
      'Total turns are normalized — the greeting/name-capture preamble is stripped so depth reflects real exchanges.',
      'Each question is tagged to one focus area; its paired answer inherits the same focus.',
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
