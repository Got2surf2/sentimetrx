'use client'
// app/m/MobileStatusClient.tsx
// Client wrapper for the mobile status surface. Two responsibilities:
//   1. Register the service worker on mount — this is what unlocks iOS PWA
//      installability (Add to Home Screen → standalone app) and, on iOS
//      16.4+, web push notifications. Registration is scoped to /m only;
//      the rest of the app doesn't need a SW.
//   2. Render a tight, mobile-first status surface. Tap targets ≥ 44px,
//      stacked cards, no horizontal scroll, safe-area-inset padding so the
//      top of the page clears the iPhone notch when running standalone.
//
// Heavy workflows (TextMine, builders, admin tables) are deep-linked back
// to the desktop UI. The point of this page is "check the status of
// things", not a phone rebuild of every feature.

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface RecentItem { id: string; name: string; subtitle?: string; href: string; ts?: string | null }
interface Section    { key: string; label: string; href: string; count: number; recent: RecentItem[] }

interface Props {
  user:     { name: string; email: string }
  org:      { name: string; isAdmin: boolean }
  sections: Section[]
}

const P = {
  bg:        '#f7f7f8',
  white:     '#ffffff',
  border:    '#e8e8ec',
  text:      '#111827',
  textMid:   '#374151',
  textMute:  '#6b7280',
  textFaint: '#9ca3af',
  accent:    '#e8622a',
  accentBg:  '#fff4ef',
}

function relTime(ts: string | null | undefined): string {
  if (!ts) return ''
  const d = new Date(ts)
  const diffMs = Date.now() - d.getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return mins + 'm ago'
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return hrs + 'h ago'
  const days = Math.round(hrs / 24)
  if (days < 7) return days + 'd ago'
  return d.toLocaleDateString()
}

export default function MobileStatusClient({ user, org, sections }: Props) {
  useEffect(function() {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch(function(err) { console.error('SW register failed', err) })
  }, [])

  // Detect platform + install state. Each platform has a different install
  // gesture; show the right hint or nothing at all.
  //   - iOS Safari       → Share → Add to Home Screen
  //   - iOS Chrome/FF    → must use Safari (Apple restricts install to Safari)
  //   - Android Chromium → menu (⋮) → Install app
  //   - Desktop / other  → no hint
  const [installHint, setInstallHint] = useState<'ios-safari' | 'ios-other' | 'android' | 'none'>('none')
  useEffect(function() {
    if (typeof window === 'undefined') return
    const ua = navigator.userAgent
    const isIOS = /iPhone|iPad|iPod/.test(ua)
    const isIOSSafari = isIOS && !/CriOS|FxiOS|EdgiOS/.test(ua)
    const isIOSOther  = isIOS && !isIOSSafari
    // Android Chrome/Edge/Brave all match. Firefox supports install but via a
    // different flow; treat it as Android too — the menu-based gesture is close
    // enough and the alternative is no hint at all.
    const isAndroid = /Android/.test(ua)
    const standalone =
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
    if (standalone)        setInstallHint('none')
    else if (isIOSSafari)  setInstallHint('ios-safari')
    else if (isIOSOther)   setInstallHint('ios-other')
    else if (isAndroid)    setInstallHint('android')
    else                   setInstallHint('none')
  }, [])

  return (
    <div style={{
      minHeight: '100vh',
      background: P.bg,
      padding: 'max(env(safe-area-inset-top), 16px) 16px max(env(safe-area-inset-bottom), 16px)',
      boxSizing: 'border-box' as const,
      fontFamily: 'inherit',
      color: P.text,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: P.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', color: P.white, fontWeight: 800, fontSize: 20, fontFamily: 'Georgia, serif', flexShrink: 0 }}>
          S
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.1 }}>Sentimetrx</div>
          <div style={{ fontSize: 12, color: P.textMute, lineHeight: 1.3, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const }}>
            {user.name} {'·'} {org.name}{org.isAdmin ? ' (admin)' : ''}
          </div>
        </div>
      </div>

      {/* Install hint — platform-specific; hidden when already installed
          or when the browser can't install (iOS Chrome/FF, desktop). */}
      {installHint === 'ios-safari' && (
        <div style={{ marginBottom: 14, padding: '10px 12px', background: P.accentBg, border: '1px solid ' + P.accent + '40', borderRadius: 10, fontSize: 12, color: P.textMid, lineHeight: 1.4 }}>
          Tap <strong style={{ color: P.accent }}>Share → Add to Home Screen</strong> to install this as an app.
        </div>
      )}
      {installHint === 'android' && (
        <div style={{ marginBottom: 14, padding: '10px 12px', background: P.accentBg, border: '1px solid ' + P.accent + '40', borderRadius: 10, fontSize: 12, color: P.textMid, lineHeight: 1.4 }}>
          Tap the <strong style={{ color: P.accent }}>menu (⋮) → Install app</strong> to install this as an app.
        </div>
      )}
      {installHint === 'ios-other' && (
        <div style={{ marginBottom: 14, padding: '10px 12px', background: P.accentBg, border: '1px solid ' + P.accent + '40', borderRadius: 10, fontSize: 12, color: P.textMid, lineHeight: 1.4 }}>
          To install on iPhone, open this page in <strong style={{ color: P.accent }}>Safari</strong> and tap Share → Add to Home Screen.
        </div>
      )}

      {/* Section cards */}
      <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 12 }}>
        {sections.map(function(s) {
          return (
            <div key={s.key} style={{ background: P.white, border: '1px solid ' + P.border, borderRadius: 12, padding: '14px 16px' }}>
              <Link href={s.href}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  textDecoration: 'none', color: P.text,
                  minHeight: 44,  // iOS tap-target minimum
                }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 700 }}>{s.label}</span>
                  <span style={{ fontSize: 22, fontWeight: 800, color: P.accent, fontVariantNumeric: 'tabular-nums' }}>
                    {s.count.toLocaleString()}
                  </span>
                </div>
                <span style={{ fontSize: 13, color: P.textMute }}>{'›'}</span>
              </Link>
              {s.recent.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column' as const, gap: 0 }}>
                  {s.recent.map(function(r, i) {
                    return (
                      <Link key={r.id} href={r.href}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                          textDecoration: 'none', color: P.text,
                          padding: '10px 0',
                          borderTop: i === 0 ? '1px solid ' + P.border : 'none',
                          borderBottom: i < s.recent.length - 1 ? '1px solid ' + P.border : 'none',
                          minHeight: 44,
                        }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const }}>{r.name}</div>
                          {r.subtitle && (
                            <div style={{ fontSize: 11, color: P.textMute, overflow: 'hidden' as const, textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const }}>{r.subtitle}</div>
                          )}
                        </div>
                        <span style={{ fontSize: 11, color: P.textFaint, flexShrink: 0 }}>{relTime(r.ts)}</span>
                      </Link>
                    )
                  })}
                </div>
              )}
              {s.recent.length === 0 && s.count === 0 && (
                <div style={{ marginTop: 8, paddingTop: 10, borderTop: '1px solid ' + P.border, fontSize: 12, color: P.textFaint, fontStyle: 'italic' as const }}>
                  None yet.
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 20, padding: '12px 4px', fontSize: 11 }}>
        <Link href="/dashboard" style={{ color: P.accent, textDecoration: 'none', fontWeight: 600 }}>
          Desktop dashboard
        </Link>
      </div>
    </div>
  )
}
