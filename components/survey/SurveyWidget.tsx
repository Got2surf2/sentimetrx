'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useSurveyEngine } from './useSurveyEngine'
import SanjayModal from '@/components/ui/SanjayModal'
import type { Study } from '@/lib/types'

interface Props { study: Study; orgName?: string }

// All font sizes use rem so they scale with the user's OS/browser
// accessibility text-size settings. Conversions from the original px values
// assume a 16px root (browser default):
//
//   8px  → 0.5rem
//  10px  → 0.625rem
//  11px  → 0.6875rem
//  14px  → 0.875rem
//  15px  → 0.9375rem
//  18px  → 1.125rem
//  20px  → 1.25rem
//  48px  → 3rem
//
// Structural px values (gap, padding, border-radius, width/height of fixed
// chrome like the avatar) are intentionally kept in px — they are layout
// measurements, not text, and should not inflate with font size.

// Pick Sarina blue or Hermes orange based on background color — whichever contrasts better
export function pickBrandColor(bgHex: string): string {
  const SARINA_BLUE = '#00b4d8'
  const HERMES_ORANGE = '#E8632A'
  const hex = (bgHex || '#1a1a2e').replace('#', '')
  const r = parseInt(hex.slice(0, 2), 16) || 0
  const g = parseInt(hex.slice(2, 4), 16) || 0
  const b = parseInt(hex.slice(4, 6), 16) || 0
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let hue = 0
  if (max !== min) {
    const d = max - min
    if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) hue = ((b - r) / d + 2) * 60
    else hue = ((r - g) / d + 4) * 60
  }
  const isBlueish = hue >= 160 && hue <= 260
  const isOrangeish = (hue >= 0 && hue <= 50) || hue >= 340
  if (isBlueish) return HERMES_ORANGE
  if (isOrangeish) return SARINA_BLUE
  if (lum < 0.45) return SARINA_BLUE
  return HERMES_ORANGE
}

export default function SurveyWidget({ study, orgName = '' }: Props) {
  const chatRef    = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLDivElement>(null)
  const startedRef = useRef(false)
  const searchParams = useSearchParams()
  const [status,       setStatus]      = useState<'checking' | 'active' | 'closed' | 'draft' | 'error'>('checking')
  const [liveBotName,  setLiveBotName]  = useState(study.bot_name)
  const [liveBotEmoji, setLiveBotEmoji] = useState(study.bot_emoji)
  const [liveConfig,   setLiveConfig]   = useState(study.config)

  const [verboseMode, setVerboseMode] = useState(false)
  const [showVerboseAuth, setShowVerboseAuth] = useState(false)

  // Merge live values into study object for the engine and header
  const mergedConfig = verboseMode ? { ...liveConfig, testing: true } : liveConfig
  const liveStudy = { ...study, bot_name: liveBotName, bot_emoji: liveBotEmoji, config: mergedConfig }

  const scrollBottom = useCallback(() => {
    const el = chatRef.current
    if (!el) return
    // Always scroll to bottom -- on mobile the near-bottom guard misfires when keyboard
    // shrinks the viewport, so we scroll unconditionally and use two retries for
    // late-rendering DOM elements (buttons, option lists)
    const doScroll = () => { el.scrollTop = el.scrollHeight }
    setTimeout(doScroll, 60)
    setTimeout(doScroll, 350)
  }, [chatRef])

  // Fix mobile keyboard: on iOS, 100dvh doesn't shrink when keyboard opens.
  // Listen to visualViewport resize and update the wrapper height.
  const wrapperRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => {
      if (wrapperRef.current) {
        wrapperRef.current.style.height = vv.height + 'px'
      }
      // After viewport shrinks (keyboard open), scroll chat to bottom
      scrollBottom()
    }
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [scrollBottom])

  const theme = liveConfig.theme

  // Detect if background is light — used to flip text/border colors across the survey
  const isLightBg = (() => {
    const hex = (theme.backgroundColor || '#1a1a2e').replace('#', '')
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16)
    return (r * 299 + g * 587 + b * 114) / 1000 > 150
  })()

  // Detect reduced motion preference from device accessibility settings
  const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

  const { renderInput, deviceBlocked } = useSurveyEngine({ study: liveStudy, orgName, chatRef, inputRef, scrollBottom, isLightBg, reducedMotion: prefersReducedMotion, onVerboseRequest: (mode) => { if (mode === 'bypass') { setVerboseMode(true) } else { setShowVerboseAuth(true) } } })

  // Fetch fresh study data on mount — ensures bot_name, bot_emoji, config
  // are always the latest from the DB, not potentially stale server-rendered props
  useEffect(() => {
    fetch(`/api/study/${study.guid}`, { cache: 'no-store' })
      .then(async res => {
        if (!res.ok) {
          setStatus(res.status === 404 ? 'closed' : 'error')
          return
        }
        const data = await res.json()
        // Update live fields from fresh API response
        if (data.bot_name)  setLiveBotName(data.bot_name)
        if (data.bot_emoji) setLiveBotEmoji(data.bot_emoji)
        if (data.config)    setLiveConfig(data.config)
        setStatus('active')
      })
      .catch(() => setStatus('error'))
  }, [study.guid])

  useEffect(() => {
    if (status === 'active' && !startedRef.current) {
      startedRef.current = true
      renderInput('start')
    }
  }, [status, renderInput])

  // Respect device accessibility: compute font size as a scale factor on the
  // browser's default (typically 16px, but larger if user has OS/browser text
  // scaling enabled). This way surveyFontSize=18 means "112.5% of device default"
  // rather than a hard 18px that ignores accessibility settings.
  const configFontPx = liveConfig.surveyFontSize || 18
  const baseFontSize = ((configFontPx / 16) * 100) + '%'

  // Set the root font-size so all rem units scale proportionally.
  // Using % preserves the user's device text-size preference as a base.
  useEffect(() => {
    const prev = document.documentElement.style.fontSize
    document.documentElement.style.fontSize = baseFontSize
    return () => { document.documentElement.style.fontSize = prev }
  }, [baseFontSize])

  if (status === 'checking') {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.backgroundColor, fontSize: baseFontSize }}>
        <div style={{ display: 'flex', gap: 8, ['--dot-color' as any]: theme.primaryColor || '#00b4d8' }}>
          {[0, 150, 300].map(d => (
            <span key={d} className="typing-dot" style={{ animationDelay: `${d}ms` }} />
          ))}
        </div>
      </div>
    )
  }

  if (status === 'closed' || status === 'draft' || status === 'error') {
    const isClosed = status === 'closed'
    const isError = status === 'error'
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: theme.backgroundColor, overflow: 'hidden', fontSize: baseFontSize }}>
        <div style={{ background: theme.headerGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem', flexShrink: 0 }}>
            {liveBotEmoji}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: 'white', fontSize: '0.9375rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{liveBotName}</div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{liveStudy.name}</div>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center', gap: 16 }}>
          <div style={{ fontSize: '3rem' }}>{isError ? '⚠️' : isClosed ? '🔒' : '🚧'}</div>
          <div>
            <div style={{ color: 'white', fontWeight: 700, fontSize: '1.125rem', marginBottom: 8 }}>{isError ? 'Something went wrong' : isClosed ? 'This survey is now closed' : 'Not yet available'}</div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.875rem', lineHeight: 1.6 }}>
              {isError ? 'We couldn\u2019t load this survey. Please try again later.' : isClosed ? 'Thank you for your interest. This survey is no longer accepting responses.' : "This survey isn't published yet. Please check back soon."}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'center', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
          <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.6875rem' }}>Powered by <span style={{ color: 'rgba(255,255,255,0.35)', fontWeight: 500 }}>sentimetrx.ai</span></span>
        </div>
      </div>
    )
  }

  // Active survey — device already responded (only block if config restricts it)
  if (deviceBlocked && liveConfig.allowMultipleResponses === false) {
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        background: theme.backgroundColor, overflow: 'hidden', fontSize: baseFontSize,
      }}>
        <div style={{ background: theme.headerGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem', flexShrink: 0 }}>
            {liveBotEmoji}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: 'white', fontSize: '0.9375rem' }}>{liveBotName}</div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{liveStudy.name}</div>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', gap: 16 }}>
          <div style={{ fontSize: '3rem' }}>{'✓'}</div>
          <div>
            <div style={{ color: 'white', fontWeight: 700, fontSize: '1.125rem', marginBottom: 8 }}>Thank you!</div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.875rem', lineHeight: 1.6 }}>
              A response has already been submitted from this device. We appreciate your feedback!
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'center', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
          <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.6875rem' }}>Powered by <span style={{ color: 'rgba(255,255,255,0.35)', fontWeight: 500 }}>sentimetrx.ai</span></span>
        </div>
      </div>
    )
  }

  // Active survey
  return (
    <div data-survey="true" style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#FFFFFF',
      overflow: 'hidden',
      fontSize: baseFontSize,
    }}>
      {/* Fixed header — never scrolls */}
      <div style={{
        background: theme.headerGradient,
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
        zIndex: 10,
      }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem', flexShrink: 0 }}>
          {liveBotEmoji}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'white', fontSize: '0.9375rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{liveBotName}</div>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{liveConfig.headerSubtitle || liveStudy.name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <span className="live-dot" />
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.6875rem' }}>{liveConfig.headerStatus || 'Ready for your feedback'}</span>
          </div>
        </div>
        {liveConfig.showBranding !== false && (() => {
          const brandColor = pickBrandColor(theme.primaryColor || '#1a1a2e')
          const hdrHex = (theme.primaryColor || '#1a1a2e').replace('#', '')
          const hdrLum = (0.299 * (parseInt(hdrHex.slice(0, 2), 16) || 0) + 0.587 * (parseInt(hdrHex.slice(2, 4), 16) || 0) + 0.114 * (parseInt(hdrHex.slice(4, 6), 16) || 0)) / 255
          const byColor = hdrLum < 0.45 ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.25)'
          return (
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', lineHeight: 1, gap: 2 }}>
              <span style={{ color: byColor, fontSize: '0.5rem', fontWeight: 500, letterSpacing: '0.06em' }}>by</span>
              <span style={{ color: brandColor, fontSize: '0.625rem', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                {(liveConfig.brandingLabel || 'SENTIMETRX').slice(0, 15)}
              </span>
            </div>
          )
        })()}
      </div>

      {/* Verbose mode banner */}
      {verboseMode && (
        <div style={{ background: '#FEF3C7', borderBottom: '1px solid #FDE68A', padding: '4px 16px', fontSize: '0.6875rem', color: '#92400E', fontWeight: 600, flexShrink: 0, textAlign: 'center' }}>
          Running in verbose mode — Ana reasoning visible
        </div>
      )}

      {/* Chat area — scrollable, fills all available space between header and input */}
      <div
        ref={chatRef}
        className="survey-chat"
        style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '12px 12px', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, background: '#FFFFFF', '--scrollbar-color': 'rgba(0,0,0,0.15)' } as any}
      />

      {/* Input area — fixed height, max-height to prevent psycho buttons overflowing */}
      <div
        ref={inputRef}
        style={{
          flexShrink: 0,
          padding: '10px 12px',
          paddingBottom: 'max(10px, env(safe-area-inset-bottom))',
          background: '#F6F6F6',
          borderTop: '1px solid #E0E0E0',
          maxHeight: '50vh',
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      />

      {/* Verbose auth modal */}
      {showVerboseAuth && (
        <SanjayModal
          onSuccess={() => { setVerboseMode(true); setShowVerboseAuth(false) }}
          onCancel={() => setShowVerboseAuth(false)}
        />
      )}
    </div>
  )
}
