// Shared best→worst 5-stop rating gradient (green → red). Used by the Charts
// ordinal/Likert bars (ChartsModule `ORD_GRAD`) and the Outlet snapshot's rating
// distribution, so a rating value reads the same colour everywhere.
export const RATING_GRADIENT = ['#059669', '#34D399', '#94A3B8', '#F97316', '#DC2626'] // best → worst

// Colour for a discrete 1–5★ bucket (5★ = green … 1★ = red).
export function starBarColor(star: number): string {
  return RATING_GRADIENT[Math.min(4, Math.max(0, 5 - Math.round(star)))]
}
