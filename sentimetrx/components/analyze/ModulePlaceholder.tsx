'use client'

// components/analyze/ModulePlaceholder.tsx
// Shown for Charts and Stats in Phase 1 -- confirms data is loaded, signals what is coming

import Link from 'next/link'

interface Props {
  module:      string
  message:     string
  rowCount:    number
  fieldCount:  number
  datasetId:   string
}

const HERMES = '#E8632A'

export default function ModulePlaceholder({ module: moduleName, message, rowCount, fieldCount, datasetId }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-24 px-6 text-center">

      {/* Ana wordmark */}
      <div className="mb-6 flex items-center gap-2">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shadow-md"
          style={{ background: 'linear-gradient(135deg,' + HERMES + ',#c04e1a)' }}
        >
          <span className="text-white font-black text-lg leading-none">A</span>
        </div>
        <span className="text-2xl font-black tracking-tight" style={{ color: HERMES }}>Ana</span>
        <span className="text-xs font-semibold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full ml-1">by Datanautix</span>
      </div>

      {/* Module name */}
      <h2 className="text-2xl font-bold text-gray-800 mb-2">{moduleName}</h2>

      {/* Message */}
      <p className="text-gray-500 text-sm max-w-sm mb-8 leading-relaxed">{message}</p>

      {/* Data readiness summary */}
      <div className="flex items-center gap-4 mb-8">
        <div className="flex flex-col items-center bg-green-50 border border-green-200 rounded-xl px-5 py-3">
          <span className="text-2xl font-black text-green-700">{rowCount.toLocaleString()}</span>
          <span className="text-xs text-green-600 font-medium mt-0.5">rows loaded</span>
        </div>
        <div className="flex flex-col items-center bg-blue-50 border border-blue-200 rounded-xl px-5 py-3">
          <span className="text-2xl font-black text-blue-700">{fieldCount}</span>
          <span className="text-xs text-blue-600 font-medium mt-0.5">fields configured</span>
        </div>
      </div>

      {/* Data ready badge */}
      <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-full px-4 py-2 mb-6">
        <span className="text-green-500 text-sm">+</span>
        <span className="text-green-700 text-sm font-semibold">Data pipeline ready</span>
      </div>

      <p className="text-xs text-gray-400 mb-6">
        Your data is loaded and waiting. This module will drop in without any re-upload.
      </p>

      <Link
        href={'/analyze/' + datasetId + '/settings'}
        className="text-sm font-semibold underline"
        style={{ color: HERMES }}
      >
        Configure schema in Settings
      </Link>
    </div>
  )
}
