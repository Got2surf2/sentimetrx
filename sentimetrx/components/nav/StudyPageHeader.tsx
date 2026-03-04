'use client'

// Shared header bar for Responses and Analytics pages.
// Identical on both pages so there is no layout jump when toggling.

import Link from 'next/link'

interface Props {
  studyId:     string
  studyName:   string
  botEmoji:    string
  activePage:  'responses' | 'analytics'
  // date state — owned by parent
  dateFrom:    string
  dateTo:      string
  onDateFrom:  (v: string) => void
  onDateTo:    (v: string) => void
  onLast30:    () => void
  onAllTime:   () => void
  // export
  onExportCSV: () => void
  exporting?:  boolean
  total?:      number
}

const HERMES = '#E8632A'

export default function StudyPageHeader({
  studyId, studyName, botEmoji, activePage,
  dateFrom, dateTo, onDateFrom, onDateTo, onLast30, onAllTime,
  onExportCSV, exporting = false, total = 0,
}: Props) {
  return (
    <div className="bg-white border-b border-gray-200 px-6 py-3 sticky top-14 z-40 shadow-sm">
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-4 flex-wrap">

        {/* Left: study title */}
        <div className="min-w-0">
          <h1 className="text-base font-bold text-gray-800 truncate">{botEmoji} {studyName}</h1>
          <p className="text-xs text-gray-400 capitalize">{activePage}</p>
        </div>

        {/* Right: toggle + date controls + export */}
        <div className="flex items-center gap-2 flex-wrap">

          {/* Responses / Analytics toggle */}
          <div className="flex items-center bg-gray-100 rounded-xl p-1">
            <Link href={`/studies/${studyId}/responses`}
              className={'text-sm font-medium px-3 py-1.5 rounded-lg transition-all ' +
                (activePage === 'responses' ? 'text-white shadow-sm' : 'text-gray-500 hover:text-gray-700')}
              style={activePage === 'responses' ? { background: HERMES } : {}}>
              Responses
            </Link>
            <Link href={`/studies/${studyId}/analytics`}
              className={'text-sm font-medium px-3 py-1.5 rounded-lg transition-all ' +
                (activePage === 'analytics' ? 'text-white shadow-sm' : 'text-gray-500 hover:text-gray-700')}
              style={activePage === 'analytics' ? { background: HERMES } : {}}>
              Analytics
            </Link>
          </div>

          {/* Date shortcuts */}
          <button onClick={onLast30}
            className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-medium transition-colors whitespace-nowrap">
            Last 30 days
          </button>
          <button onClick={onAllTime}
            className="px-3 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-medium transition-colors">
            All time
          </button>

          {/* Date pickers */}
          <div className="flex items-center gap-1.5">
            <input type="date" value={dateFrom} onChange={e => onDateFrom(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-gray-100 border border-gray-200 text-gray-700 text-xs outline-none focus:border-orange-400 transition-colors" />
            <span className="text-gray-400 text-xs">to</span>
            <input type="date" value={dateTo} onChange={e => onDateTo(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-gray-100 border border-gray-200 text-gray-700 text-xs outline-none focus:border-orange-400 transition-colors" />
          </div>

          {/* Export CSV */}
          <button onClick={onExportCSV} disabled={exporting || total === 0}
            className="px-3 py-1.5 rounded-xl text-white text-xs font-semibold disabled:opacity-40 hover:opacity-90 transition-all whitespace-nowrap"
            style={{ background: HERMES }}>
            {exporting ? 'Exporting…' : '↓ CSV'}
          </button>
        </div>
      </div>
    </div>
  )
}
