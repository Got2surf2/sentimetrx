// Help agent (Guide, 🛟) — feature-integrity scrub + page-context formatter.
// scrubHelpReply is the post-generation defense that strips fabricated links /
// emails (the Spacy failure class) while preserving official-domain links.
import { describe, it, expect } from 'vitest'
import { scrubHelpReply, formatHelpPageContext } from '@/lib/helpAgent'

describe('scrubHelpReply — fabricated link/email removal', () => {
  it('leaves a clean reply untouched', () => {
    const r = scrubHelpReply('Open the **Schema** tab and confirm your column types.')
    expect(r.flagged).toBe(false)
    expect(r.text).toBe('Open the **Schema** tab and confirm your column types.')
  })

  it('keeps the label but strips a fabricated markdown link', () => {
    const r = scrubHelpReply('See the [help center](https://help.fake-sentimetrx.com/guide) for more.')
    expect(r.flagged).toBe(true)
    expect(r.text).toBe('See the help center for more.')
    expect(r.text).not.toContain('fake-sentimetrx')
  })

  it('preserves an official-domain markdown link', () => {
    const r = scrubHelpReply('Read the [Privacy Notice](https://www.sentimetrx.ai/privacy).')
    expect(r.flagged).toBe(false)
    expect(r.text).toContain('https://www.sentimetrx.ai/privacy')
  })

  it('removes a bare non-official URL', () => {
    const r = scrubHelpReply('Go to https://slack.com/apps to connect.')
    expect(r.flagged).toBe(true)
    expect(r.text).not.toContain('slack.com')
  })

  it('preserves a bare official URL', () => {
    const r = scrubHelpReply('Everything runs at https://www.sentimetrx.ai today.')
    expect(r.flagged).toBe(false)
    expect(r.text).toContain('https://www.sentimetrx.ai')
  })

  it('softens an invented support email', () => {
    const r = scrubHelpReply('Email support@sentimetrix-help.com for billing help.')
    expect(r.flagged).toBe(true)
    expect(r.text).toContain('your account team')
    expect(r.text).not.toContain('@')
  })

  it('handles empty input', () => {
    expect(scrubHelpReply('').flagged).toBe(false)
  })
})

describe('formatHelpPageContext', () => {
  it('returns empty string for null/empty context', () => {
    expect(formatHelpPageContext(null)).toBe('')
    expect(formatHelpPageContext({})).toBe('')
  })

  it('includes current section, route, and only enabled features', () => {
    const block = formatHelpPageContext({
      currentPage: 'analytics',
      route: '/analyze/x/statistics',
      features: { analyze: true, campaigns: false, surveys: true },
    })
    expect(block).toContain('analytics')
    expect(block).toContain('/analyze/x/statistics')
    expect(block).toContain('analyze')
    expect(block).toContain('surveys')
    expect(block).not.toContain('campaigns')
  })
})
