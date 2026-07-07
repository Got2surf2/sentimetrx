'use client'

import { useEffect, useRef, useCallback, useState, type CSSProperties } from 'react'
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

// ── SurveySession ───────────────────────────────────────────────────────────
// One respondent's run of the survey. In kiosk mode the outer shell remounts
// this with a fresh `key` between guests, which is the cleanest way to reset
// the engine — all of its state lives in refs (state, sessionId, fingerprint,
// section index), so a remount gives a guaranteed-clean slate.
function SurveySession({
  liveStudy, orgName, isLightBg, reducedMotion, kiosk, onComplete,
}: {
  liveStudy: Study
  orgName: string
  isLightBg: boolean
  reducedMotion: boolean
  kiosk: boolean
  onComplete: () => void
}) {
  const chatRef    = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const startedRef = useRef(false)

  const [verboseMode, setVerboseMode] = useState(false)
  const [showVerboseAuth, setShowVerboseAuth] = useState(false)

  const liveConfig = liveStudy.config
  const theme = liveConfig.theme

  // Merge verbose flag into the config the engine sees
  const engineConfig = verboseMode ? { ...liveConfig, testing: true } : liveConfig
  const engineStudy = { ...liveStudy, config: engineConfig }

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

  const { renderInput, deviceBlocked } = useSurveyEngine({
    study: engineStudy, orgName, chatRef, inputRef, scrollBottom, isLightBg,
    reducedMotion, kiosk, onComplete,
    onVerboseRequest: (mode) => { if (mode === 'bypass') { setVerboseMode(true) } else { setShowVerboseAuth(true) } },
  })

  // The shell only mounts this once the study is active, so start immediately.
  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true
      void renderInput('start')
    }
  }, [renderInput])

  // Active survey — device already responded (only block if config restricts it;
  // kiosk mode bypasses this in the engine so deviceBlocked stays false)
  if (deviceBlocked && liveConfig.allowMultipleResponses === false) {
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        background: theme.backgroundColor, overflow: 'hidden',
      }}>
        <div style={{ background: theme.headerGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem', flexShrink: 0 }}>
            {liveStudy.bot_emoji}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: 'white', fontSize: '0.9375rem' }}>{liveStudy.bot_name}</div>
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
          <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.6875rem' }}>Powered by <span style={{ color: 'rgba(255,255,255,0.35)', fontWeight: 500 }}>sentimetrx.ai</span> · <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(255,255,255,0.35)', textDecoration: 'underline' }}>Privacy</a></span>
        </div>
      </div>
    )
  }

  // Active survey
  return (
    <div ref={wrapperRef} data-survey="true" style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#FFFFFF',
      overflow: 'hidden',
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
          {liveStudy.bot_emoji}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'white', fontSize: '0.9375rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{liveStudy.bot_name}</div>
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
              <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: byColor, fontSize: '0.5rem', fontWeight: 500, letterSpacing: '0.04em', textDecoration: 'underline', marginTop: 2 }}>privacy</a>
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
        style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '12px 12px', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, background: '#FFFFFF', '--scrollbar-color': 'rgba(0,0,0,0.15)' } as CSSProperties}
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

// ── Kiosk attract screen ─────────────────────────────────────────────────────
// Resting state on an unattended tablet between guests. Any tap starts a fresh
// survey session.
function AttractScreen({ study, onStart }: { study: Study; onStart: () => void }) {
  const theme = study.config.theme
  return (
    <button
      onClick={onStart}
      style={{
        width: '100%', height: '100%', border: 'none', cursor: 'pointer',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 28, padding: 32, textAlign: 'center',
        background: theme.headerGradient || theme.backgroundColor,
        fontFamily: 'inherit',
      }}
    >
      <div style={{ fontSize: '5rem', lineHeight: 1 }}>{study.bot_emoji}</div>
      <div>
        <div style={{ color: 'white', fontWeight: 800, fontSize: '2rem', marginBottom: 12, letterSpacing: '-0.01em' }}>
          {study.config.kioskAttractHeadline || `We'd love your feedback`}
        </div>
        <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '1.125rem', lineHeight: 1.5, maxWidth: 480 }}>
          {study.config.kioskAttractSubtext || `It only takes a minute — and it's completely anonymous.`}
        </div>
      </div>
      <div style={{
        marginTop: 8, padding: '18px 44px', borderRadius: 999,
        background: 'white', color: theme.primaryColor || '#0a1628',
        fontWeight: 800, fontSize: '1.375rem', letterSpacing: '0.01em',
        boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
      }}>
        Tap to begin →
      </div>
      <div style={{ position: 'absolute', bottom: 'max(20px, env(safe-area-inset-bottom))' }}>
        <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.75rem' }}>Powered by <span style={{ fontWeight: 600 }}>sentimetrx.ai</span></span>
      </div>
    </button>
  )
}

export default function SurveyWidget({ study, orgName = '' }: Props) {
  const searchParams = useSearchParams()
  const kiosk = (() => {
    const v = searchParams.get('kiosk')
    return v === '1' || v === 'true'
  })()

  const [status,       setStatus]      = useState<'checking' | 'active' | 'closed' | 'draft' | 'error'>('checking')
  const [liveBotName,  setLiveBotName]  = useState(study.bot_name)
  const [liveBotEmoji, setLiveBotEmoji] = useState(study.bot_emoji)
  const [liveConfig,   setLiveConfig]   = useState(study.config)

  // Kiosk lifecycle: between guests we sit on an attract screen, and each guest
  // gets a fresh SurveySession via an incrementing remount key.
  const [phase,  setPhase]  = useState<'attract' | 'survey'>(kiosk ? 'attract' : 'survey')
  const [runKey, setRunKey] = useState(0)

  // Merge live values into the study object for the session and shell screens
  const liveStudy = { ...study, bot_name: liveBotName, bot_emoji: liveBotEmoji, config: liveConfig }

  const theme = liveConfig.theme

  // Detect if background is light — used to flip text/border colors across the survey
  const isLightBg = (() => {
    const hex = (theme.backgroundColor || '#1a1a2e').replace('#', '')
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16)
    return (r * 299 + g * 587 + b * 114) / 1000 > 150
  })()

  // Detect reduced motion preference from device accessibility settings
  const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches

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

  // Respect device accessibility: compute font size as a scale factor on the
  // browser's default (typically 16px, but larger if user has OS/browser text
  // scaling enabled). This way surveyFontSize=18 means "112.5% of device default"
  // rather than a hard 18px that ignores accessibility settings. Kiosk mode
  // nudges this up so a wall/counter tablet reads from arm's length.
  const configFontPx = liveConfig.surveyFontSize || 18
  const baseFontSize = (((configFontPx * (kiosk ? 1.15 : 1)) / 16) * 100) + '%'

  // Set the root font-size so all rem units scale proportionally.
  // Using % preserves the user's device text-size preference as a base.
  useEffect(() => {
    const prev = document.documentElement.style.fontSize
    document.documentElement.style.fontSize = baseFontSize
    return () => { document.documentElement.style.fontSize = prev }
  }, [baseFontSize])

  const resetToAttract = useCallback(() => {
    setRunKey(k => k + 1)
    setPhase('attract')
  }, [])

  const startSurvey = useCallback(() => {
    setRunKey(k => k + 1)
    setPhase('survey')
  }, [])

  // Kiosk auto-reset after completion: the engine fires onComplete once the
  // closing card is shown; hold it briefly so the guest sees the thank-you,
  // then return to the attract screen for the next person.
  const handleComplete = useCallback(() => {
    if (!kiosk) return
    setTimeout(resetToAttract, 7000)
  }, [kiosk, resetToAttract])

  // Kiosk idle-abandon: if a guest walks away mid-survey, reset to attract after
  // 90s of no interaction so the next person finds a clean slate. (Any partial
  // answers were already saved server-side by the engine's debounced autosave.)
  useEffect(() => {
    if (!kiosk || phase !== 'survey') return
    let timer: ReturnType<typeof setTimeout>
    const poke = () => {
      clearTimeout(timer)
      timer = setTimeout(resetToAttract, 90_000)
    }
    poke()
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'click']
    events.forEach(e => window.addEventListener(e, poke, { passive: true }))
    return () => {
      clearTimeout(timer)
      events.forEach(e => window.removeEventListener(e, poke))
    }
  }, [kiosk, phase, runKey, resetToAttract])

  if (status === 'checking') {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.backgroundColor, fontSize: baseFontSize }}>
        <div style={{ display: 'flex', gap: 8, ['--dot-color']: theme.primaryColor || '#00b4d8' } as CSSProperties}>
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
              {isError ? 'We couldn’t load this survey. Please try again later.' : isClosed ? 'Thank you for your interest. This survey is no longer accepting responses.' : "This survey isn't published yet. Please check back soon."}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'center', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
          <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.6875rem' }}>Powered by <span style={{ color: 'rgba(255,255,255,0.35)', fontWeight: 500 }}>sentimetrx.ai</span> · <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'rgba(255,255,255,0.35)', textDecoration: 'underline' }}>Privacy</a></span>
        </div>
      </div>
    )
  }

  // Kiosk resting state between guests
  if (kiosk && phase === 'attract') {
    return (
      <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', fontSize: baseFontSize }}>
        <AttractScreen study={liveStudy} onStart={startSurvey} />
      </div>
    )
  }

  // Active survey — keyed so a kiosk reset gives each guest a fresh engine
  return (
    <div style={{ width: '100%', height: '100%', fontSize: baseFontSize }}>
      <SurveySession
        key={runKey}
        liveStudy={liveStudy}
        orgName={orgName}
        isLightBg={isLightBg}
        reducedMotion={!!prefersReducedMotion}
        kiosk={kiosk}
        onComplete={handleComplete}
      />
    </div>
  )
}
