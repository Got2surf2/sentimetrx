'use client'

// Generic link card. Used by the agent to surface specific MCO programs
// (visitor pass, MCO Reserve, accessibility programs, customs app, etc.).
// Fully driven by the hint payload; no hardcoded content here.
//
// Tapping the CTA opens an in-product modal (LinkCardModal) instead of
// navigating away to flymco.com — the navigate-away behavior was disorienting
// in every mode (kiosk has no back button; home/invenue loses the chat
// session). The modal carries an "Open full page" escape hatch for users who
// actually want the external page (hidden in kiosk mode where there's no
// keyboard or login on a wall display).

import { useState } from 'react'
import type { DeploymentMode, LinkCardHint } from '@/lib/uiHints'
import LinkCardModal from './LinkCardModal'

interface Props {
  hint: LinkCardHint
  mode: DeploymentMode
}

export default function LinkCard({ hint, mode }: Props) {
  const [open, setOpen] = useState(false)

  return (
    <>
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

        <button className="link-cta" onClick={() => setOpen(true)}>
          {hint.cta_label}
          <span className="link-arrow">→</span>
        </button>
      </div>

      {open && <LinkCardModal hint={hint} mode={mode} onClose={() => setOpen(false)} />}
    </>
  )
}
