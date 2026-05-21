'use client'

// CanvasShell — landscape layout wrapping ChatPane (left, 40%) and a
// canvas slot (right, 60%) that swaps between four card types. Mode
// switcher in the demo strip is dev-only; in production, the mode is
// auto-detected by app/demo/mco/page.tsx (URL params → geo → UA → default).

import { useEffect, useMemo, useState } from 'react'
import ChatPane from './components/ChatPane'
import TerminalMapCard from './components/TerminalMapCard'
import RestaurantsCard from './components/RestaurantsCard'
import ParkingCard from './components/ParkingCard'
import LinkCard from './components/LinkCard'
import type { DeploymentMode, UiHint } from '@/lib/uiHints'
import './canvas.css'

interface ModeConfig {
  subtitle: string
  greeting: string
  chips: string[]
  placeholder: string
  defaultHint: number
  contextStripe?: string
}

const MODE_CONFIG: Record<DeploymentMode, ModeConfig> = {
  home: {
    subtitle: 'Orlando International Airport · Planning your trip',
    greeting: "Hi, I'm Ana — your guide to Orlando International Airport. Heading to MCO? I can help you plan parking, terminals, security, and how to get there. Just ask.",
    chips: ['How early should I arrive?', 'Where should I park?', 'Cheapest way to get to MCO?', 'What is MCO Reserve?'],
    placeholder: 'Ask Ana about MCO…',
    defaultHint: 0,
  },
  invenue: {
    subtitle: "You're at MCO · Terminal B",
    greeting: "Hi, I'm Ana. Looks like you're at Terminal B from the entrance QR scan — let me know if that's off. What can I help you with right now?",
    chips: ["Where's gate B22?", 'Security wait now?', 'Closest restroom', 'Bag claim — Delta'],
    placeholder: 'Ask anything about MCO right now…',
    defaultHint: 1,
    contextStripe: "You're at MCO · Terminal B · from entrance QR scan",
  },
  kiosk: {
    subtitle: 'Orlando International Airport · Touch a question or ask your own',
    greeting: "Hi! Ask me anything about Orlando International Airport. Touch a question below — and tap the QR icon any time to send what we discussed straight to your phone.",
    chips: ['Find a restaurant', "Where's my gate?", 'Parking availability', 'Getting to my flight', 'Help finding the train station'],
    placeholder: 'Touch the keyboard or pick a question…',
    defaultHint: 0,
  },
}

// Demo hints — in Commit 3 these will be replaced by the real ui_hints
// extractor running after each assistant turn. v1 just shows representative
// content driven by the demo strip / turn clicks.
const DEMO_HINTS: UiHint[] = [
  { type: 'terminal_map', from: 'C', to: 'A', via: 'terminal_link_apm' },
  { type: 'restaurants', place_ids: [], context: 'terminal_a_airside' },
  { type: 'parking', highlight: ['garage_c'] },
  {
    type: 'link_card',
    title: 'MCO Reserve',
    body: "MCO Reserve is a free service that lets passengers without TSA PreCheck or CLEAR+ book a dedicated time slot to go through security at Orlando International Airport.\n\nPick a window when you arrive, show your reservation at the security checkpoint, and skip into a shorter line. Spots are released throughout the day on a first-come, first-served basis.\n\nBest for: peak departure windows (4-7 AM and 1-4 PM), families with children, or anyone who wants to lock in their security time before getting to the airport.",
    cta_url: 'https://flymco.com/speed-through-mco',
    cta_label: 'Reserve a time slot',
  },
]

function HintRenderer({ hint }: { hint: UiHint }) {
  if (hint.type === 'terminal_map') return <TerminalMapCard hint={hint} />
  if (hint.type === 'restaurants') return <RestaurantsCard hint={hint} />
  if (hint.type === 'parking') return <ParkingCard hint={hint} />
  if (hint.type === 'link_card') return <LinkCard hint={hint} />
  return null
}

interface Props {
  initialMode: DeploymentMode
}

export default function CanvasShell({ initialMode }: Props) {
  const [mode, setMode] = useState<DeploymentMode>(initialMode)
  const config = MODE_CONFIG[mode]

  const [hintIdx, setHintIdx] = useState<number>(config.defaultHint)
  useEffect(() => { setHintIdx(MODE_CONFIG[mode].defaultHint) }, [mode])

  const hint = useMemo(() => DEMO_HINTS[hintIdx], [hintIdx])

  // Keyboard shortcuts for the boardroom demo: 1/2/3 = modes, ←/→ = cards.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if (e.key === 'ArrowRight') setHintIdx((i) => (i + 1) % DEMO_HINTS.length)
      else if (e.key === 'ArrowLeft') setHintIdx((i) => (i - 1 + DEMO_HINTS.length) % DEMO_HINTS.length)
      else if (e.key === '1') setMode('home')
      else if (e.key === '2') setMode('invenue')
      else if (e.key === '3') setMode('kiosk')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // When the chat thread surfaces an active assistant turn, swap the
  // canvas to whatever hint corresponds to that turn. Commit 3 wires this
  // up to the real extractor.
  function onActiveTurnChange(turnIdx: number) {
    // For now: clicking an Ana turn cycles to the next demo hint
    setHintIdx((i) => (i + 1) % DEMO_HINTS.length)
  }

  return (
    <div className={'canvas-shell mode-' + mode}>
      <div className="topbar">
        <div className="brand">
          <div className="avatar">✈️</div>
          <div className="brand-stack">
            <div className="brand-name">AskAna</div>
            <div className="brand-subtitle">{config.subtitle}</div>
          </div>
        </div>
        <button className="qr-btn" title="Send to my phone" aria-label="Send to my phone">
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
        </button>
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
            onActiveTurnChange={onActiveTurnChange}
          />
        </div>

        <div className="canvas-right">
          <div className="canvas-card">
            <HintRenderer hint={hint} />
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
        <button className="demo-arrow" onClick={() => setHintIdx((i) => (i - 1 + DEMO_HINTS.length) % DEMO_HINTS.length)} aria-label="Previous card">‹</button>
        <span className="demo-pos">{hintIdx + 1} / {DEMO_HINTS.length}</span>
        <button className="demo-arrow" onClick={() => setHintIdx((i) => (i + 1) % DEMO_HINTS.length)} aria-label="Next card">›</button>
      </div>
    </div>
  )
}
