'use client'
// components/analyze/TextMineNav.tsx
// The persistent two-row TextMine navigation (Target B IA): row 1 = the four
// peer SECTIONS, row 2 = the active section's VIEWS. Shared by TextMineModule
// (interactive, button-driven via onSelect*) and the Advanced Analytics pages
// (link-driven — each item carries an href). An item with an href renders as a
// <Link>; otherwise as a <button> that calls the onSelect* callback.

import { useState, type ReactNode, type CSSProperties } from 'react'
import Link from 'next/link'
import { T } from '@/lib/analyzeTheme'
import HelpHint from '@/components/analyze/textmine/HelpHint'
import LottieLoader from '@/components/ui/LottieLoader'
import { type Section } from '@/lib/textmineNav'

export interface NavSectionItem { id: Section; label: string; help?: string; href?: string }
export interface NavViewItem {
  id: string; label: string; locked?: boolean; href?: string
  /** The data this view needs is still loading: shown with a pulsing dot and
   *  disabled, so nobody lands on a bare loader. Distinct from `locked`, which
   *  means "not possible until you mine themes" rather than "not yet". */
  pending?: boolean
}

export default function TextMineNav({ sections, activeSection, views, activeView, onSelectSection, onSelectView, children, viewsExtra }: {
  sections: NavSectionItem[]
  activeSection: Section
  views: NavViewItem[]
  activeView: string
  onSelectSection?: (s: Section) => void
  onSelectView?: (v: string) => void
  children?: ReactNode
  // Right-aligned slot on the views row (row 2) — used for the text-field
  // picker so it shares a row instead of occupying its own bar.
  viewsExtra?: ReactNode
}) {
  // Which pending view the cursor is over. The heartbeat dot is the always-on
  // signal; the Lottie is the on-demand detail when you actually point at it.
  const [hoveredView, setHoveredView] = useState<string | null>(null)
  return (
    <>
      {/* Row 1 — peer sections (left) + right-aligned action slot (children) */}
      <div style={{ background: T.bgCard, borderBottom: '1px solid ' + T.border, height: 36, display: 'flex', alignItems: 'stretch', paddingLeft: 8, flexShrink: 0 }}>
        {sections.map(function(sec) {
          var isActive = activeSection === sec.id
          var base: CSSProperties = { padding: '0 8px 0 18px', height: '100%', display: 'inline-flex', alignItems: 'center', fontSize: 13, fontWeight: isActive ? 700 : 500, color: isActive ? T.accent : T.textMid, background: 'transparent', borderBottom: '2px solid ' + (isActive ? T.accent : 'transparent'), textDecoration: 'none', transition: 'color .12s' }
          var node = isActive
            ? <span style={base}>{sec.label}</span>
            : sec.href
              ? <Link href={sec.href} style={base}>{sec.label}</Link>
              : <button onClick={function() { if (onSelectSection) onSelectSection(sec.id) }} style={{ ...base, border: 'none', cursor: 'pointer' }}>{sec.label}</button>
          return (
            <div key={sec.id} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              {node}
              {sec.help && (
                <span style={{ paddingRight: 10 }}>
                  <HelpHint title={sec.label} placement="bottom">{sec.help}</HelpHint>
                </span>
              )}
            </div>
          )
        })}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '0 16px' }}>
          {children}
        </div>
      </div>

      {/* Row 2 — the active section's views (+ optional right-aligned slot) */}
      {views.length > 0 && (
        <div style={{ background: T.bg, borderBottom: '1px solid ' + T.border, height: 32, display: 'flex', alignItems: 'center', paddingLeft: 18, flexShrink: 0 }}>
          {views.map(function(v) {
            var isActive = activeView === v.id
            var base: CSSProperties = { padding: '0 16px', height: '100%', display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: isActive ? 700 : 500, color: isActive ? T.accent : (v.locked ? T.textFaint : T.textMid), background: 'transparent', borderBottom: '2px solid ' + (isActive ? T.accent : 'transparent'), textDecoration: 'none', transition: 'color .12s' }
            if (v.locked) {
              return <button key={v.id} disabled title="Run a theme model first" style={{ ...base, border: 'none', cursor: 'not-allowed', opacity: 0.4 }}>{v.label}</button>
            }
            // A view whose data is still arriving shows a pulsing dot and is
            // NOT clickable — landing on a bare loader is a worse experience
            // than a moment's wait, and the dot explains why the tab is inert.
            // Deliberately a dot, not a spinner: three can be pending at once
            // and a row of spinning glyphs reads as an error, not progress.
            // Two indicators with different jobs. The heartbeat dot is ALWAYS on
            // while a view is pending — it has to be readable at a glance across
            // the whole nav row without pointing at anything. The Lottie (the one
            // loader in this codebase) swaps in on hover, when you've singled a
            // view out and want confirmation it's actively working.
            var hoveringThis = hoveredView === v.id
            var dot = v.pending
              ? (
                <span key="d" aria-hidden style={{ marginLeft: 7, flexShrink: 0, display: 'inline-flex', alignItems: 'center', width: 14, height: 14, justifyContent: 'center' }}>
                  {hoveringThis
                    ? <LottieLoader size={14} />
                    : <span className="tm-nav-heartbeat" style={{ width: 7, height: 7, borderRadius: '50%', background: T.amber, boxShadow: '0 0 0 3px ' + T.amberBg, display: 'inline-block' }} />}
                </span>
              )
              : null
            // The ACTIVE view is never disabled even while pending — a deep link
            // straight to Clouds must still render (its own loader covers it);
            // disabling the tab you are standing on would strand the user.
            if (v.pending && !isActive) {
              return (
                // `aria-disabled` + a no-op click, NOT the `disabled` attribute:
                // Chrome fires NO mouse events on a disabled button, so hover — and
                // therefore the Lottie — would never trigger. Still inert to clicks.
                // And NOT cursor:'wait', which Chrome renders as its own blue
                // spinning cursor, i.e. a second, non-Lottie spinner on hover.
                <button key={v.id} aria-disabled="true"
                  onClick={function(e) { e.preventDefault() }}
                  onMouseEnter={function() { setHoveredView(v.id) }}
                  onMouseLeave={function() { setHoveredView(null) }}
                  title="Loading the comments this view needs — available in a moment"
                  style={{ ...base, border: 'none', cursor: 'default', opacity: 0.55 }}>
                  {v.label}{dot}
                </button>
              )
            }
            if (isActive) return <span key={v.id} style={base}>{v.label}{dot}</span>
            if (v.href) return <Link key={v.id} href={v.href} style={base}>{v.label}</Link>
            return <button key={v.id} onClick={function() { if (onSelectView) onSelectView(v.id) }} style={{ ...base, border: 'none', cursor: 'pointer' }}>{v.label}</button>
          })}
          {viewsExtra && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, paddingRight: 16 }}>
              {viewsExtra}
            </div>
          )}
        </div>
      )}
    </>
  )
}
