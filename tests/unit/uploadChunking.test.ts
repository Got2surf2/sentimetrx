// The client's chunk size is coupled to a SERVER invariant, so it gets a test
// rather than a comment. The row route writes
//   row_index = batch_index * ROWS_PER_BATCH + offset
// and the rollback DELETE spans exactly [batch*STRIDE, batch*STRIDE + STRIDE).
// A client chunk larger than the stride would overlap the next batch's index
// range — batches would collide, and a rollback would delete another batch's
// rows. Smaller is merely wasteful (it was 50 against a stride of 200, so a
// 125,897-row upload made 2,518 round trips instead of 630).
import { describe, it, expect } from 'vitest'
import { ROWS_PER_BATCH } from '@/lib/constants'
import { CHUNK_SIZE, MAX_BYTES } from '@/app/analyze/new/UploadClient'

describe('upload chunking', () => {
  it('never exceeds the server stride — larger would corrupt rollback', () => {
    expect(CHUNK_SIZE).toBeLessThanOrEqual(ROWS_PER_BATCH)
  })

  it('uses the full stride — anything less just multiplies fixed round trips', () => {
    expect(CHUNK_SIZE).toBe(ROWS_PER_BATCH)
  })

  it('a full chunk of a WIDE dataset stays well under the byte ceiling', () => {
    // ANES 1984–2024 shape: 52 columns of short survey values. This is the case
    // that made the round-trip count hurt, so it's the one worth pinning.
    const row: Record<string, string> = {}
    for (let c = 0; c < 52; c++) row['column_name_' + c] = 'a typical survey answer value'
    const chunk = Array.from({ length: CHUNK_SIZE }, () => row)
    const bytes = Buffer.byteLength(JSON.stringify(chunk))
    expect(bytes).toBeLessThan(MAX_BYTES)
    // Real headroom, not a squeaker — splitChunks halves on overflow, and a chunk
    // that routinely halved would silently undo the round-trip saving.
    expect(bytes).toBeLessThan(MAX_BYTES / 3)
  })
})
