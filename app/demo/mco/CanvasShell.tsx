'use client'

// CanvasShell — landscape layout wrapping ChatPane (left, 40%) and a
// canvas slot (right, 60%) that swaps between four card types. Mode
// switcher in the demo strip is dev-only; in production, the mode is
// auto-detected by app/demo/mco/page.tsx (URL params → geo → UA → default).

import { useEffect, useState } from 'react'
import ChatPane, { type ChatMessage } from './components/ChatPane'
import TerminalMapCard from './components/TerminalMapCard'
import RestaurantsCard from './components/RestaurantsCard'
import ShopsCard from './components/ShopsCard'
import ParkingCard from './components/ParkingCard'
import LinkCard from './components/LinkCard'
import SecurityWaitCard from './components/SecurityWaitCard'
import IndoorMapCard from './components/IndoorMapCard'
import WelcomeCard from './components/WelcomeCard'
import QRHandoffModal from './components/QRHandoffModal'
import type { DeploymentMode, ExtractorContext, UiHint } from '@/lib/uiHints'
import './canvas.css'

// Derive the active terminal the user is anchored to from the current canvas
// hint. Used to keep restaurants/parking scoped to that terminal across turns
// (the extractor receives this via the context block and respects it unless
// the user explicitly switches terminals).
function deriveActiveTerminal(hint: UiHint | null): 'A' | 'B' | 'C' | undefined {
  if (!hint) return undefined
  if (hint.type === 'terminal_map') {
    return hint.to || hint.from || hint.terminal
  }
  if (hint.type === 'indoor_map') {
    return hint.terminal
  }
  if ((hint.type === 'restaurants' || hint.type === 'shops') && hint.context) {
    const m = /^terminal_([abc])_/i.exec(hint.context)
    if (m) return m[1].toUpperCase() as 'A' | 'B' | 'C'
  }
  if (hint.type === 'parking' && hint.highlight && hint.highlight.length === 1) {
    const m = /^garage_([abc])$/i.exec(hint.highlight[0])
    if (m) return m[1].toUpperCase() as 'A' | 'B' | 'C'
  }
  return undefined
}

interface ModeConfig {
  subtitle: string
  greeting: string
  chips: string[]
  placeholder: string
  defaultHint: number
  contextStripe?: string
  demoHints: UiHint[]
}

const MCO_RESERVE_HINT: UiHint = {
  type: 'link_card',
  title: 'MCO Reserve',
  body: "MCO Reserve is a free service that lets passengers without TSA PreCheck or CLEAR+ book a dedicated time slot to go through security at Orlando International Airport.\n\nPick a window when you arrive, show your reservation at the security checkpoint, and skip into a shorter line. Spots are released throughout the day on a first-come, first-served basis.\n\nBest for: peak departure windows (4-7 AM and 1-4 PM), families with children, or anyone who wants to lock in their security time before getting to the airport.",
  cta_url: 'https://flymco.com/speed-through-mco',
  cta_label: 'Reserve a time slot',
}

const MODE_CONFIG: Record<DeploymentMode, ModeConfig> = {
  home: {
    subtitle: 'Orlando International Airport · Planning your trip',
    greeting: "Hi, I'm Ana — your guide to Orlando International Airport. Heading to MCO? I can help you plan parking, terminals, security, and how to get there. Just ask.",
    chips: ['How early should I arrive?', 'Where should I park?', 'Cheapest way to get to MCO?', 'What is MCO Reserve?'],
    placeholder: 'Ask Ana about MCO…',
    defaultHint: 0,
    demoHints: [
      { type: 'welcome' },
      { type: 'terminal_map', from: 'C', to: 'A', via: 'terminal_link_apm' },
      { type: 'restaurants', place_ids: [], context: 'terminal_a_airside' },
      { type: 'parking', highlight: ['garage_c'] },
      MCO_RESERVE_HINT,
    ],
  },
  invenue: {
    subtitle: "You're at MCO · Terminal B",
    greeting: "Hi, I'm Ana. Looks like you're at Terminal B from the entrance QR scan — let me know if that's off. What can I help you with right now?",
    chips: ["Where's gate B22?", 'Security wait now?', 'Closest restroom', 'Bag claim — Delta'],
    placeholder: 'Ask anything about MCO right now…',
    defaultHint: 0,
    contextStripe: "You're at MCO · Terminal B · from entrance QR scan",
    demoHints: [
      { type: 'welcome' },
      { type: 'terminal_map', from: 'A', to: 'B' },
      { type: 'restaurants', place_ids: [], context: 'terminal_b_airside' },
      { type: 'parking', highlight: ['garage_b'] },
      MCO_RESERVE_HINT,
    ],
  },
  kiosk: {
    subtitle: 'Orlando International Airport · Touch a question or ask your own',
    greeting: "Hi! Ask me anything about Orlando International Airport. Touch a question below — and tap the QR icon any time to send what we discussed straight to your phone.",
    chips: ['Find a restaurant', "Where's my gate?", 'Security wait times', 'Getting to my flight', 'Help finding the train station'],
    placeholder: 'Touch the keyboard or pick a question…',
    defaultHint: 0,
    demoHints: [
      { type: 'welcome' },
      { type: 'terminal_map', from: 'C', to: 'A', via: 'terminal_link_apm' },
      { type: 'restaurants', place_ids: [], context: 'terminal_a_airside' },
      MCO_RESERVE_HINT,
    ],
  },
}

function HintRenderer({ hint, mode, onTileClick }: { hint: UiHint; mode: DeploymentMode; onTileClick?: (prompt: string) => void }) {
  if (hint.type === 'welcome') return <WelcomeCard hint={{ ...hint, mode }} onTileClick={onTileClick} />
  if (hint.type === 'terminal_map') return <TerminalMapCard hint={hint} />
  if (hint.type === 'restaurants') return <RestaurantsCard hint={hint} />
  if (hint.type === 'shops') return <ShopsCard hint={hint} />
  if (hint.type === 'parking') return <ParkingCard hint={hint} />
  if (hint.type === 'security_wait') return <SecurityWaitCard hint={hint} />
  if (hint.type === 'indoor_map') return <IndoorMapCard hint={hint} />
  if (hint.type === 'link_card') return <LinkCard hint={hint} mode={mode} />
  return null
}

interface Props {
  initialMode: DeploymentMode
  botOverride?: string | null
}

export default function CanvasShell({ initialMode, botOverride }: Props) {
  const [mode, setMode] = useState<DeploymentMode>(initialMode)
  const config = MODE_CONFIG[mode]

  // Two hint sources, in priority order:
  //   liveHint  — emitted by the ui-hints extractor after a real chat turn
  //   demoIdx   — index into DEMO_HINTS, driven by the demo strip (left/right
  //               arrow buttons or keyboard arrows). The mode's defaultHint
  //               seeds this when the page first loads or the mode changes.
  // When liveHint is set, it wins. Switching mode or clicking a demo arrow
  // clears liveHint so the demo strip can take back control.
  const [demoIdx, setDemoIdx] = useState<number>(config.defaultHint)
  const [liveHint, setLiveHint] = useState<UiHint | null>(null)
  const [extracting, setExtracting] = useState(false)
  const [pendingMessage, setPendingMessage] = useState<string | null>(null)

  // Listen for "mco:prompt" custom events fired by deep cards (e.g. the
  // flight-prep panel's "Dining nearby" chip) and submit them as user
  // messages. Avoids prop-drilling onTileClick through every card.
  useEffect(() => {
    function onPrompt(e: Event) {
      const detail = (e as CustomEvent).detail
      if (typeof detail === 'string' && detail.length > 0) setPendingMessage(detail)
    }
    window.addEventListener('mco:prompt', onPrompt as EventListener)
    return () => window.removeEventListener('mco:prompt', onPrompt as EventListener)
  }, [])
  const [resetKey, setResetKey] = useState(0)
  const [showQR, setShowQR] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatSessionId, setChatSessionId] = useState('')
  const [chatBotId, setChatBotId] = useState('')

  function clearConversation() {
    setResetKey(k => k + 1)
    setLiveHint(null)
    setDemoIdx(MODE_CONFIG[mode].defaultHint)
    setShowQR(false)
  }

  // Kiosk auto-reset: after 60s of no interaction, clear the conversation
  // and return to the welcome card. Matches the LinkCardModal kiosk timeout.
  // Resets on pointer / keyboard / touch activity. Non-kiosk modes are
  // exempt — home and invenue sessions are personal devices.
  //
  // Paused while the QR modal is open so the user has time to scan the code
  // from their phone (which they're doing AWAY from the kiosk's pointer/
  // touch surface — the timer would otherwise fire and close the modal).
  useEffect(() => {
    if (mode !== 'kiosk') return
    if (showQR) return
    let timer: ReturnType<typeof setTimeout>
    function poke() {
      clearTimeout(timer)
      timer = setTimeout(clearConversation, 60_000)
    }
    poke()
    const events: Array<keyof WindowEventMap> = ['pointermove', 'keydown', 'touchstart', 'click']
    events.forEach(e => window.addEventListener(e, poke, { passive: true }))
    return () => {
      clearTimeout(timer)
      events.forEach(e => window.removeEventListener(e, poke))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, resetKey, showQR])

  useEffect(() => {
    const c = MODE_CONFIG[mode]
    setDemoIdx(i => Math.min(i, c.demoHints.length - 1))
    setLiveHint(null)   // mode change resets to demo state
  }, [mode])

  const hint: UiHint = liveHint ?? config.demoHints[demoIdx]

  // Active context threaded into the extractor on each /ui-hints call so it
  // can keep restaurants/parking scoped to the user's anchored terminal and
  // decide when to revert the canvas on off-topic pivots. Derived from
  // what's currently rendered on the right pane, with invenue mode's
  // structural Terminal B as a fallback.
  const activeContext: ExtractorContext = {
    activeTerminal: deriveActiveTerminal(hint) || (mode === 'invenue' ? 'B' : undefined),
    lastCanvasType: hint.type,
  }

  function cycleDemo(delta: number) {
    setLiveHint(null)
    setDemoIdx((i) => (i + delta + config.demoHints.length) % config.demoHints.length)
  }

  // Keyboard shortcuts for the boardroom demo: 1/2/3 = modes, ←/→ = cards.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if (e.key === 'ArrowRight') cycleDemo(1)
      else if (e.key === 'ArrowLeft') cycleDemo(-1)
      else if (e.key === '1') setMode('home')
      else if (e.key === '2') setMode('invenue')
      else if (e.key === '3') setMode('kiosk')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={'canvas-shell mode-' + mode}>
      <div className="topbar">
        <div className="brand">
          <div className="avatar avatar-mco"><img src="/mco/logo-mark.png" alt="MCO" /></div>
          <div className="brand-stack">
            <div className="brand-name">AskAna</div>
            <div className="brand-subtitle">{config.subtitle}</div>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            className="topbar-btn"
            title="Clear conversation"
            aria-label="Clear conversation"
            onClick={clearConversation}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={18} height={18}>
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <polyline points="3 4 3 10 9 10" />
            </svg>
          </button>
          <button
            className="topbar-btn qr-btn"
            title="Continue on your phone"
            aria-label="Continue on your phone"
            onClick={() => setShowQR(true)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={18} height={18}>
              <rect x="3" y="3" width="7" height="7" />
              <rect x="14" y="3" width="7" height="7" />
              <rect x="3" y="14" width="7" height="7" />
              <line x1="14" y1="14" x2="14" y2="18" />
              <line x1="18" y1="14" x2="21" y2="14" />
              <line x1="14" y1="21" x2="21" y2="21" />
              <line x1="21" y1="14" x2="21" y2="18" />
              <line x1="18" y1="18" x2="18" y2="21" />
            </svg>
            <span className="topbar-btn-label">Send to phone</span>
          </button>
        </div>
      </div>

      <div className="canvas-main">
        <div className="canvas-left">
          {config.contextStripe && (
            <div className="context-stripe">
              <span>📍</span>
              <span><strong>{config.contextStripe}</strong></span>
              <span className="change">Change</span>
            </div>
          )}
          <ChatPane
            mode={mode}
            greeting={config.greeting}
            chips={config.chips}
            placeholder={config.placeholder}
            botOverride={botOverride}
            activeContext={activeContext}
            pendingMessage={pendingMessage}
            onPendingMessageConsumed={() => setPendingMessage(null)}
            resetKey={resetKey}
            onHintReceived={(h) => setLiveHint(h)}
            onExtractingChange={setExtracting}
            onMessagesChange={setChatMessages}
            onSessionIdChange={setChatSessionId}
            onBotIdChange={setChatBotId}
          />
        </div>

        <div className="canvas-right">
          <div className={'canvas-card' + (extracting ? ' extracting' : '')}>
            {extracting && <div className="extracting-bar" aria-hidden />}
            <HintRenderer hint={hint} mode={mode} onTileClick={(p) => setPendingMessage(p)} />
          </div>
        </div>
      </div>

      <div className="demo-strip" title="In production, mode is auto-detected. This switcher is for the mockup only.">
        <span className="demo-label">Demo</span>
        <div className="mode-pills">
          {(['home', 'invenue', 'kiosk'] as DeploymentMode[]).map((m) => (
            <button key={m} className={'mode-pill' + (mode === m ? ' active' : '')} onClick={() => setMode(m)}>
              {m === 'invenue' ? 'In-venue' : m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        <span className="demo-sep" />
        <button className="demo-arrow" onClick={() => cycleDemo(-1)} aria-label="Previous demo card">‹</button>
        <span className="demo-pos">{liveHint ? 'live' : (demoIdx + 1) + ' / ' + config.demoHints.length}</span>
        <button className="demo-arrow" onClick={() => cycleDemo(1)} aria-label="Next demo card">›</button>
      </div>

      {showQR && chatBotId && chatSessionId && (
        <QRHandoffModal
          botId={chatBotId}
          sessionId={chatSessionId}
          messages={chatMessages}
          onClose={() => setShowQR(false)}
        />
      )}
    </div>
  )
}
