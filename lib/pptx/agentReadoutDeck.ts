// lib/pptx/agentReadoutDeck.ts
// Flattens an AgentReadout into a DeckSpec — the presentable leave-behind for a
// town hall / campaign stakeholder. Same analysis object the interactive page
// and PDF render; this is the meeting/email artifact. Datanautix-branded per the
// deck-export exception in CLAUDE.md.

import type { AgentReadout } from '@/lib/agentReadout'
import type { DeckSpec, SlideSpec } from './slideRenderer'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Dominant sentiment label for a theme's tally → the theme_cards / comments_grid
// badge. Neutral is the default for unscored turns, so only call it Positive/
// Negative/Mixed when there's real signal.
function sentimentLabel(s: { positive: number; neutral: number; negative: number }): string {
  if (s.positive === 0 && s.negative === 0) return 'Neutral'
  if (s.positive > 0 && s.negative > 0) return 'Mixed'
  return s.negative > s.positive ? 'Negative' : 'Positive'
}
const SENT_ACCENT: Record<string, string> = { Positive: '059669', Negative: 'DC2626', Mixed: 'E85A1A', Neutral: '94A3B8' }

export function buildReadoutDeck(readout: AgentReadout): DeckSpec {
  const r = readout
  const slides: SlideSpec[] = []
  // Cards/charts use the >=2-mention "main" themes (single mentions are tail
  // noise — same floor the HTML uses); charts can show more rows than cards.
  const qMain = r.questionThemes.filter(t => t.questions >= 2)
  const bMain = r.beyondThemes.filter(t => t.comments >= 2)

  // 1. Executive summary — overview as the callout, takeaways as bullets.
  if (r.summary.overview || r.summary.takeaways.length) {
    slides.push({
      type: 'bullets',
      title: 'Executive summary',
      subtitle: `Based on ${r.scope.conversations} conversation${r.scope.conversations === 1 ? '' : 's'} · ${fmtDate(r.range.first)} – ${fmtDate(r.range.last)}`,
      bullets: r.summary.takeaways.slice(0, 6).map(t => t.slice(0, 240)),
      insight: r.summary.overview || undefined,
    })
  }

  // 2. Questions by theme — section divider + volume chart + share/sentiment cards.
  if (qMain.length) {
    slides.push({ type: 'section', eyebrow: 'WHAT PEOPLE ASKED', title: 'Questions by theme' })
    slides.push({
      type: 'bar_chart',
      title: 'Questions by theme',
      subtitle: 'Substantive questions, grouped by topic',
      data: qMain.map(t => ({ label: t.label, value: t.questions })),
    })
    slides.push({
      type: 'theme_cards',
      title: 'Top question themes',
      subtitle: 'Share of themed questions, with the dominant sentiment',
      cards: qMain.slice(0, 5).map(t => ({
        name: t.label,
        pct: r.scope.questions > 0 ? Math.round((t.questions / r.scope.questions) * 100) : 0,
        count: t.questions,
        total: r.scope.questions,
        sentiment: sentimentLabel(t.sentiment),
      })),
      insight: qMain.length > 5 ? `Showing the 5 largest of ${qMain.length} question themes; the full set is in the bar chart and the full report.` : undefined,
    })
  }

  // 3. Raised beyond the questions — section + volume chart + verbatim grid.
  if (bMain.length) {
    slides.push({ type: 'section', eyebrow: 'RAISED ON THEIR OWN', title: 'Beyond the questions', subtitle: 'Observations, concerns, suggestions and opinions participants volunteered' })
    slides.push({
      type: 'bar_chart',
      title: 'Raised beyond the questions',
      subtitle: 'Volunteered comments, grouped by topic',
      data: bMain.map(t => ({ label: t.label, value: t.comments })),
    })
    // Verbatim grid — up to 8 quotes, drawn from the top themes (one each first,
    // then a second pass), accent-colored by the theme's sentiment.
    const quotes: { text: string; accent?: string; pills?: { label: string; tone?: 'neutral' }[] }[] = []
    for (let pass = 0; pass < 2 && quotes.length < 8; pass++) {
      for (const t of bMain) {
        if (quotes.length >= 8) break
        const s = t.samples[pass]
        if (!s) continue
        quotes.push({ text: s.quote.slice(0, 260), accent: SENT_ACCENT[sentimentLabel(t.sentiment)], pills: [{ label: t.label, tone: 'neutral' }] })
      }
    }
    if (quotes.length) {
      slides.push({ type: 'comments_grid', title: 'In their words', subtitle: 'Verbatim, lightly cleaned', comments: quotes })
    }
  }

  // 4. Methodology
  slides.push({
    type: 'bullets',
    title: 'How this report was made',
    subtitle: 'Method & provenance',
    bullets: [
      `${r.scope.questions} question${r.scope.questions === 1 ? '' : 's'} and ${r.scope.beyondComments} volunteered comment${r.scope.beyondComments === 1 ? '' : 's'} themed across ${r.scope.conversations} conversation${r.scope.conversations === 1 ? '' : 's'}.`,
      'Only substantive messages count — greeting/name preamble and one-word taps are stripped, and trolls/bots/off-topic conversations are excluded by the same review gate as the Agent Study.',
      r.scope.focusesConfigured > 0
        ? `Themes are hybrid: a question matching one of the agent's ${r.scope.focusesConfigured} focus areas is filed there; anything outside is themed from the message itself and near-duplicate themes are merged.`
        : 'Themes are mined directly from the messages; near-duplicate themes are merged.',
      'Sentiment is the per-message reading. Non-English messages are themed on their translation.',
      'Single-mention themes are summarized in the full report but omitted from these charts as tail noise.',
    ],
  })

  return {
    title: r.title,
    subtitle: `${r.scope.conversations} conversations · ${fmtDate(r.range.first)} – ${fmtDate(r.range.last)}`,
    slides,
  }
}
