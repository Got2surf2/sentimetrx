// lib/anaReportContext.ts
//
// Shared Ana data layer: resolve a dataset (or collection), pull a sampled +
// filtered set of rows, and format them for an LLM context. Extracted verbatim
// from app/api/ask-ana so the streaming Q&A route AND the one-shot ad-hoc report
// route load data identically (single source of truth — no drift on sampling,
// filtering, reddit signal selection, or collection budgeting).

import type { createServiceRoleClient } from '@/lib/supabase/server'
import { DEFAULT_SIGNAL_CUTOFFS } from '@/lib/signalTier'
import { formatRowsForContext } from '@/lib/anaContext'
import { logError } from '@/lib/log'
import type { SerializedFilters } from '@/lib/filterUtils'

type Service = ReturnType<typeof createServiceRoleClient>

export const ANA_CONTEXT_CAP = 500   // absolute max rows sent to the model
export const ANA_DEFAULT_SAMPLE = 200
const FETCH_CAP    = 2000
const MEMBER_FLOOR = 20
const URL_ONLY_RE  = /^(\s*(https?:\/\/\S+)\s*)+$/i

export interface CollectionMember { dataset_id: string; name: string; row_count: number }

export interface AnaSample {
  rows:             Record<string, unknown>[]   // final filtered + sampled rows
  dataContext:      string                       // formatted for the system prompt
  collectionMembers: CollectionMember[]
  totalDatasetRows: number
  totalFiltered:    number
  afterSignalCount: number
  sampled:          boolean
  signalNote:       string
}

// ── Per-member budget computation for collections ─────────────────────────
export function computeMemberBudgets(
  members: CollectionMember[],
  totalBudget: number,
  strategy: 'proportional' | 'equal' | 'floor',
): { dataset_id: string; budget: number }[] {
  const totalRows = members.reduce(function(s, m) { return s + m.row_count }, 0)
  if (totalRows === 0) return members.map(function(m) { return { dataset_id: m.dataset_id, budget: 0 } })

  if (strategy === 'equal') {
    const perMember = Math.floor(totalBudget / members.length)
    return members.map(function(m) { return { dataset_id: m.dataset_id, budget: Math.min(perMember, m.row_count) } })
  }

  if (strategy === 'floor') {
    let remaining = totalBudget
    const floors = members.map(function(m) {
      const f = Math.min(MEMBER_FLOOR, m.row_count)
      remaining -= f
      return f
    })
    if (remaining < 0) remaining = 0
    const nonFloorTotal = members.reduce(function(s, m) { return s + Math.max(0, m.row_count - MEMBER_FLOOR) }, 0)
    return members.map(function(m, i) {
      const extra = nonFloorTotal > 0 ? Math.round(Math.max(0, m.row_count - MEMBER_FLOOR) / nonFloorTotal * remaining) : 0
      return { dataset_id: m.dataset_id, budget: Math.min(floors[i] + extra, m.row_count) }
    })
  }

  // Default: proportional
  return members.map(function(m) {
    return { dataset_id: m.dataset_id, budget: Math.min(Math.max(1, Math.round(m.row_count / totalRows * totalBudget)), m.row_count) }
  })
}

// ── Fetch rows from a single dataset, using RPC sampling for large ones ───
export async function fetchDatasetRows(
  service: Service,
  datasetId: string,
  budget: number,
  totalRows: number,
): Promise<Record<string, unknown>[]> {
  if (totalRows <= budget) {
    const rows: Record<string, unknown>[] = []
    const PAGE = 1000
    let offset = 0
    let fetchMore = true
    while (fetchMore) {
      const { data: flatRows, error } = await service
        .from('dataset_rows_flat')
        .select('data')
        .eq('dataset_id', datasetId)
        .order('row_index', { ascending: true })
        .range(offset, offset + PAGE - 1)
      if (error || !flatRows || flatRows.length === 0) break
      for (let i = 0; i < flatRows.length; i++) rows.push((flatRows[i] as { data: Record<string, unknown> }).data)
      if (flatRows.length < PAGE) fetchMore = false
      offset += PAGE
    }
    return rows
  }
  const { data: sampled, error } = await service.rpc('sample_row_pairs', { p_dataset_id: datasetId, p_fields: [], p_limit: budget })
  if (error || !sampled) return []
  return (sampled as { data: Record<string, unknown> }[]).map(function(r) { return r.data })
}

// ── Resolve a collection's members (empty for a single dataset) ───────────
export async function resolveCollectionMembers(service: Service, dataset: { id: string; source: string }): Promise<CollectionMember[]> {
  if (dataset.source !== 'collection') return []
  const { data: col, error: colErr } = await service.from('collections').select('id').eq('dataset_id', dataset.id).single()
  if (colErr) void logError('anaReportContext.resolveCollectionMembers', colErr)
  if (!col) return []
  const { data: mems, error: memsErr } = await service.from('collection_members').select('dataset_id, label, sort_order').eq('collection_id', (col as { id: string }).id).order('sort_order', { ascending: true })
  if (memsErr) void logError('anaReportContext.resolveCollectionMembers', memsErr)
  if (!mems || mems.length === 0) return []
  const memIds = mems.map(function(m) { return (m as { dataset_id: string }).dataset_id })
  const { data: memDs, error: memDsErr } = await service.from('datasets').select('id, name, row_count').in('id', memIds)
  if (memDsErr) void logError('anaReportContext.resolveCollectionMembers', memDsErr)
  const dsMap: Record<string, { name: string; row_count: number }> = {}
  if (memDs) (memDs as { id: string; name: string; row_count: number }[]).forEach(function(d) { dsMap[d.id] = { name: d.name, row_count: d.row_count || 0 } })
  return (mems as { dataset_id: string; label: string | null }[]).map(function(m) {
    const info = dsMap[m.dataset_id] || { name: m.label || 'Unknown', row_count: 0 }
    return { dataset_id: m.dataset_id, name: m.label || info.name, row_count: info.row_count }
  })
}

/**
 * Load a sampled + filtered + formatted row set for a dataset/collection — the
 * exact pipeline ask-ana uses, so both routes see the same data.
 */
export async function loadAnaSample(opts: {
  service: Service
  dataset: { id: string; name: string; source: string; row_count: number | null }
  sampleSize?: number
  samplingStrategy?: 'proportional' | 'equal' | 'floor'
  filters?: SerializedFilters
  collectionMembers?: CollectionMember[]   // pass if already resolved (avoids a re-query)
}): Promise<AnaSample> {
  const { service, dataset, filters } = opts
  const sampleSize = Math.max(50, Math.min(opts.sampleSize || ANA_DEFAULT_SAMPLE, ANA_CONTEXT_CAP))
  const samplingStrategy = opts.samplingStrategy || 'proportional'
  const collectionMembers = opts.collectionMembers ?? await resolveCollectionMembers(service, dataset)

  const allRows: Record<string, unknown>[] = []
  const fetchBudget = Math.min(sampleSize * 3, FETCH_CAP)
  const totalDatasetRows = dataset.source === 'collection'
    ? collectionMembers.reduce(function(s, m) { return s + m.row_count }, 0)
    : (dataset.row_count || 0)

  if (dataset.source === 'collection' && collectionMembers.length > 0) {
    const budgets = computeMemberBudgets(collectionMembers, fetchBudget, samplingStrategy)
    for (const b of budgets) {
      if (b.budget <= 0) continue
      const memberInfo = collectionMembers.find(function(m) { return m.dataset_id === b.dataset_id })
      const fetched = await fetchDatasetRows(service, b.dataset_id, b.budget, memberInfo ? memberInfo.row_count : 0)
      for (let i = 0; i < fetched.length; i++) allRows.push(fetched[i])
    }
  } else {
    const fetched = await fetchDatasetRows(service, dataset.id, fetchBudget, dataset.row_count || 0)
    for (let i = 0; i < fetched.length; i++) allRows.push(fetched[i])
  }

  // Apply filters
  let filteredRows = allRows
  if (filters && Object.keys(filters).length > 0) {
    filteredRows = allRows.filter(function(row) {
      for (const field of Object.keys(filters)) {
        const f = filters[field]
        const val = row[field]
        if (f.type === 'cat') {
          const allowed = new Set(f.values || [])
          if (val == null && f.excludeBlanks) return false
          if (val != null && !allowed.has(String(val))) return false
        } else if (f.type === 'range') {
          const num = Number(val)
          if (isNaN(num)) { if (!f.includeBlanks) return false }
          else if (num < f.values[0] || num > f.values[1]) return false
        }
      }
      return true
    })
  }

  // Drop URL-only rows for text sources
  if (dataset.source === 'reddit' || dataset.source === 'substack' || dataset.source === 'google_reviews') {
    filteredRows = filteredRows.filter(function(r) {
      const text = String(r.body || r.user_message || r.review_text || '').trim()
      return text && !URL_ONLY_RE.test(text)
    })
  }

  const totalFiltered = filteredRows.length
  let signalNote = ''

  // Reddit: vote-weighted signal selection
  if (dataset.source === 'reddit' && filteredRows.length > 0) {
    const NOISE_CUTOFF = DEFAULT_SIGNAL_CUTOFFS.noise
    const threads: Record<string, { score: number; row: Record<string, unknown> }[]> = {}
    filteredRows.forEach(function(r) {
      const tid = String(r.thread_id || 'unknown')
      if (!threads[tid]) threads[tid] = []
      threads[tid].push({ score: Number(r.score) || 0, row: r })
    })
    const signalRows: Record<string, unknown>[] = []
    Object.values(threads).forEach(function(entries) {
      const sorted = [...entries].sort(function(a, b) { return b.score - a.score })
      const count = sorted.length
      sorted.forEach(function(entry, rank) {
        const percentile = count > 1 ? Math.round((1 - rank / (count - 1)) * 100) : 50
        if (percentile >= NOISE_CUTOFF && entry.score >= 0) signalRows.push(entry.row)
      })
    })
    if (signalRows.length >= 10) {
      filteredRows = signalRows
      signalNote = '\n\nNote: Only mainstream and controversial comments are included (top ' + (100 - NOISE_CUTOFF) + '% by score within each thread). ' + (totalFiltered - signalRows.length) + ' noise/fringe comments excluded.'
    }
  }

  const afterSignalCount = filteredRows.length
  let sampled = false
  if (filteredRows.length > sampleSize) {
    for (let i = filteredRows.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = filteredRows[i]; filteredRows[i] = filteredRows[j]; filteredRows[j] = tmp
    }
    filteredRows = filteredRows.slice(0, sampleSize)
    sampled = true
  }

  return {
    rows: filteredRows,
    dataContext: formatRowsForContext(filteredRows, dataset.source),
    collectionMembers,
    totalDatasetRows,
    totalFiltered,
    afterSignalCount,
    sampled,
    signalNote,
  }
}
