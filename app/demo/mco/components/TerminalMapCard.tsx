'use client'

// Terminal map canvas card. v1: hardcoded SVG of MCO's three-terminal layout
// with the Terminal Link APM route highlighted. Commit 4 will swap to the
// extracted SVGs in public/mco/terminals/* with dynamic gate pins.

import type { TerminalMapHint } from '@/lib/uiHints'

export default function TerminalMapCard({ hint }: { hint: TerminalMapHint }) {
  const from = hint.from || 'C'
  const to = hint.to || 'A'

  return (
    <div className="canvas-card-inner">
      <div className="canvas-header">
        <h2>{from === to ? `Terminal ${to}` : `Terminal ${from} → Terminal ${to}`}</h2>
        <span className="subtitle">via Terminal Link APM</span>
        <span className="badge">Wayfinding</span>
      </div>

      <div className="terminal-svg">
        <svg viewBox="0 0 600 240" xmlns="http://www.w3.org/2000/svg">
          <rect x="30" y="30" width="180" height="180" rx="12" fill="#0a2540" opacity="0.92" />
          <text x="120" y="85" fill="#fff" fontSize="15" fontWeight="700" textAnchor="middle">Terminal A</text>
          <text x="120" y="103" fill="#cbd5e1" fontSize="10" textAnchor="middle">Level 3 — Departures</text>
          <line x1="115" y1="120" x2="125" y2="120" stroke="#cbd5e1" strokeWidth="1" />
          <text x="120" y="155" fill="#fff" fontSize="15" fontWeight="700" textAnchor="middle">Terminal B</text>
          <text x="120" y="173" fill="#cbd5e1" fontSize="10" textAnchor="middle">Level 3 — Departures</text>
          <text x="120" y="197" fill="#94a3b8" fontSize="9" textAnchor="middle">525 ft across</text>

          <rect x="270" y="90" width="100" height="80" rx="10" fill="#1e4d8b" />
          <text x="320" y="123" fill="#fff" fontSize="12" fontWeight="600" textAnchor="middle">Train Station</text>
          <text x="320" y="140" fill="#bfdbfe" fontSize="10" textAnchor="middle">+ Garage C entry</text>

          <rect x="430" y="30" width="140" height="180" rx="12" fill="#0a2540" opacity="0.92" />
          <text x="500" y="120" fill="#fff" fontSize="15" fontWeight="700" textAnchor="middle">Terminal C</text>
          <text x="500" y="140" fill="#cbd5e1" fontSize="10" textAnchor="middle">~1,200 ft walk</text>
          <text x="500" y="155" fill="#cbd5e1" fontSize="10" textAnchor="middle">via Garage C</text>

          <line x1="210" y1="120" x2="270" y2="120" stroke="#f59e0b" strokeWidth="4" strokeLinecap="round" />
          <line x1="370" y1="120" x2="430" y2="120" stroke="#f59e0b" strokeWidth="4" strokeLinecap="round" strokeDasharray="2 4" />

          <rect x="225" y="40" width="120" height="20" rx="10" fill="#f59e0b" />
          <text x="285" y="53" fill="#fff" fontSize="10.5" fontWeight="700" textAnchor="middle">Terminal Link APM</text>
        </svg>
      </div>

      <div className="route-steps">
        <div className="route-step">
          <div className="step-num">1</div>
          <div className="step-text">
            <strong>Exit Garage C on Level 4</strong>, follow signs to the Train Station.
            <div className="step-meta">~5-minute walk through the garage</div>
          </div>
        </div>
        <div className="route-step">
          <div className="step-num">2</div>
          <div className="step-text">
            <strong>Board the Terminal Link APM</strong> to Terminal B.
            <div className="step-meta">Runs 24/7 · 2-minute ride</div>
          </div>
        </div>
        <div className="route-step">
          <div className="step-num">3</div>
          <div className="step-text">
            <strong>Cross to Terminal A on Level 3</strong> (Departures).
            <div className="step-meta">Same building, 525 ft across</div>
          </div>
        </div>
      </div>
    </div>
  )
}
