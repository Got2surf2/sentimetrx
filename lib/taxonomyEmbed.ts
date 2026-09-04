// lib/taxonomyEmbed.ts
// The embedded-taxonomy shape (sql/151, 2026-07-04): per-row 7-axis verdicts
// live INSIDE dataset_rows_flat.data under the reserved `_tx` key instead of
// the retired sidecar tables, so they're lifecycle-coupled to the row (backup /
// clone / restore / delete for free) and a 1M-comment dataset doesn't mint
// millions of sidecar rows.
//
//   data._tx = { f: { [fieldKey]: TaxonomyFieldBlock } }
//
// fieldKey = taxonomyFieldKey(fields) (lib/dimensionFields.ts). NO version
// history — a re-classify overwrites the field's block in place (owner
// decision 2026-07-03).
//
// `_tx` is a RESERVED key: schema detection (lib/datasetUtils autoDetectSchema),
// the rows API projection, Ana's row-context formatter, the TextMine search
// detail, and the Postgres tsv trigger (sql/151) all skip it. Anything that
// enumerates a row blob's keys as data columns must check isReservedRowKey.

import type { Assertion } from './taxonomyVocabulary'
import { ALL_AXES, type Axis } from './taxonomyVocabulary'

// Bump when the closed vocabulary / dictionary changes so stale rows are
// detectable (mirrors the productization plan's taxonomy_version).
export const TAXONOMY_VERSION = 'v5'  // v5: anger + threat-ascribed emotion flags (ANES-validated constructs); v4: emotion axis (disappointment/blame/churn-intent language flags, lib/emotionFlags.ts); v3: generalized in-food hair phrasings; v2: hair + foreign-object cadre in food-safety dict

/** Top-level data-blob keys that are app metadata, not dataset columns. */
export const RESERVED_ROW_KEYS = ['_tx'] as const

export function isReservedRowKey(key: string): boolean {
  return (RESERVED_ROW_KEYS as readonly string[]).includes(key)
}

/** Strip reserved keys from a row blob before handing it to clients/exports. */
export function stripReservedRowKeys<T extends Record<string, unknown>>(row: T): T {
  if (!('_tx' in row)) return row
  const out = { ...row }
  for (const k of RESERVED_ROW_KEYS) delete out[k]
  return out
}

const ALERT_SEVERITIES = new Set(['alert', 'crisis'])

/** One field's embedded verdict block (data._tx.f[fieldKey]). Compact keys —
 *  this ships on every classified row. */
export interface TaxonomyFieldBlock {
  /** axes → sub-buckets; only non-empty axes are present */
  a: Partial<Record<Axis, string[]>>
  /** subs that fired at alert/crisis severity */
  al: string[]
  /** full structured assertions: {axis, sub, item?, polarity, confidence, severity, evidence} */
  as: Assertion[]
  /** prompt/dictionary version (TAXONOMY_VERSION) */
  v: string
  /** classifier origin, e.g. 'keyword' or 'llm:claude-haiku-4-5' */
  by: string
  /** model used, e.g. 'keyword-tier' */
  m: string
  /** ISO timestamp of the classification */
  at: string
}

/** Build a field block from classifier assertions (the embed-side analog of the
 *  old per-axis text[] column projection). */
export function buildFieldBlock(
  assertions: Assertion[],
  meta: { version: string; by: string; model: string; at?: string },
): TaxonomyFieldBlock {
  const byAxis: Partial<Record<Axis, Set<string>>> = {}
  const alerts = new Set<string>()
  for (const a of assertions) {
    if ((ALL_AXES as readonly string[]).includes(a.axis)) {
      (byAxis[a.axis as Axis] ??= new Set()).add(a.sub)
    }
    if (ALERT_SEVERITIES.has(a.severity)) alerts.add(a.sub)
  }
  const axes: Partial<Record<Axis, string[]>> = {}
  for (const ax of ALL_AXES) {
    const subs = byAxis[ax]
    if (subs && subs.size) axes[ax] = [...subs].sort()
  }
  return {
    a: axes,
    al: [...alerts].sort(),
    as: assertions,
    v: meta.version,
    by: meta.by,
    m: meta.model,
    at: meta.at ?? new Date().toISOString(),
  }
}

/** The axis sub-array of a block, tolerant of missing axes. */
export function blockAxisSubs(block: TaxonomyFieldBlock | null | undefined, axis: Axis): string[] {
  return block?.a?.[axis] ?? []
}
