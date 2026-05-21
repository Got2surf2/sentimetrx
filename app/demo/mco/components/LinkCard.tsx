'use client'

// Generic link card. Used by the agent to surface specific MCO programs
// (visitor pass, MCO Reserve, accessibility programs, customs app, etc.).
// Fully driven by the hint payload; no hardcoded content here.

import type { LinkCardHint } from '@/lib/uiHints'

export default function LinkCard({ hint }: { hint: LinkCardHint }) {
  return (
    <div className="canvas-card-inner">
      <div className="canvas-header">
        <h2>{hint.title}</h2>
        <span className="subtitle">Skip the security line</span>
        <span className="badge">Free</span>
      </div>

      <div className="link-hero" style={hint.image_url ? { backgroundImage: 'url(' + hint.image_url + ')', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>
        {!hint.image_url && '🛂'}
      </div>

      <div className="link-body">
        {hint.body.split('\n\n').map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>

      <a className="link-cta" href={hint.cta_url} target="_blank" rel="noopener noreferrer">
        {hint.cta_label}
        <span className="link-arrow">→</span>
      </a>
    </div>
  )
}
