// Brand color
export const HERMES = '#E8632A'

// Slug validation regex — used in studies routes and check-slug
export const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/

// Each dataset_rows record holds up to 200 data rows.
// Used for row_index calculation: batchIndex * ROWS_PER_BATCH + offset
export const ROWS_PER_BATCH = 200
