'use client'

import Link from 'next/link'

interface Props {
  studyId:     string
  studyName:   string
  botEmoji:    string
  activePage:  'responses' | 'analytics'
  dateFrom:    string
  dateTo:      string
  onDateFrom:  (v: string) => void
  onDateTo:    (v: string) => void
  onLast30:    () => void
  onAllTime:   () => void
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
    <div className="bg-white border-b border-gray-200 sticky top-14 z-40 shadow-sm">
      <div className="max-w-5xl mx-auto px-6">

        {/* Top micro-row: back breadcrumb */}
        <div className="pt-2 pb-0">
          <Link href="/dashboard"
            className="text-xs text-gray-400 hover:text-orange-500 transition-colors flex items-center gap-1 w-fit">
            ← Dashboard
          </Link>
        </div>

        {/* Main row: study title left, controls right */}
        <div className="flex items-center justify-between gap-4 py-2 flex-wrap">

          {/* Left: study name — fixed font, never changes */}
          <h1 className="text-base font-bold text-gray-800 truncate max-w-xs leading-tight">
            {botEmoji} {studyName}
          </h1>

          {/* Right: identical controls on both pages */}
          <div className="flex items-center gap-2 flex-wrap">

            {/* Toggle */}
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

            {/* Export CSV — always visible, greyed when nothing to export */}
            <button onClick={onExportCSV} disabled={exporting || total === 0}
              className="px-3 py-1.5 rounded-xl text-white text-xs font-semibold disabled:opacity-40 hover:opacity-90 transition-all whitespace-nowrap"
              style={{ background: HERMES }}>
              {exporting ? 'Exporting…' : '↓ Export CSV'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
