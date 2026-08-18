'use client'

// "Download PDF" for the Outlet Deep-Dive.
//
// It POSTs the payload the page already rendered rather than asking the server
// to recompute it — see lib/outletPdfPayload.ts. It was a bare <a href> until
// 2026-08-18, which meant a real 50s of server work read as a hang; a click
// now has visible states throughout.
//
// The plan comes from OutletPlanContext, so the export can't race the page's own
// generation and pay for a second one.

import { useState } from 'react'
import { useOutletPlan } from './OutletPlanContext'
import type { OutletPdfPayload } from '@/lib/outletPdfPayload'

// Everything except `plan`, which this component supplies from context. Typing
// it against the contract is what keeps the page's assembly and the document
// builder from drifting apart.
export type PdfPayloadProps = Omit<OutletPdfPayload, 'plan'>

export default function DownloadPdfButton({ datasetId, payload }: { datasetId: string; payload: PdfPayloadProps }) {
  const { plan, status } = useOutletPlan()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const waiting = status === 'loading'
  const disabled = waiting || busy

  const label = waiting ? 'Preparing PDF…'
    : busy ? 'Building PDF…'
    : failed ? 'Download PDF — retry'
    : status === 'error' ? 'Download PDF (no action plan)'
    : 'Download PDF'

  const title = waiting ? 'Waiting for the action plan — it’s part of the document.'
    : status === 'error' ? 'The action plan couldn’t be built — retry it below to include it.'
    : undefined

  async function download() {
    setBusy(true); setFailed(false)
    try {
      const res = await fetch(
        `/api/datasets/${datasetId}/outlet-report-pdf?outlet=${encodeURIComponent(payload.outlet)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, plan }) },
      )
      if (!res.ok) throw new Error(String(res.status))
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = `${(payload.selected.name || 'Outlet').replace(/[^a-z0-9]+/gi, '_')}_Report.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => { void download() }}
      disabled={disabled}
      aria-busy={disabled}
      title={title}
      className={`rounded-md px-3 py-1.5 text-sm font-semibold text-white ${disabled ? 'cursor-not-allowed bg-gray-400' : 'bg-gray-800 hover:bg-gray-700'}`}
    >
      {label}
    </button>
  )
}
