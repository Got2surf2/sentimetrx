'use client'

// components/agent/ContentSafetyEditor.tsx
//
// Shared content-safety configuration UI used by:
//   - app/pulseiq/new/NewSessionClient.tsx
//   - app/pulseiq/[sessionId]/SessionDetailClient.tsx (toggle-only mode)
//   - app/bots/new/page.tsx
//
// Bots and town-hall sessions use the same shape under the hood
// (`config.content_safety`) consumed by the same lib/contentGuard pipeline,
// so this is the one editor for both. Pass a flat ContentSafetyConfig and
// receive a flat patch via onChange — the parent owns the storage shape.

export interface ContentSafetyConfigValue {
  enabled?:   boolean
  profanity?: boolean
  slurs?:     boolean
  threats?:   boolean
  sexual?:    boolean
  insults?:   boolean
  spam?:      boolean
}

interface Props {
  value: ContentSafetyConfigValue | undefined
  onChange: (patch: ContentSafetyConfigValue) => void
  /** When true, only render the master toggle + the off-state hint. Use on
   *  detail pages where the full options panel doesn't fit. */
  compact?: boolean
  /** Override the heading + helper text. */
  title?: string
  description?: string
}

const OPTIONS: { key: keyof ContentSafetyConfigValue; label: string; desc: string }[] = [
  { key: 'profanity', label: 'Profanity',          desc: 'Block/bleep swear words' },
  { key: 'slurs',     label: 'Slurs',              desc: 'Block racial and identity slurs' },
  { key: 'threats',   label: 'Threats & Violence', desc: 'Block violent language and threats' },
  { key: 'sexual',    label: 'Sexual Content',     desc: 'Block explicit sexual language' },
  { key: 'insults',   label: 'Insults & Rudeness', desc: 'Gentle nudge when participants are rude' },
  { key: 'spam',      label: 'URLs / Spam',        desc: 'Block links and URLs' },
]

export default function ContentSafetyEditor({ value, onChange, compact, title, description }: Props) {
  const cs = value || {}
  const enabled = cs.enabled !== false   // default ON
  const isOn = (key: keyof ContentSafetyConfigValue) => cs[key] !== false

  function masterToggle() {
    const next = !enabled
    if (!next) {
      onChange({ enabled: false })
    } else {
      // Re-enabling brings every category back on so users don't end up in
      // a confusing "enabled but everything disabled" state.
      onChange({ enabled: true, profanity: true, slurs: true, threats: true, sexual: true, insults: true, spam: true })
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-bold text-gray-700">{title || 'Content Safety'}</h3>
          <p className="text-xs text-gray-400 mt-0.5">{description || 'Filter and bleep inappropriate content. Participants get warnings and may be shut down after repeated severe violations.'}</p>
        </div>
        <button type="button" onClick={masterToggle}
          aria-label="Toggle content safety"
          className={'relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 ml-4 border-2 border-transparent ' + (enabled ? 'bg-green-500' : 'bg-gray-200')}>
          <span className={'inline-block w-5 h-5 bg-white rounded-full shadow-md transition-transform transform ' + (enabled ? 'translate-x-5' : 'translate-x-0')} />
        </button>
      </div>
      {enabled && !compact && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-3 mb-2">
            <button type="button" onClick={() => onChange({ profanity: true, slurs: true, threats: true, sexual: true, insults: true, spam: true })}
              className="text-[10px] font-semibold text-orange-600 hover:text-orange-800">Select All</button>
            <button type="button" onClick={() => onChange({ profanity: false, slurs: false, threats: false, sexual: false, insults: false, spam: false })}
              className="text-[10px] font-semibold text-gray-400 hover:text-gray-600">Select None</button>
          </div>
          {OPTIONS.map(opt => {
            const on = isOn(opt.key)
            return (
              <button key={opt.key} type="button" onClick={() => onChange({ [opt.key]: !on } as ContentSafetyConfigValue)}
                className="flex items-center gap-2 w-full text-left px-3 py-1.5 rounded-lg text-sm transition-all"
                style={{ background: on ? '#f0fdf4' : '#f9fafb', border: '1.5px solid ' + (on ? '#22c55e' : '#e5e7eb') }}>
                <span className="w-4 h-4 rounded border flex items-center justify-center text-[10px] flex-shrink-0"
                  style={{ borderColor: on ? '#22c55e' : '#d1d5db', background: on ? '#22c55e' : 'white', color: on ? 'white' : 'transparent' }}>
                  {on ? '✓' : ''}
                </span>
                <span className="flex-1">
                  <span style={{ color: on ? '#166534' : '#6b7280', fontWeight: on ? 600 : 400 }}>{opt.label}</span>
                  <span className="text-[10px] text-gray-400 ml-2">{opt.desc}</span>
                </span>
              </button>
            )
          })}
        </div>
      )}
      {!enabled && (
        <p className="text-[10px] text-amber-600">All content filtering is OFF. Suitable for employee feedback or clinical research settings.</p>
      )}
    </div>
  )
}
