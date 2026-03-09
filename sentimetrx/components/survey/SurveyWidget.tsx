'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useSurveyEngine } from './useSurveyEngine'
import type { Study } from '@/lib/types'

interface Props { study: Study }

export default function SurveyWidget({ study }: Props) {
  const chatRef    = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLDivElement>(null)
  const startedRef = useRef(false)
  const [status,       setStatus]      = useState<'checking' | 'active' | 'closed' | 'draft'>('checking')
  const [liveBotName,  setLiveBotName]  = useState(study.bot_name)
  const [liveBotEmoji, setLiveBotEmoji] = useState(study.bot_emoji)
  const [liveConfig,   setLiveConfig]   = useState(study.config)

  // Merge live values into study object for the engine and header
  const liveStudy = { ...study, bot_name: liveBotName, bot_emoji: liveBotEmoji, config: liveConfig }

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

  const { renderInput } = useSurveyEngine({ study: liveStudy, chatRef, inputRef, scrollBottom })

  // Fetch fresh study data on mount — ensures bot_name, bot_emoji, config
  // are always the latest from the DB, not potentially stale server-rendered props
  useEffect(() => {
    fetch(`/api/study/${study.guid}`, { cache: 'no-store' })
      .then(async res => {
        if (!res.ok) { setStatus('closed'); return }
        const data = await res.json()
        // Update live fields from fresh API response
        if (data.bot_name)  setLiveBotName(data.bot_name)
        if (data.bot_emoji) setLiveBotEmoji(data.bot_emoji)
        if (data.config)    setLiveConfig(data.config)
        setStatus('active')
      })
      .catch(() => setStatus('closed'))
  }, [study.guid])

  useEffect(() => {
    if (status === 'active' && !startedRef.current) {
      startedRef.current = true
      renderInput('start')
    }
  }, [status, renderInput])

  const theme = liveConfig.theme

  if (status === 'checking') {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: theme.backgroundColor }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[0, 150, 300].map(d => (
            <span key={d} className="typing-dot" style={{ animationDelay: `${d}ms` }} />
          ))}
        </div>
      </div>
    )
  }

  if (status === 'closed' || status === 'draft') {
    const isClosed = status === 'closed'
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: theme.backgroundColor, overflow: 'hidden' }}>
        <div style={{ background: theme.headerGradient, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
            {liveBotEmoji}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: 'white', fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{liveBotName}</div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{liveStudy.name}</div>
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center', gap: 16 }}>
          <div style={{ fontSize: 48 }}>{isClosed ? '🔒' : '🚧'}</div>
          <div>
            <div style={{ color: 'white', fontWeight: 700, fontSize: 18, marginBottom: 8 }}>{isClosed ? 'This survey is now closed' : 'Not yet available'}</div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, lineHeight: 1.6 }}>
              {isClosed ? 'Thank you for your interest. This survey is no longer accepting responses.' : "This survey isn't published yet. Please check back soon."}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'center', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
          <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11 }}>Powered by <span style={{ color: 'rgba(255,255,255,0.35)', fontWeight: 500 }}>sentimetrx.ai</span></span>
        </div>
      </div>
    )
  }

  // Active survey
  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: theme.backgroundColor,
      overflow: 'hidden',
      // Desktop card style via inline media won't work — handled by page wrapper
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
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
          {liveBotEmoji}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'white', fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{liveBotName}</div>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{liveStudy.name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <span className="live-dot" />
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>Ready for your feedback</span>
          </div>
        </div>
      </div>

      {/* Chat area — scrollable, fills all available space between header and input */}
      <div
        ref={chatRef}
        className="survey-chat"
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '12px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          // Ensure it can shrink
          minHeight: 0,
        }}
      />

      {/* Input area — fixed height, max-height to prevent psycho buttons overflowing */}
      <div
        ref={inputRef}
        style={{
          flexShrink: 0,
          padding: '10px 12px',
          paddingBottom: 'max(10px, env(safe-area-inset-bottom))',
          background: theme.backgroundColor + 'f0',
          borderTop: '1px solid rgba(255,255,255,0.07)',
          maxHeight: '45vh',
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      />
    </div>
  )
}
