// @vitest-environment jsdom
//
// The per-outlet Dimensions block. Its job is to present a SIGNED distance from
// the network average, so the things worth pinning are the ones that would
// quietly mislead if they broke: the ordering, the shared bar scale, the sign on
// a net rate that can go negative, and the fact that a quote is never presented
// as proof of the sentiment.

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import OutletDimensionsView from '@/app/analyze/[datasetId]/outlet-report/OutletDimensionsView'
import type { ComparisonBlock, ThemeDelta } from '@/lib/outletReport'

const d = (over: Partial<ThemeDelta>): ThemeDelta => ({
  sub: 'clean', axis: 'attribute', label: 'Clean', category: 'ops',
  outletNet: 0.33, chainNet: -0.42, delta: 0.75, n: 6, quote: null, ...over,
})

const block = (over: Partial<ComparisonBlock> = {}): ComparisonBlock => ({
  available: true, analyzedReviews: 100, strengths: [], weaknesses: [], ...over,
})

describe('OutletDimensionsView', () => {
  it('renders nothing when the block is unavailable', () => {
    const { container } = render(<OutletDimensionsView block={block({ available: false })} outletCount={67} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('says so plainly when nothing cleared the reliability floor', () => {
    render(<OutletDimensionsView block={block()} outletCount={67} />)
    // "no differences" must not read as "no data" — that is a verdict, not a gap.
    expect(screen.getByText(/tracks the rest of the network/i)).toBeInTheDocument()
  })

  it('orders strengths and weaknesses into one list, best first', () => {
    render(<OutletDimensionsView outletCount={67} block={block({
      strengths: [d({ sub: 'a', label: 'Clean', delta: 0.75 }), d({ sub: 'b', label: 'Noise', delta: 0.25 })],
      weaknesses: [d({ sub: 'c', label: 'Accuracy', delta: -0.27 }), d({ sub: 'e', label: 'Dress code', delta: -0.18 })],
    })} />)
    const labels = screen.getAllByTitle(/net-positive/).map(el => el.textContent || '')
    expect(labels[0]).toMatch(/Clean/)
    expect(labels[1]).toMatch(/Noise/)
    expect(labels[2]).toMatch(/Dress code/)   // -0.18 before -0.27
    expect(labels[3]).toMatch(/Accuracy/)
  })

  it('signs a NEGATIVE net rate and never calls it "positive"', () => {
    // outletNet is (pos − neg)/total, so it goes below zero. An earlier draft
    // rendered "−100% positive", which is nonsense.
    render(<OutletDimensionsView outletCount={67} block={block({
      weaknesses: [d({ sub: 'c', label: 'Accuracy', delta: -0.27, outletNet: -1, n: 12 })],
    })} />)
    expect(screen.getByText('−100%')).toBeInTheDocument()
    expect(screen.queryByText(/−100% positive/)).not.toBeInTheDocument()
    expect(screen.getByText(/12 mentions/)).toBeInTheDocument()
  })

  it('singularises a lone mention', () => {
    render(<OutletDimensionsView outletCount={67} block={block({
      strengths: [d({ sub: 'a', label: 'Clean', delta: 0.4, n: 1 })],
    })} />)
    expect(screen.getByText(/1 mention$/)).toBeInTheDocument()
  })

  it('scales both arms against one shared maximum', () => {
    // Independently-scaled arms would make a +4 look the same length as a −40.
    const { container } = render(<OutletDimensionsView outletCount={67} block={block({
      strengths: [d({ sub: 'a', label: 'Big', delta: 0.4 })],
      weaknesses: [d({ sub: 'b', label: 'Small', delta: -0.1 })],
    })} />)
    const bars = Array.from(container.querySelectorAll('div[style*="width"]'))
      .map(el => parseFloat((el as HTMLElement).style.width))
      .filter(w => !Number.isNaN(w))
    expect(bars).toHaveLength(2)
    // 0.1 / 0.4 = a quarter of the longest arm.
    expect(bars[1] / bars[0]).toBeCloseTo(0.25, 2)
  })

  it('presents a quote as a mention, never as proof of the sentiment', () => {
    render(<OutletDimensionsView outletCount={67} block={block({
      weaknesses: [d({ sub: 'c', label: 'Accuracy', delta: -0.27, quote: 'Forgot how delicious the food is' })],
    })} />)
    // The classifier's evidence is a fixed-width window, so the sentence around
    // it does not reliably read as the polarity — the framing must not claim it does.
    expect(screen.getByText(/a review mentioning each/i)).toBeInTheDocument()
    expect(screen.getByText(/Forgot how delicious/)).toBeInTheDocument()
  })

  it('names the denominator the bars are a share of', () => {
    render(<OutletDimensionsView outletCount={67} block={block({
      strengths: [d({ sub: 'a', label: 'Clean', delta: 0.4 })],
    })} />)
    expect(screen.getByText(/across all 67 locations/i)).toBeInTheDocument()
  })
})
