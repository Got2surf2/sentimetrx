'use client'

import { useState } from 'react'

// Client control for the "Export operational review" download. The deck triggers
// a one-time live competitor pull and renders cover-page metadata, so generation
// is driven from a modal that collects cover info (title/subtitle/prepared-for/
// prepared-by) plus the competitor and franchise-state slices. On Generate it
// navigates the browser to the operational-review-deck route (omitting empty
// fields so blanks fall back to builder defaults), which streams the merged
// Operational Review PPTX.
export default function OperationalReviewExport({ datasetId, brand }: { datasetId: string; brand: string }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(`${brand} — Operational Review`)
  const [subtitle, setSubtitle] = useState('')
  const [preparedFor, setPreparedFor] = useState('')
  const [preparedBy, setPreparedBy] = useState('Datanautix')
  const [competitors, setCompetitors] = useState('')
  const [franchiseStates, setFranchiseStates] = useState('')

  function onGenerate() {
    const params = new URLSearchParams()
    const add = (key: string, val: string) => {
      const v = val.trim()
      if (v) params.set(key, v)
    }
    add('title', title)
    add('subtitle', subtitle)
    add('preparedFor', preparedFor)
    add('preparedBy', preparedBy)
    add('competitors', competitors)
    add('franchiseStates', franchiseStates)
    const qs = params.toString()
    window.location.href = `/api/datasets/${datasetId}/operational-review-deck${qs ? `?${qs}` : ''}`
    setOpen(false)
  }

  const inputCls = 'mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-gray-900 placeholder:text-gray-400'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gray-700"
      >
        Export operational review
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl ring-1 ring-gray-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <h2 className="text-base font-bold text-gray-900">Export operational review</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="-mr-1 -mt-1 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Cover-page details for the generated deck. Leave a field blank to use its default.
            </p>

            <div className="mt-4 space-y-3">
              <label className="block text-xs font-semibold text-gray-700">
                Presentation title
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  style={{ fontSize: '16px' }}
                  className={inputCls}
                />
              </label>

              <label className="block text-xs font-semibold text-gray-700">
                Subtitle <span className="font-normal text-gray-400">(optional)</span>
                <input
                  type="text"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="(auto: review/location counts)"
                  style={{ fontSize: '16px' }}
                  className={inputCls}
                />
              </label>

              <label className="block text-xs font-semibold text-gray-700">
                Prepared for <span className="font-normal text-gray-400">(optional)</span>
                <input
                  type="text"
                  value={preparedFor}
                  onChange={(e) => setPreparedFor(e.target.value)}
                  placeholder="Acme Capital Partners"
                  style={{ fontSize: '16px' }}
                  className={inputCls}
                />
              </label>

              <label className="block text-xs font-semibold text-gray-700">
                Prepared by
                <input
                  type="text"
                  value={preparedBy}
                  onChange={(e) => setPreparedBy(e.target.value)}
                  style={{ fontSize: '16px' }}
                  className={inputCls}
                />
              </label>

              <label className="block text-xs font-semibold text-gray-700">
                Competitors <span className="font-normal text-gray-400">(optional, comma-separated)</span>
                <input
                  type="text"
                  value={competitors}
                  onChange={(e) => setCompetitors(e.target.value)}
                  placeholder="Wahoo's Fish Taco, Rubio's"
                  style={{ fontSize: '16px' }}
                  className={inputCls}
                />
              </label>

              <label className="block text-xs font-semibold text-gray-700">
                Franchise states <span className="font-normal text-gray-400">(optional, comma-separated)</span>
                <input
                  type="text"
                  value={franchiseStates}
                  onChange={(e) => setFranchiseStates(e.target.value)}
                  placeholder="Nevada"
                  style={{ fontSize: '16px' }}
                  className={inputCls}
                />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onGenerate}
                className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-gray-700"
              >
                Generate
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
