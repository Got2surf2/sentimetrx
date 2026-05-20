'use client'
// app/shared/conversation/[token]/SharedConversationView.tsx
// Client wrapper that renders the conversation HTML inside a sandboxed
// iframe, with an optional Plain/Labeled toggle pinned top-right when the
// share has both variants baked into shared_links.metadata.
//
// The toggle updates `?labels=1` in the URL so a Datanautix-internal user
// can hand a prospect a direct link to the labeled view, OR send a plain
// URL and let the prospect flip it themselves. If only the plain HTML
// exists (regular org-admin share), no toggle renders — `?labels=1` falls
// back to plain because there's literally nothing else to show.

import { useEffect, useState } from 'react'

interface Props {
  html:          string
  html_labeled?: string
}

export default function SharedConversationView({ html, html_labeled }: Props) {
  const hasLabeled = !!html_labeled
  // Default to Labeled when the share was created with an html_labeled variant
  // — the platform_admin who ticked the checkbox at share time was explicitly
  // saying "show this with annotations", so don't hide them behind a click.
  // ?labels=0 in the URL still lets the recipient deep-link to Plain.
  const [labeled, setLabeled] = useState(hasLabeled)

  useEffect(function() {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('labels') === '0') setLabeled(false)
    else if (hasLabeled && params.get('labels') === '1') setLabeled(true)
  }, [hasLabeled])

  function flip(next: boolean) {
    setLabeled(next)
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    // Labeled is the default when html_labeled exists, so we encode the
    // OPPOSITE choice in the URL: ?labels=0 deep-links to Plain.
    if (!next) url.searchParams.set('labels', '0')
    else url.searchParams.delete('labels')
    window.history.replaceState(null, '', url.toString())
  }

  const rendered = labeled && html_labeled ? html_labeled : html

  return (
    <div className="relative w-full min-h-screen">
      {hasLabeled && (
        <div style={{ position: 'fixed', top: 12, right: 12, zIndex: 10, display: 'flex', background: 'white', border: '1px solid #e5e7eb', borderRadius: 999, padding: 2, boxShadow: '0 1px 4px rgba(0,0,0,.06)', fontSize: 11, fontWeight: 600 }}>
          <button
            onClick={function() { flip(false) }}
            style={{ padding: '5px 11px', borderRadius: 999, border: 'none', cursor: 'pointer', background: labeled ? 'transparent' : '#fff4ef', color: labeled ? '#6b7280' : '#e8622a' }}>
            Plain
          </button>
          <button
            onClick={function() { flip(true) }}
            style={{ padding: '5px 11px', borderRadius: 999, border: 'none', cursor: 'pointer', background: labeled ? '#fff4ef' : 'transparent', color: labeled ? '#e8622a' : '#6b7280' }}>
            Labeled
          </button>
        </div>
      )}
      <iframe
        srcDoc={rendered}
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        className="w-full min-h-screen border-0"
        title="Shared Conversation"
      />
    </div>
  )
}
