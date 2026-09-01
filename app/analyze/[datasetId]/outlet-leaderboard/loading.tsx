import LottieLoader from '@/components/ui/LottieLoader'

// Route-level loading state. These Advanced Analytics pages render
// force-dynamic from a dataset-wide scan (cached in dataset_state.outlet_scan_cache,
// sql/195) — without this file the old page sits frozen through the server
// render, which is exactly the "frozen tab switch" the 2026-09-01 diagnosis
// measured (PERFORMANCE_REVIEW.md §8).
export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <LottieLoader size={80} message="Crunching the numbers…" />
    </div>
  )
}
