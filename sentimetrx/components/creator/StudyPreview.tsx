'use client'

import type { StudyDraft } from '@/lib/studyDraft'

interface Props { draft: StudyDraft }

export default function StudyPreview({ draft }: Props) {
  const { bot_name, bot_emoji, config: c } = draft
  const theme = c.theme

  // Detect light vs dark background
  const isLight = (() => {
    const hex = (theme.backgroundColor || '#1a1a2e').replace('#', '')
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16)
    return (r * 299 + g * 587 + b * 114) / 1000 > 150
  })()
  const P = {
    text:     isLight ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.88)',
    textMute: isLight ? 'rgba(0,0,0,0.4)'  : 'rgba(255,255,255,0.4)',
    textFaint:isLight ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.3)',
    bubbleBg: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.07)',
    bubbleBdr:isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)',
    btnBg:    isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)',
    btnBdr:   isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.08)',
    inputBg:  isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)',
    inputTx:  isLight ? 'rgba(0,0,0,0.3)'  : 'rgba(255,255,255,0.3)',
  }

  const greeting = c.greeting || `Hi there — I'm ${bot_name || 'your bot'} 👋`

  return (
    <div
      className="w-72 rounded-2xl overflow-hidden flex flex-col shadow-2xl"
      style={{
        height: '500px',
        background: theme.backgroundColor,
        border: `1px solid ${theme.primaryColor}28`,
        boxShadow: `0 30px 60px rgba(0,0,0,0.6), 0 0 0 1px ${theme.primaryColor}20`,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3.5 flex-shrink-0"
        style={{ background: theme.headerGradient }}
      >
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-lg flex-shrink-0"
          style={{ background: 'rgba(255,255,255,0.15)' }}
        >
          {bot_emoji || '💬'}
        </div>
        <div>
          <div className="font-semibold text-white text-sm leading-tight">
            {bot_name || 'Your Bot'}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ background: theme.accentColor, boxShadow: `0 0 6px ${theme.accentColor}` }}
            />
            <span className="text-white/50 text-xs">Ready for your feedback</span>
          </div>
        </div>
      </div>

      {/* Chat */}
      <div className="flex-1 px-3 py-3 flex flex-col gap-2.5 overflow-hidden">

        {/* Bot greeting */}
        <BotMsg text={greeting} emoji={bot_emoji} theme={theme} P={P} />

        {/* Bot follow-up */}
        <BotMsg text="Ready to share your feedback?" emoji={bot_emoji} theme={theme} P={P} />

        {/* User yes */}
        <div className="flex justify-end">
          <div
            className="px-3.5 py-2 rounded-2xl rounded-br-sm text-xs font-medium text-white max-w-[80%]"
            style={{ background: theme.primaryColor }}
          >
            Yes, let's go! 👍
          </div>
        </div>

        {/* Rating prompt — only if experience rating enabled */}
        {c.experienceEnabled !== false && (
          <>
            <BotMsg text={c.ratingPrompt || 'How was your experience?'} emoji={bot_emoji} theme={theme} P={P} />

            {/* Rating scale preview */}
            <div className="flex gap-1 flex-wrap">
              {c.ratingScale.slice(0, 5).map((r, i) => (
                <div
                  key={i}
                  className="flex flex-col items-center gap-0.5 rounded-xl px-1.5 py-2 flex-1"
                  style={{
                    background: i === 4 ? `${theme.primaryColor}20` : P.btnBg,
                    border: `2px solid ${i === 4 ? theme.primaryColor : P.btnBdr}`,
                  }}
                >
                  <span className="text-sm">{r.emoji}</span>
                  <span className="text-center leading-tight" style={{ fontSize: '7px', color: P.textMute }}>
                    {r.label}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* NPS prompt — only if NPS enabled and experience disabled (otherwise NPS comes later) */}
        {c.npsEnabled !== false && c.experienceEnabled === false && (
          <>
            <BotMsg text={c.npsPrompt || 'How likely are you to recommend us?'} emoji={bot_emoji} theme={theme} P={P} />
            <div className="flex gap-0.5 flex-wrap justify-center">
              {Array.from({ length: 5 }, (_, i) => (
                <div
                  key={i}
                  className="flex items-center justify-center rounded-lg"
                  style={{
                    width: 28, height: 28,
                    background: i === 4 ? `${theme.primaryColor}20` : P.btnBg,
                    border: `2px solid ${i === 4 ? theme.primaryColor : P.btnBdr}`,
                    color: P.textMute, fontSize: '9px', fontWeight: 700,
                  }}
                >
                  {i + 1}
                </div>
              ))}
              <span className="text-xs self-center ml-1" style={{ color: P.textFaint }}>... 10</span>
            </div>
          </>
        )}
      </div>

      {/* Input area hint */}
      <div
        className="px-3 py-2.5 flex-shrink-0 flex items-center gap-2"
        style={{
          background: `${theme.backgroundColor}ee`,
          borderTop: `1px solid ${theme.primaryColor}14`,
        }}
      >
        <div
          className="flex-1 px-3 py-2 rounded-xl text-xs"
          style={{ background: P.inputBg, color: P.inputTx }}
        >
          Share your thoughts...
        </div>
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
          style={{ background: theme.primaryColor, color: '#fff' }}
        >
          →
        </div>
      </div>
    </div>
  )
}

function BotMsg({ text, emoji, theme, P }: { text: string; emoji: string; theme: any; P: Record<string, string> }) {
  return (
    <div className="flex items-end gap-2">
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0"
        style={{ background: theme.botAvatarGradient }}
      >
        {emoji || '💬'}
      </div>
      <div
        className="px-3 py-2 rounded-2xl rounded-bl-sm text-xs leading-relaxed max-w-[85%]"
        style={{
          background: P.bubbleBg,
          color: P.text,
          border: '1px solid ' + P.bubbleBdr,
        }}
      >
        {text}
      </div>
    </div>
  )
}
