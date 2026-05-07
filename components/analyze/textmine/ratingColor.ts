// components/analyze/textmine/ratingColor.ts
// Map a row's rating value to a comment-card background/border tint.
// Auto-detects the scale (1-5 stars, 0-10 NPS, or any numeric range) from
// the dataset's min/max, then bands the value into 5 color stops.

export interface RatingPalette {
  bg: string
  border: string
  /** small label text e.g. "★ 5" */
  label?: string
}

const NEUTRAL: RatingPalette = { bg: '#f9fafb', border: '#e5e7eb' }

/**
 * Compute min/max of the rating field across rows. Used to normalize the
 * value into a 0..1 band for coloring. Returns null if no numeric values
 * are found.
 */
export function ratingRange(rows: Record<string, unknown>[], ratingField: string | null | undefined): { min: number; max: number } | null {
  if (!ratingField) return null
  let min = Infinity, max = -Infinity, found = false
  for (const r of rows) {
    const v = parseFloat(String(r[ratingField] ?? ''))
    if (!isNaN(v)) {
      if (v < min) min = v
      if (v > max) max = v
      found = true
    }
  }
  return found ? { min, max } : null
}

/**
 * Convert a rating value into a color tint, banded into 5 levels:
 *   bottom 20%      → red
 *   20-40%          → light red
 *   40-60%          → yellow
 *   60-80%          → light green
 *   top 20%         → green
 *
 * Returns NEUTRAL if value is not numeric or range is degenerate (min===max).
 */
export function ratingPalette(value: unknown, range: { min: number; max: number } | null): RatingPalette {
  if (!range) return NEUTRAL
  const v = parseFloat(String(value ?? ''))
  if (isNaN(v)) return NEUTRAL
  if (range.max === range.min) return NEUTRAL
  const norm = (v - range.min) / (range.max - range.min)
  if (norm >= 0.8)  return { bg: '#ecfdf5', border: '#a7f3d0' } // green
  if (norm >= 0.6)  return { bg: '#f0fdf4', border: '#bbf7d0' } // light green
  if (norm >= 0.4)  return { bg: '#fefce8', border: '#fde68a' } // yellow
  if (norm >= 0.2)  return { bg: '#fef2f2', border: '#fecaca' } // light red
  return { bg: '#fef2f2', border: '#fca5a5' }                    // red
}
