import { describe, it, expect } from 'vitest'
import type { SchemaFieldConfig } from '@/lib/analyzeTypes'
import {
  hierarchyLevels, hasHierarchy, buildHierarchy, pathOf, findNode,
  breadcrumb, rowsUnder, nodesAtDepth, UNASSIGNED,
} from '@/lib/hierarchy'

const FIELDS: SchemaFieldConfig[] = [
  { field: 'region',   type: 'categorical', label: 'Region',   hierarchyLevel: 1 },
  { field: 'district', type: 'categorical', label: 'District', hierarchyLevel: 2 },
  { field: 'store',    type: 'categorical', label: 'Store',    hierarchyLevel: 3 },
  { field: 'rating',   type: 'numeric',     label: 'Rating' },
  { field: 'old_zone', type: 'ignore',      label: 'Zone',     hierarchyLevel: 1 },
]
const LEVELS = hierarchyLevels(FIELDS)

const row = (region: string, district: string, store: string) => ({ region, district, store, rating: 5 })

describe('hierarchyLevels', () => {
  it('orders by level and ignores unmarked fields', () => {
    expect(LEVELS.map(l => l.field)).toEqual(['region', 'district', 'store'])
  })

  it('respects the declared order, not the schema order', () => {
    const shuffled: SchemaFieldConfig[] = [
      { field: 'store', type: 'categorical', hierarchyLevel: 3 },
      { field: 'region', type: 'categorical', hierarchyLevel: 1 },
      { field: 'district', type: 'categorical', hierarchyLevel: 2 },
    ]
    expect(hierarchyLevels(shuffled).map(l => l.field)).toEqual(['region', 'district', 'store'])
  })

  it('drops an ignored field even when it carries a level', () => {
    expect(LEVELS.some(l => l.field === 'old_zone')).toBe(false)
  })

  it('needs two levels to be a hierarchy — one is just a breakdown', () => {
    expect(hasHierarchy(FIELDS)).toBe(true)
    expect(hasHierarchy([{ field: 'region', type: 'categorical', hierarchyLevel: 1 }])).toBe(false)
    expect(hasHierarchy([])).toBe(false)
    expect(hasHierarchy(undefined)).toBe(false)
  })
})

describe('buildHierarchy', () => {
  it('nests values into a tree and counts rows at every level', () => {
    const rows = [
      row('East', 'Downtown', 'S1'), row('East', 'Downtown', 'S1'),
      row('East', 'Downtown', 'S2'), row('East', 'Uptown', 'S3'),
      row('West', 'Harbor', 'S4'),
    ]
    const root = buildHierarchy(rows, LEVELS)
    expect(root.rowCount).toBe(5)
    expect(root.children.map(c => c.key)).toEqual(['East', 'West'])   // biggest first
    const east = findNode(root, ['East'])!
    expect(east.rowCount).toBe(4)
    expect(east.children.map(c => c.key)).toEqual(['Downtown', 'Uptown'])
    expect(findNode(root, ['East', 'Downtown', 'S1'])!.rowCount).toBe(2)
  })

  // The correctness property the whole model rests on.
  it('does NOT merge same-named nodes under different parents', () => {
    const rows = [
      row('East', 'Downtown', 'S1'),
      row('West', 'Downtown', 'S2'),
      row('West', 'Downtown', 'S3'),
    ]
    const root = buildHierarchy(rows, LEVELS)
    const eastDowntown = findNode(root, ['East', 'Downtown'])!
    const westDowntown = findNode(root, ['West', 'Downtown'])!
    expect(eastDowntown.rowCount).toBe(1)
    expect(westDowntown.rowCount).toBe(2)
    expect(eastDowntown.id).not.toBe(westDowntown.id)
    // A name-keyed tree would have produced ONE "Downtown" with 3 rows.
    expect(eastDowntown.rowCount + westDowntown.rowCount).toBe(3)
  })

  // Roll-ups have to reconcile with the flat numbers or the whole view is
  // untrustworthy (deck-number credibility).
  it('never drops a row: leaf counts sum to the total, even with blanks', () => {
    const rows = [
      row('East', 'Downtown', 'S1'),
      { region: 'East', district: '', store: 'S9', rating: 4 },   // no district
      { region: '', district: '', store: '', rating: 3 },          // nothing at all
      { region: 'West', district: 'Harbor', rating: 2 },           // store key absent
    ]
    const root = buildHierarchy(rows, LEVELS)
    expect(root.rowCount).toBe(4)
    const leaves = nodesAtDepth(root, 3)
    expect(leaves.reduce((s, n) => s + n.rowCount, 0)).toBe(4)
    expect(findNode(root, ['East', UNASSIGNED, 'S9'])!.rowCount).toBe(1)
    expect(findNode(root, [UNASSIGNED, UNASSIGNED, UNASSIGNED])!.rowCount).toBe(1)
    expect(findNode(root, ['West', 'Harbor', UNASSIGNED])!.rowCount).toBe(1)
  })

  it('sorts children biggest-first but pins (unassigned) last', () => {
    const rows = [
      { region: '', district: 'd', store: 's' }, { region: '', district: 'd', store: 's' },
      { region: '', district: 'd', store: 's' }, row('East', 'Downtown', 'S1'),
    ]
    const root = buildHierarchy(rows, LEVELS)
    // (unassigned) has 3 rows vs East's 1, and still sorts last.
    expect(root.children.map(c => c.key)).toEqual(['East', UNASSIGNED])
  })

  it('whitespace-only values are treated as missing, not as a distinct node', () => {
    const root = buildHierarchy([{ region: '   ', district: 'd', store: 's' }], LEVELS)
    expect(root.children[0].key).toBe(UNASSIGNED)
  })

  it('coerces non-string cells rather than dropping them', () => {
    const root = buildHierarchy([{ region: 2026, district: true, store: 'S1' }], LEVELS)
    expect(findNode(root, ['2026', 'true', 'S1'])!.rowCount).toBe(1)
  })

  it('with no levels declared, everything is the root', () => {
    const root = buildHierarchy([row('E', 'D', 'S')], [])
    expect(root.rowCount).toBe(1)
    expect(root.children).toEqual([])
  })
})

describe('navigation helpers', () => {
  const rows = [
    row('East', 'Downtown', 'S1'), row('East', 'Uptown', 'S2'), row('West', 'Harbor', 'S3'),
  ]
  const root = buildHierarchy(rows, LEVELS)

  it('pathOf places a row on its full path', () => {
    expect(pathOf(rows[0], LEVELS)).toEqual(['East', 'Downtown', 'S1'])
  })

  it('findNode returns the root for an empty path and null for a bad one', () => {
    expect(findNode(root, [])).toBe(root)
    expect(findNode(root, ['Nowhere'])).toBeNull()
    expect(findNode(root, ['East', 'Nowhere'])).toBeNull()
  })

  it('breadcrumb labels each rung with its own level name', () => {
    expect(breadcrumb(root, ['East', 'Downtown'], LEVELS)).toEqual([
      { label: 'Network', levelLabel: 'All', path: [] },
      { label: 'East', levelLabel: 'Region', path: ['East'] },
      { label: 'Downtown', levelLabel: 'District', path: ['East', 'Downtown'] },
    ])
  })

  it('breadcrumb stops at the last real node instead of inventing rungs', () => {
    expect(breadcrumb(root, ['East', 'Nowhere', 'S9'], LEVELS).map(b => b.label)).toEqual(['Network', 'East'])
  })

  it('rowsUnder scopes to a node — this is what a rolled-up snapshot reads', () => {
    expect(rowsUnder(rows, LEVELS, []).length).toBe(3)
    expect(rowsUnder(rows, LEVELS, ['East']).length).toBe(2)
    expect(rowsUnder(rows, LEVELS, ['East', 'Downtown']).length).toBe(1)
    expect(rowsUnder(rows, LEVELS, ['East', 'Harbor']).length).toBe(0)
  })

  it('nodesAtDepth lists the rungs a level view shows', () => {
    expect(nodesAtDepth(root, 1).map(n => n.key)).toEqual(['East', 'West'])
    expect(nodesAtDepth(root, 2).map(n => n.key).sort()).toEqual(['Downtown', 'Harbor', 'Uptown'])
    expect(nodesAtDepth(root, 0)).toEqual([root])
  })
})
