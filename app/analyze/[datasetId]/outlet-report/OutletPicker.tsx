'use client'

import { useRouter, usePathname } from 'next/navigation'
import type { OutletOption } from '@/lib/outletReport'

export default function OutletPicker({ outlets, selected }: { outlets: OutletOption[]; selected: string }) {
  const router = useRouter()
  const pathname = usePathname()
  return (
    <select
      value={selected}
      onChange={(e) => router.push(`${pathname}?outlet=${encodeURIComponent(e.target.value)}`)}
      className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 shadow-sm focus:border-gray-400 focus:outline-none print:hidden"
    >
      {outlets.map((o) => (
        <option key={o.placeId} value={o.placeId}>
          {o.label} · {o.sublabel} · {o.reviews.toLocaleString()} reviews
        </option>
      ))}
    </select>
  )
}
