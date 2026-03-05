'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useSurveyEngine } from './useSurveyEngine'
import type { Study } from '@/lib/types'

interface Props { study: Study }

export default function SurveyWidget({ study }: Props) {
  const chatRef    = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLDivElement>(null)
  const startedRef = useRef(false)
  const [status, setStatus] = useState<'checking' | 'active' | 'closed' | 'draft'>('checking')

  const scrollBottom = useCallback(() => {
    setTimeout(() => {
      if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
    }, 60)
  }, [])

  const { renderInput } = useSurveyEngine({ study, chatRef, inputRef, scrollBottom })

  // ── Heartbeat: verify study is still active before starting ──
  useEffect(() => {
    console.log('study object:', study.id, study.guid, study.name)
    fetch(`/api/study/${study.guid}`, { cache: 'no-store' })
      .then(res => {
        if (res.ok) {
          setStatus('active')
        } else if (res.status === 403) {
          // Study exists but not active — check what status it is
          setStatus('closed')
        } else {
          setStatus('closed')
        }
      })
      .catch(() => setStatus('closed'))
  }, [study.guid])

  // ── Start survey only once status confirmed active ────────────
  useEffect(() => {
    if (status === 'active' && !startedRef.current) {
      startedRef.current = true
      renderInput('start')
    }
  }, [status, renderInput])

  const theme = study.config.theme

  // ── Closed / draft state ──────────────────────────────────────
  if (status === 'checking') {
    return (
      <div
        className="w-full max-w-sm rounded-2xl overflow-hidden flex flex-col items-center justify-center shadow-2xl"
        style={{
          height: 'min(700px, calc(100vh - 32px))',
          background: theme.backgroundColor,
          border: `1px solid ${theme.primaryColor}28`,
        }}
      >
        <div className="flex gap-1.5">
          {[0, 150, 300].map(d => (
            <span key={d} className="typing-dot" style={{ animationDelay: `${d}ms` }} />
          ))}
        </div>
      </div>
    )
  }

  if (status === 'closed' || status === 'draft') {
    return (
      <div
        className="w-full max-w-sm rounded-2xl overflow-hidden flex flex-col shadow-2xl"
        style={{
          height: 'min(700px, calc(100vh - 32px))',
          background: theme.backgroundColor,
          border: `1px solid ${theme.primaryColor}28`,
          boxShadow: `0 50px 100px rgba(0,0,0,0.7), 0 0 0 1px ${theme.primaryColor}20`,
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 flex-shrink-0" style={{ background: theme.headerGradient }}>
          <div className="w-11 h-11 rounded-full flex items-center justify-center text-xl flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.15)' }}>
            {study.bot_emoji}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-white text-lg leading-tight">{study.bot_name}</div>
            <div className="text-white/60 text-xs mt-0.5 uppercase tracking-wide">{study.name}</div>
          </div>
        </div>

        {/* Closed message */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-4">
          <div className="text-5xl">{status === 'closed' ? '🔒' : '🚧'}</div>
          <div>
            <h2 className="text-white font-bold text-lg mb-2">
              {status === 'closed' ? 'This survey is now closed' : 'Not yet available'}
            </h2>
            <p className="text-white/50 text-sm leading-relaxed">
              {status === 'closed'
                ? 'Thank you for your interest. This survey is no longer accepting responses.'
                : "This survey isn't published yet. Please check back soon."}
            </p>
          </div>
        </div>

        <div className="pb-4 text-center">
          <p className="text-white/20 text-xs">Powered by <span className="text-white/40 font-medium">sentimetrx.ai</span></p>
        </div>
      </div>
    )
  }

  // ── Active survey ─────────────────────────────────────────────
  return (
    <div
      className="w-full max-w-sm rounded-2xl overflow-hidden flex flex-col shadow-2xl"
      style={{
        height: 'min(700px, calc(100vh - 32px))',
        background: theme.backgroundColor,
        border: `1px solid ${theme.primaryColor}28`,
        boxShadow: `0 50px 100px rgba(0,0,0,0.7), 0 0 0 1px ${theme.primaryColor}20`,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 flex-shrink-0" style={{ background: theme.headerGradient }}>
        <div className="w-11 h-11 rounded-full flex items-center justify-center text-xl flex-shrink-0"
          style={{ background: 'rgba(255,255,255,0.15)' }}>
          {study.bot_emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white text-lg leading-tight">{study.bot_name}</div>
          <div className="text-white/60 text-xs mt-0.5 uppercase tracking-wide">{study.name}</div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="live-dot" />
            <span className="text-white/50 text-xs">Ready for your feedback</span>
          </div>
        </div>
      </div>

      {/* Chat area */}
      <div ref={chatRef} className="survey-chat flex-1 overflow-y-auto px-3.5 py-4 flex flex-col gap-2.5" />

      {/* Input area */}
      <div ref={inputRef} className="px-3 pb-3.5 pt-2.5 flex-shrink-0"
        style={{ background: `${theme.backgroundColor}ee`, borderTop: `1px solid ${theme.primaryColor}14` }} />
    </div>
  )
}
