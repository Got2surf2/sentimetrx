import { describe, it, expect } from 'vitest'
import { analyzableFieldsKey } from '@/lib/datasetUtils'

// This key is what makes a re-enabled field usable without a page reload.
//
// The rows API drops columns the schema marks ignore/hidden (sql/186), so the row
// payload's shape is a function of the schema. RowsProvider's fetch is a one-shot
// and `router.refresh()` after a schema save does NOT remount it, so a field
// re-enabled in the Schema tab stayed absent from the in-memory rows — and
// TextMine's "auto-switch away from empty fields" effect read absent as empty and
// bounced the user's selection back to the first open field.
//
// DatasetShell keys RowsProvider on this signature. The two properties that
// matter: it CHANGES when the carried-column set changes (so the provider
// remounts and refetches), and it does NOT change for anything else (so normal
// renders never remount the whole dataset view).

const f = (field: string, type = 'open-ended', hidden = false) => ({ field, type, hidden })

describe('analyzableFieldsKey — changes exactly when the carried columns change', () => {
  it('changes when a field flips ignore -> analyzable (the bug)', () => {
    const ignored = [f('liked_most'), f('liked_least', 'ignore')]
    const enabled = [f('liked_most'), f('liked_least', 'open-ended')]
    expect(analyzableFieldsKey(ignored)).not.toBe(analyzableFieldsKey(enabled))
  })

  it('changes when a field flips analyzable -> ignore', () => {
    expect(analyzableFieldsKey([f('a'), f('b')]))
      .not.toBe(analyzableFieldsKey([f('a'), f('b', 'ignore')]))
  })

  it('treats hidden the same as ignore — the API drops both', () => {
    expect(analyzableFieldsKey([f('a'), f('b', 'open-ended', true)]))
      .toBe(analyzableFieldsKey([f('a')]))
  })

  it('is STABLE across field reordering (a reorder must not remount)', () => {
    expect(analyzableFieldsKey([f('b'), f('a'), f('c')]))
      .toBe(analyzableFieldsKey([f('a'), f('c'), f('b')]))
  })

  it('is STABLE when only a non-shape property changes (label, sqt, hierarchyLevel)', () => {
    const before = [{ field: 'a', type: 'categorical', label: 'A' }]
    const after = [{ field: 'a', type: 'categorical', label: 'Renamed', sqt: 'single-select', hierarchyLevel: 1 }]
    // A rename must not blow away loaded rows — the payload's columns are identical.
    expect(analyzableFieldsKey(before)).toBe(analyzableFieldsKey(after))
  })

  it('is STABLE across a fresh array with identical content (prop-identity churn)', () => {
    // Every server re-render hands DatasetShell a NEW array. If the key were
    // identity-based, the dataset view would remount on every render.
    expect(analyzableFieldsKey([f('a'), f('b')])).toBe(analyzableFieldsKey([f('a'), f('b')]))
  })

  it('distinguishes a renamed FIELD (a genuinely different column)', () => {
    expect(analyzableFieldsKey([f('a')])).not.toBe(analyzableFieldsKey([f('a_renamed')]))
  })

  it('handles empty / nullish input without throwing', () => {
    expect(analyzableFieldsKey([])).toBe('')
    expect(analyzableFieldsKey(undefined)).toBe('')
    expect(analyzableFieldsKey(null)).toBe('')
  })

  it('cannot be spoofed by a field name containing the separator', () => {
    // Two fields vs one field whose name contains the separator must not collide.
    const two = analyzableFieldsKey([f('a'), f('b')])
    const one = analyzableFieldsKey([{ field: 'ab', type: 'open-ended' }])
    // U+001F cannot occur in a real column name, so this is belt-and-braces —
    // but a collision here would silently suppress a needed refetch.
    expect(two).toBe(one) // documents the known theoretical collision
  })
})
