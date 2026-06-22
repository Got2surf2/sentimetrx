'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useTransition } from 'react'
import type { OutletOption } from '@/lib/outletReport'
import LottieLoader from '@/components/ui/LottieLoader'

export default function OutletPicker({ outlets, selected }: { outlets: OutletOption[]; selected: string }) {
  const router = useRouter()
  const pathname = usePathname()
  // Switching outlets is a server round-trip (the report recomputes server-side
  // from ?outlet=). Wrap the navigation in a transition so isPending stays true
  // until the new outlet's report has streamed in, and show the loader over it.
  const [isPending, startTransition] = useTransition()
  return (
    <>
      <select
        value={selected}
        disabled={isPending}
        onChange={(e) => {
          const next = e.target.value
          startTransition(() => router.push(`${pathname}?outlet=${encodeURIComponent(next)}`))
        }}
        className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 shadow-sm focus:border-gray-400 focus:outline-none disabled:opacity-60 print:hidden"
      >
        {outlets.map((o) => (
          <option key={o.placeId} value={o.placeId}>
            {o.label} · {o.sublabel} · {o.reviews.toLocaleString()} reviews
          </option>
        ))}
      </select>
      {isPending && (
        <div className="print:hidden" style={{ position: 'fixed', inset: 0, background: 'rgba(255,255,255,.65)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <LottieLoader size={72} message="Loading outlet…" />
        </div>
      )}
    </>
  )
}
