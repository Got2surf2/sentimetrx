'use client'

// LinkCardModal — full-screen overlay shown when the user taps the link_card's
// CTA on the right pane. Replaces the previous "navigate to flymco.com in a new
// tab" behavior, which was disorienting in every deployment mode (kiosk has no
// back button; home/invenue loses the chat session).
//
// The modal expands the card's body into a more readable, presentation-friendly
// layout and offers two exits:
//   - "Close" — back to the canvas (primary action in all modes).
//   - "Open full page" — opens flymco.com in a new tab. HIDDEN in kiosk mode
//      because there's no keyboard/login on a wall display.
//
// Kiosk auto-dismiss: after 60s with no user interaction (keydown, pointermove,
// touchstart, click), the modal closes itself so the screen returns to the
// chat + canvas state for the next person walking up.

import { useEffect, useRef } from 'react'
import type { DeploymentMode, LinkCardHint } from '@/lib/uiHints'

const KIOSK_AUTO_DISMISS_MS = 60_000

interface Props {
  hint: LinkCardHint
  mode: DeploymentMode
  onClose: () => void
}

export default function LinkCardModal({ hint, mode, onClose }: Props) {
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeBtnRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Kiosk-only: reset a 60s timer on any user interaction. If the timer
  // elapses without activity, close the modal so the next person sees the
  // chat + canvas baseline. No-op in home/invenue (the user is driving the
  // experience and can close it themselves).
  useEffect(() => {
    if (mode !== 'kiosk') return
    let t: ReturnType<typeof setTimeout>
    function bump() {
      clearTimeout(t)
      t = setTimeout(onClose, KIOSK_AUTO_DISMISS_MS)
    }
    bump()
    window.addEventListener('pointermove', bump)
    window.addEventListener('keydown', bump)
    window.addEventListener('touchstart', bump)
    window.addEventListener('click', bump)
    return () => {
      clearTimeout(t)
      window.removeEventListener('pointermove', bump)
      window.removeEventListener('keydown', bump)
      window.removeEventListener('touchstart', bump)
      window.removeEventListener('click', bump)
    }
  }, [mode, onClose])

  return (
    <div className={'lc-modal-backdrop mode-' + mode} role="dialog" aria-modal="true" aria-labelledby="lc-modal-title" onClick={onClose}>
      <div className="lc-modal-panel" onClick={(e) => e.stopPropagation()}>
        <button
          ref={closeBtnRef}
          className="lc-modal-close"
          onClick={onClose}
          aria-label="Close"
          title="Close (Esc)">
          ×
        </button>

        <div className="lc-modal-hero" style={hint.image_url ? { backgroundImage: 'url(' + hint.image_url + ')', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>
          {!hint.image_url && <span aria-hidden>🛂</span>}
        </div>

        <h2 id="lc-modal-title" className="lc-modal-title">{hint.title}</h2>

        <div className="lc-modal-body">
          {hint.body.split('\n\n').map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>

        <div className="lc-modal-footer">
          {mode !== 'kiosk' && (
            <a
              className="lc-modal-link"
              href={hint.cta_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}>
              Open full page on flymco.com
              <span aria-hidden> ↗</span>
            </a>
          )}
          <button className="lc-modal-primary" onClick={onClose}>
            {hint.cta_label}
          </button>
        </div>
      </div>
    </div>
  )
}
