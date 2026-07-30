'use client'

// app/th/[token]/PublicTabs.tsx
//
// Tab shell for the public Town Hall report (/th/[token]). The sections are
// rendered on the server and handed in as `content` — this component only owns
// which one is visible, so no report data or fetching logic crosses into the
// client bundle.
//
// Section membership is decided in page.tsx, NOT here: the internal Coverage
// and "Live vs Final" tabs are deliberately never passed in (analyst QC state
// and raw-vs-corrected ASR are process internals, not meeting content).

import { useState, type ReactNode } from 'react'

export interface PublicTab {
  key: string
  label: string
  content: ReactNode
}

export default function PublicTabs({ tabs }: { tabs: PublicTab[] }) {
  const [activeKey, setActiveKey] = useState<string>(tabs[0]?.key ?? '')
  const active = tabs.find(t => t.key === activeKey) ?? tabs[0]

  // A single-section report shouldn't grow a tab bar for one tab.
  if (tabs.length <= 1) return <>{active?.content}</>

  return (
    <>
      <nav className="mb-8 flex flex-wrap gap-1 border-b border-slate-200" aria-label="Report sections">
        {tabs.map(t => {
          const on = t.key === active?.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveKey(t.key)}
              aria-current={on ? 'page' : undefined}
              className={`-mb-px rounded-t-lg border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
                on
                  ? 'border-teal-600 bg-white text-teal-700'
                  : 'border-transparent text-slate-500 hover:bg-white/60 hover:text-slate-800'
              }`}
            >
              {t.label}
            </button>
          )
        })}
      </nav>
      <div>{active?.content}</div>
    </>
  )
}
