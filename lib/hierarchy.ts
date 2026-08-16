// lib/hierarchy.ts
// Client-defined org hierarchy, DERIVED FROM THE DATA (owner direction
// 2026-07-15, "hierarchy field type").
//
// The model deliberately has no org-structure table to hand-maintain. Instead a
// dataset's schema designates existing columns as hierarchy LEVELS — e.g.
// Region (1) → District (2) → Store (3) — and the tree is generated from those
// columns' values. A client who already carries their structure in the data gets
// the hierarchy for free, and it stays correct as rows are synced: no second
// source of truth to drift.
//
// The whole point is to roll the SAME outlet snapshot up each level
// (Network → Region → District → Outlet) rather than invent per-level metrics.

import type { SchemaFieldConfig } from '@/lib/analyzeTypes'

/** Value used when a row has no value for a level. Rows are NEVER dropped —
 *  a missing District must not make a store vanish from its Region's totals,
 *  or the roll-up stops reconciling with the flat numbers. */
export const UNASSIGNED = '(unassigned)'

export interface HierarchyLevel {
  field: string
  label: string
  level: number
}

export interface HierarchyNode {
  /** Level index, 1-based; 1 is the broadest designated level. 0 = the root. */
  level: number
  /** This node's own value, e.g. "East" or "Store 42". */
  key: string
  /** Full path from the root, e.g. ["East", "Downtown", "Store 42"]. */
  path: string[]
  /** Stable id for URLs/keys — the path, delimited by U+001E (record separator),
   *  which cannot occur in a real cell value. Written as an ESCAPE, never a raw byte:
   *  a literal control character makes the file binary to grep
   *  (docs/ENGINEERING.md). */
  id: string
  /** Rows at or below this node. */
  rowCount: number
  children: HierarchyNode[]
}

const SEP = '\u001E'

/** Plural of a level label, for headings and rank copy ("City" → "Cities").
 *  Deliberately dumb: the label is the CLIENT'S own column name, and a clever
 *  rule guessing wrong on their vocabulary reads worse than a plain "s". */
export function pluralLevel(label: string): string {
  if (/(s|x|z|ch|sh)$/i.test(label)) return label + 'es'
  if (/[^aeiouAEIOU]y$/.test(label)) return label.slice(0, -1) + 'ies'
  return label + 's'
}

/** The designated levels, in order. Absent `hierarchyLevel` = not part of it. */
export function hierarchyLevels(fields: SchemaFieldConfig[] | undefined): HierarchyLevel[] {
  return (fields || [])
    .filter(f => typeof f.hierarchyLevel === 'number' && f.hierarchyLevel! > 0 && f.type !== 'ignore')
    .sort((a, b) => a.hierarchyLevel! - b.hierarchyLevel!)
    .map(f => ({ field: f.field, label: f.label || f.field, level: f.hierarchyLevel! }))
}

/** True when a dataset has a usable hierarchy (at least two levels — one level
 *  is just a categorical breakdown, not a tree). */
export function hasHierarchy(fields: SchemaFieldConfig[] | undefined): boolean {
  return hierarchyLevels(fields).length >= 2
}

function cellValue(row: Record<string, unknown>, field: string): string {
  const v = row?.[field]
  const s = v == null ? '' : String(v).trim()
  return s === '' ? UNASSIGNED : s
}

/** The path a single row belongs to, one entry per designated level. */
export function pathOf(row: Record<string, unknown>, levels: HierarchyLevel[]): string[] {
  return levels.map(l => cellValue(row, l.field))
}

/**
 * Build the tree from the rows' own values.
 *
 * ⭐ Nodes are keyed by their FULL PATH, not by their value. "Downtown" under
 * "East" and "Downtown" under "West" are two different districts, and a
 * name-keyed tree would silently merge them — collapsing two real districts
 * into one and making every number downstream wrong.
 */
export function buildHierarchy(
  rows: Record<string, unknown>[],
  levels: HierarchyLevel[],
): HierarchyNode {
  const root: HierarchyNode = { level: 0, key: '', path: [], id: '', rowCount: 0, children: [] }
  if (!levels.length) { root.rowCount = rows.length; return root }

  // path-string -> node, so lookups stay O(1) while building.
  const index = new Map<string, HierarchyNode>()
  index.set('', root)

  for (const row of rows) {
    const path = pathOf(row, levels)
    root.rowCount++
    let parent = root
    for (let i = 0; i < path.length; i++) {
      const id = path.slice(0, i + 1).join(SEP)
      let node = index.get(id)
      if (!node) {
        node = { level: i + 1, key: path[i], path: path.slice(0, i + 1), id, rowCount: 0, children: [] }
        index.set(id, node)
        parent.children.push(node)
      }
      node.rowCount++
      parent = node
    }
  }

  // Deterministic order: biggest first, then alphabetical, with (unassigned)
  // pinned last so it never leads a list.
  const sortRec = (n: HierarchyNode) => {
    n.children.sort((a, b) => {
      if ((a.key === UNASSIGNED) !== (b.key === UNASSIGNED)) return a.key === UNASSIGNED ? 1 : -1
      return b.rowCount - a.rowCount || a.key.localeCompare(b.key)
    })
    n.children.forEach(sortRec)
  }
  sortRec(root)
  return root
}

/** Look up a node by path. Returns the root for an empty path, null if absent. */
export function findNode(root: HierarchyNode, path: string[]): HierarchyNode | null {
  let node: HierarchyNode = root
  for (const key of path) {
    const next = node.children.find(c => c.key === key)
    if (!next) return null
    node = next
  }
  return node
}

export type Crumb = { label: string; levelLabel: string; path: string[] }

/** Breadcrumb trail for a path, WITHOUT needing the tree. For callers that
 *  already know the path is valid (e.g. it came from a link we rendered) and
 *  shouldn't pay for a full scan just to draw a trail. */
export function crumbsForPath(path: string[], levels: HierarchyLevel[]): Crumb[] {
  return [
    { label: 'Network', levelLabel: 'All', path: [] },
    ...path.map((key, i) => ({
      label: key,
      levelLabel: levels[i]?.label || ('Level ' + (i + 1)),
      path: path.slice(0, i + 1),
    })),
  ]
}

/** Breadcrumb trail from the root down to `path`, each entry linkable. Stops at
 *  the first key that isn't in the tree, so a stale link degrades to the trail
 *  that does exist rather than inventing nodes. */
export function breadcrumb(
  root: HierarchyNode, path: string[], levels: HierarchyLevel[],
): Crumb[] {
  let node: HierarchyNode = root
  const valid: string[] = []
  for (const key of path) {
    const next = node.children.find(c => c.key === key)
    if (!next) break
    node = next
    valid.push(key)
  }
  return crumbsForPath(valid, levels)
}

/** The rows under a node — what a rolled-up snapshot is computed over. */
export function rowsUnder(
  rows: Record<string, unknown>[], levels: HierarchyLevel[], path: string[],
): Record<string, unknown>[] {
  if (!path.length) return rows
  return rows.filter(r => {
    const p = pathOf(r, levels)
    for (let i = 0; i < path.length; i++) if (p[i] !== path[i]) return false
    return true
  })
}

/** Flatten to the nodes at one depth — the "children of here" list a level view
 *  shows (Network lists Regions, a Region lists its Districts, …). */
export function nodesAtDepth(root: HierarchyNode, depth: number): HierarchyNode[] {
  if (depth <= 0) return [root]
  let frontier = [root]
  for (let d = 0; d < depth; d++) frontier = frontier.flatMap(n => n.children)
  return frontier
}
