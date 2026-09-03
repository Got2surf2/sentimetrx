// lib/anaQueryTools.ts
// Ana's server-executed query tools (2026-09-01). Instead of eyeballing the
// ~200-row context sample, Ana answers numeric questions by querying the SAME
// shared dispatcher the Charts/Stats tabs use (lib/aggregateOps) — so her
// numbers reconcile with the app's numbers by construction — and pulls small
// verbatim samples on demand for evidence quotes (full-text search, same RPC
// as the Comments search).
//
// These tools are executed inside the ask-ana streaming loop (server-side
// round-trip), unlike the theme-mutation tools which surface to the client as
// confirmation cards. Callers do auth; this module only computes.

import type { createServiceRoleClient } from '@/lib/supabase/server'
import { runAggregateOp, TAX_AXES } from '@/lib/aggregateOps'
import { resolveScopeMembers } from '@/lib/collectionScope'
import { validateWhere, resolveWhereRowIds } from '@/lib/anaSegment'

type Service = ReturnType<typeof createServiceRoleClient>

export interface AnaQueryContext {
  datasetId: string
  rowCount: number
  source: string
  /** Flat row ids of the user's filtered view (client-computed, same set the
   *  charts send) — query_data aggregates are scoped to these when present. */
  rowIds: number[] | null
  /** Active question's field key (TextMine pill) — rides into tax_* ops so
   *  dimension numbers match the view the user is looking at. */
  fieldKey: string | null
  /** lower(label) → key and lower(key) → key, so a read targeted by LABEL
   *  ("Like About") still resolves to the data key (owner-hit: reads fell
   *  back to joining demographics when the field didn't resolve). */
  fieldKeyMap?: Record<string, string>
  /** Categorical fields marked section='demographic' in the schema — used to
   *  check a pulled sample's representativeness against the dataset. */
  demoFields?: string[]
  /** Per-request memo of Ana-composed `where` resolutions (same object rides
   *  every tool call in a turn, so repeated subgroup queries resolve once). */
  _whereCache?: Record<string, { ids: number[]; sampled: boolean; label: string }>
}

// ── Tool definitions (Anthropic schema) ────────────────────────────────────
export const ANA_QUERY_TOOLS = [
  {
    name: 'query_data',
    description: 'Run an exact aggregation over the ENTIRE dataset (not the sample in your context). Use this for EVERY numeric claim: counts, breakdowns, averages, trends. Results are automatically scoped to the user\'s active filters. Ops: field_counts (value counts for one field), crosstab (field × field counts), group_stats (numeric stats per group), numeric_stats (stats for one numeric field), date_series (counts/averages over time; use bucket "month" for ranges over ~90 days), tax_counts (dimension sub-category counts for an axis), tax_crosstab (dimension axis × field), tax_axis_crosstab (all dimension axes × field), tax_group_stats (numeric stats per dimension sub), tax_date_series (dimension subs over time). Field names must be the dataset field keys from your context. If the result says sampled:true, the numbers are over the app\'s deterministic 50K analysis sample — say "in the analyzed sample" when reporting them.',
    input_schema: {
      type: 'object' as const,
      properties: {
        op:          { type: 'string', enum: ['field_counts', 'crosstab', 'group_stats', 'numeric_stats', 'date_series', 'tax_counts', 'tax_crosstab', 'tax_axis_crosstab', 'tax_group_stats', 'tax_date_series'], description: 'Which aggregation to run' },
        field:       { type: 'string', description: 'For field_counts / numeric_stats / tax_crosstab / tax_axis_crosstab: the field key' },
        rowField:    { type: 'string', description: 'For crosstab: row field key' },
        colField:    { type: 'string', description: 'For crosstab: column field key' },
        groupField:  { type: 'string', description: 'For group_stats: categorical field key to group by' },
        valueField:  { type: 'string', description: 'For group_stats / tax_group_stats: numeric field key' },
        dateField:   { type: 'string', description: 'For date_series / tax_date_series: date field key' },
        metricField: { type: 'string', description: 'For date_series / tax_date_series: optional numeric field to average per bucket' },
        bucket:      { type: 'string', enum: ['day', 'week', 'month'], description: 'For date_series / tax_date_series: time bucket (default day)' },
        axis:        { type: 'string', enum: TAX_AXES, description: 'For tax_* ops: the dimension axis' },
        limit:       { type: 'number', description: 'Max distinct values returned (default 50, max 100)' },
        where:       { type: 'array', description: 'Optional subgroup conditions YOU compose for questions about a specific group ("young Black men" → [{field:"age", max:29}, {field:"race", values:["Black"]}, {field:"gender", values:["Male"]}]). Conditions AND together AND with the user\'s active filters. values must be EXACT stored values — run field_counts on each demographic field first to see them. Always report the resulting subgroup size.', items: { type: 'object', properties: {
          field:  { type: 'string', description: 'Field key' },
          values: { type: 'array', items: { type: 'string' }, description: 'Categorical include list (exact values)' },
          min:    { type: 'number', description: 'Numeric lower bound (inclusive)' },
          max:    { type: 'number', description: 'Numeric upper bound (inclusive)' },
        }, required: ['field'] } },
        chart:       { type: 'boolean', description: 'Set true ONLY when this query\'s view IS the chart the user would want to open — the one that directly answers their question. The app then offers an "Open in Charts" button for it. Leave unset for intermediate/supporting queries.' },
      },
      required: ['op'],
    },
  },
  {
    name: 'read_comments',
    description: 'Pull a SAMPLE of raw comments into your context to READ — for questions that need synthesis rather than counting: "what are people saying about X", characterizing complaints, finding suggestions, summarizing themes in their own words. Pass query (websearch syntax) to target a topic — you get the most relevant matching comments plus the exact total match count; omit query for a representative sample of the whole dataset. Every returned comment is a real verbatim from the target field (the pull keeps going until the limit is filled or the source is exhausted). If the result reports representativeness drift, TELL the user (e.g. "note: this pull skews older than the dataset"). Always report your reading base honestly. For exact numbers still use query_data; for a handful of display quotes use find_quotes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Optional topic search (websearch syntax). Omit for a representative sample.' },
        field: { type: 'string', description: 'Field key whose text to read (use the ACTIVE VIEW column by default). Omit to read all text fields.' },
        limit: { type: 'number', description: 'How many VERBATIMS to read (default 100, max 400)' },
        where: { type: 'array', description: 'Optional subgroup conditions (same shape as query_data.where) — scopes the read to rows matching ALL conditions AND the user\'s active filters. Use for "what do <group> say" questions so the sample comes from THAT group\'s comments.', items: { type: 'object', properties: {
          field:  { type: 'string', description: 'Field key' },
          values: { type: 'array', items: { type: 'string' }, description: 'Categorical include list (exact values)' },
          min:    { type: 'number', description: 'Numeric lower bound (inclusive)' },
          max:    { type: 'number', description: 'Numeric upper bound (inclusive)' },
        }, required: ['field'] } },
      },
      required: [],
    },
  },
  {
    name: 'find_quotes',
    description: 'Full-text search the ENTIRE dataset for verbatim quotes. Use it (a) to pull real quotes as evidence for a claim — never quote from memory — and (b) to get an exact count of rows mentioning a term. Query uses websearch syntax: space = AND, OR between terms, "quoted phrases" for exact phrases. IMPORTANT: the total is over the whole dataset and IGNORES the user\'s active filters — for filtered counts use query_data. Quote only text returned by this tool or present verbatim in your context sample.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query (websearch syntax, e.g. \'wait OR slow "long line"\')' },
        field: { type: 'string', description: 'Field key whose text to quote (use the ACTIVE VIEW column by default). Omit to quote all text fields.' },
        limit: { type: 'number', description: 'Max quotes to return (default 8, max 20)' },
      },
      required: ['query'],
    },
  },
]

export const ANA_QUERY_TOOL_NAMES = new Set(ANA_QUERY_TOOLS.map(function(t) { return t.name }))

// Human-readable one-liner streamed to the panel while a tool runs.
export function anaToolStatusLabel(name: string, input: Record<string, unknown>): string {
  if (name === 'find_quotes') return 'Searching for "' + String(input.query || '').slice(0, 60) + '"…'
  if (name === 'read_comments') return input.query ? 'Reading comments about "' + String(input.query).slice(0, 50) + '"…' : 'Reading a sample of comments…'
  var op = String(input.op || '')
  var labels: Record<string, string> = {
    field_counts: 'Counting values', crosstab: 'Running a crosstab', group_stats: 'Computing group stats',
    numeric_stats: 'Computing stats', date_series: 'Building a time series', tax_counts: 'Counting dimension mentions',
    tax_crosstab: 'Crossing dimensions', tax_axis_crosstab: 'Crossing dimension axes',
    tax_group_stats: 'Computing dimension stats', tax_date_series: 'Building a dimension time series',
  }
  return (labels[op] || 'Querying the data') + '…'
}

// One quote line from a row. With onlyField: that column or NOTHING — a row
// whose target column is empty is excluded by the caller, never padded with
// other fields (the old fallback printed demographic metadata on wide survey
// rows — owner-hit 9/02). Without a field: prefer SUBSTANTIVE text (longest
// fields first) so a wide row's short descriptor fields never crowd out the
// actual open-ended response.
function quoteFromRow(data: Record<string, unknown>, maxChars: number, onlyField?: string): string {
  if (onlyField) {
    var fv = data[onlyField]
    if (typeof fv === 'string' && fv.trim().length > 2) {
      return fv.length > maxChars ? fv.slice(0, maxChars) + '…' : fv
    }
    return ''
  }
  var texts: string[] = []
  for (var k in data) {
    if (k.startsWith('_')) continue
    var v = data[k]
    if (typeof v === 'string' && v.length > 2 && /[a-zA-Z]/.test(v)) texts.push(v)
  }
  var longs = texts.filter(function(t) { return t.trim().length >= 25 }).sort(function(a, b) { return b.length - a.length })
  var joined = (longs.length > 0 ? longs : texts).join(' | ')
  return joined.length > maxChars ? joined.slice(0, maxChars) + '…' : joined
}

// Resolve a requested field (key OR label, any case) to the data key; when
// nothing is requested, default to the analyst's active view column.
function resolveReadField(input: Record<string, unknown>, ctx: AnaQueryContext): string | undefined {
  var raw = typeof input.field === 'string' ? input.field.trim() : ''
  if (raw) {
    var mapped = ctx.fieldKeyMap ? ctx.fieldKeyMap[raw.toLowerCase()] : undefined
    return mapped || raw
  }
  return ctx.fieldKey || undefined
}

// Cap a tool result's serialized size so a wide grid can't blow the context.
// Grids/series/counts are trimmed rather than failed — Ana can always narrow.
const RESULT_CHAR_CAP = 8000

function compactResult(body: Record<string, unknown>): Record<string, unknown> {
  if (JSON.stringify(body).length <= RESULT_CHAR_CAP) return body
  var out: Record<string, unknown> = { ...body }
  var counts = out.counts as Record<string, number> | undefined
  if (counts) {
    var entries = Object.entries(counts).sort(function(a, b) { return b[1] - a[1] })
    out.counts = Object.fromEntries(entries.slice(0, 50))
    out.truncated = entries.length - 50 + ' more values omitted — use a larger limit only if needed'
  }
  var series = out.series as unknown[] | undefined
  if (series && series.length > 200) {
    out.series = series.slice(-200)
    out.truncated = 'showing the most recent 200 buckets — re-run with bucket "month" for the full range'
  }
  var grid = out.grid as Record<string, Record<string, number>> | undefined
  if (grid) {
    var rowKeys = Object.keys(grid).sort(function(a, b) {
      var sa = Object.values(grid![a]).reduce(function(s, v) { return s + v }, 0)
      var sb = Object.values(grid![b]).reduce(function(s, v) { return s + v }, 0)
      return sb - sa
    })
    if (rowKeys.length > 30) {
      var kept: Record<string, Record<string, number>> = {}
      rowKeys.slice(0, 30).forEach(function(k) { kept[k] = grid![k] })
      out.grid = kept
      out.rows = rowKeys.slice(0, 30)
      out.truncated = rowKeys.length - 30 + ' more rows omitted (kept the 30 largest)'
    }
  }
  return out
}

// ── Canvas handoff mapping ─────────────────────────────────────────────────
// Map a query_data call onto the Charts tab's {chartType, config} shape (the
// same object a saved chart applies via handleLoadSaved) — so an answer can
// become the exact chart behind it with one tap. Slot keys mirror CHART_SLOTS;
// dimension axes use the derived '__dim_<axis>__' field ids.
export interface AnaCanvasTarget { chartType: string; config: Record<string, string>; label: string }

export function chartConfigForQuery(input: Record<string, unknown>, fieldTypes?: Record<string, string>): AnaCanvasTarget | null {
  const op = String(input.op || '')
  const f = (k: string) => (typeof input[k] === 'string' ? String(input[k]) : '')
  const dim = f('axis') ? '__dim_' + f('axis') + '__' : ''
  const isNumeric = (k: string) => fieldTypes?.[k] === 'numeric'
  // The bar chart's category slot only accepts categoricals — a numeric field
  // (e.g. a star rating) lands on the distribution chart instead, or the chip
  // configures a chart the picker rejects ("No data for this field").
  if (op === 'field_counts' && f('field')) {
    if (isNumeric(f('field'))) return { chartType: 'distribution', config: { field: f('field') }, label: f('field') + ' distribution' }
    return { chartType: 'bar', config: { category: f('field') }, label: f('field') + ' counts' }
  }
  if (op === 'crosstab' && f('rowField') && f('colField')) return { chartType: 'crosstab', config: { rows: f('rowField'), cols: f('colField') }, label: f('rowField') + ' × ' + f('colField') }
  if (op === 'group_stats' && f('groupField') && f('valueField')) return { chartType: 'bar', config: { category: f('groupField'), value: f('valueField') }, label: f('valueField') + ' by ' + f('groupField') }
  if (op === 'numeric_stats' && f('field')) return { chartType: 'distribution', config: { field: f('field') }, label: f('field') + ' distribution' }
  if (op === 'date_series' && f('dateField')) {
    const cfg: Record<string, string> = { date: f('dateField') }
    if (f('metricField')) cfg.metric = f('metricField')
    return { chartType: 'timeseries', config: cfg, label: 'trend over ' + f('dateField') }
  }
  if (op === 'tax_counts' && dim) return { chartType: 'bar', config: { category: dim }, label: f('axis') + ' mentions' }
  if (op === 'tax_group_stats' && dim && f('valueField')) return { chartType: 'bar', config: { category: dim, value: f('valueField') }, label: f('valueField') + ' by ' + f('axis') }
  if (op === 'tax_crosstab' && dim && f('field')) return { chartType: 'crosstab', config: { rows: dim, cols: f('field') }, label: f('axis') + ' × ' + f('field') }
  if (op === 'tax_date_series' && dim && f('dateField')) return { chartType: 'timeseries', config: { date: f('dateField'), colorBy: dim }, label: f('axis') + ' over time' }
  return null
}

// ── Executor ───────────────────────────────────────────────────────────────
export async function executeAnaQueryTool(
  service: Service,
  ctx: AnaQueryContext,
  name: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // Ana-composed subgroup (`where`, 2026-09-04): resolve to row ids through
  // the canonical filter engine, INTERSECT with the user's active filters
  // (both must hold), and run the rest of the tool with the scoped ids.
  var whereLabel: string | null = null
  var whereSampled = false
  if ((name === 'query_data' || name === 'read_comments') && input.where != null) {
    var validated = validateWhere(input.where)
    if ('error' in validated) return { error: validated.error }
    var cacheKey = JSON.stringify(validated)
    var cache = (ctx._whereCache = ctx._whereCache || {})
    var resolved = cache[cacheKey]
    if (!resolved) {
      var res = await resolveWhereRowIds(service, { datasetId: ctx.datasetId, rowCount: ctx.rowCount, where: validated })
      if ('error' in res) return { error: res.error, hint: 'Run field_counts on the demographic field first and use its EXACT values in where.' }
      cache[cacheKey] = resolved = res
    }
    var scoped = resolved.ids
    if (ctx.rowIds) {
      var userSet = new Set<number>(ctx.rowIds)
      scoped = resolved.ids.filter(function(id) { return userSet.has(id) })
    }
    if (scoped.length === 0) return { error: 'The subgroup (' + resolved.label + ') has no rows inside the user\'s active filters.' }
    whereLabel = resolved.label
    whereSampled = resolved.sampled
    ctx = { ...ctx, rowIds: scoped }
  }

  if (name === 'query_data') {
    var limit = Math.min(Math.max(1, Number(input.limit) || 50), 100)
    var result = await runAggregateOp(
      service,
      ctx.datasetId,
      { rowCount: ctx.rowCount, source: ctx.source },
      {
        op: typeof input.op === 'string' ? input.op : undefined,
        field: typeof input.field === 'string' ? input.field : undefined,
        rowField: typeof input.rowField === 'string' ? input.rowField : undefined,
        colField: typeof input.colField === 'string' ? input.colField : undefined,
        groupField: typeof input.groupField === 'string' ? input.groupField : undefined,
        valueField: typeof input.valueField === 'string' ? input.valueField : undefined,
        dateField: typeof input.dateField === 'string' ? input.dateField : undefined,
        metricField: typeof input.metricField === 'string' ? input.metricField : undefined,
        bucket: typeof input.bucket === 'string' ? input.bucket : undefined,
        axis: typeof input.axis === 'string' ? input.axis : undefined,
        limit: limit,
        rowIds: ctx.rowIds || undefined,
        fieldKey: ctx.fieldKey || undefined,
      },
    )
    if (result.status !== 200) {
      return { error: String(result.body.error || 'query failed'), hint: 'Check the op name and that field keys match the dataset fields listed in your context.' }
    }
    var body = compactResult(result.body)
    if (whereLabel) {
      body.scope = 'scoped to the subgroup ' + whereLabel + ' (' + ctx.rowIds!.length.toLocaleString() + ' rows'
        + (whereSampled ? ', resolved over the 50K analysis sample' : '') + ')'
        + ' — always report this subgroup size with your findings'
    } else if (ctx.rowIds) {
      body.scope = 'scoped to the user\'s active filters (' + ctx.rowIds.length.toLocaleString() + ' rows)'
    }
    return body
  }

  if (name === 'read_comments') {
    var readLimit = Math.min(Math.max(10, Number(input.limit) || 100), 400)
    var topic = String(input.query || '').trim()
    var readField = resolveReadField(input, ctx)
    var readTargets = ctx.source === 'collection'
      ? await resolveScopeMembers(service, ctx.datasetId)
      : [{ datasetId: ctx.datasetId, label: null as string | null }]
    if (readTargets.length === 0) readTargets = [{ datasetId: ctx.datasetId, label: null }]

    // Fill-to-limit collection: every path keeps pulling until readLimit REAL
    // verbatims are in hand or the source is exhausted (owner 9/02: "a sample
    // of 500 should actually have 500 verbatims").
    type Kept = { line: string; data: Record<string, unknown> }
    var kept: Kept[] = []
    var emptyField = 0
    var seenIds = new Set<number>()
    var READ_CHAR_CAP = 60000
    var usedChars = 0
    function keep(id: number | null, data: Record<string, unknown>, label: string | null): boolean {
      if (kept.length >= readLimit || usedChars >= READ_CHAR_CAP) return false
      if (id != null) { if (seenIds.has(id)) return true; seenIds.add(id) }
      var line = quoteFromRow(data, 300, readField)
      if (!line) { if (readField) emptyField++; return true }
      if (label) line = '[' + label + '] ' + line
      kept.push({ line: line, data: data })
      usedChars += line.length
      return true
    }

    var matchTotal = 0
    if (topic) {
      // Targeted: page the rank-ordered matches per target until filled.
      var readIdSet = ctx.rowIds ? new Set(ctx.rowIds) : null
      var deferred: { id: number; data: Record<string, unknown>; label: string | null }[] = []
      for (var rt of readTargets) {
        var offset = 0
        var pageSize = Math.min(200, Math.max(50, readLimit))
        var scanned = 0
        while (kept.length < readLimit && usedChars < READ_CHAR_CAP && scanned < 2000) {
          var rr = await service.rpc('search_dataset_rows', {
            p_dataset_id: rt.datasetId, p_query: topic, p_limit: pageSize, p_offset: offset,
          })
          var hits: { id: number; data: Record<string, unknown> | null }[] = []
          if (!rr.error && rr.data && rr.data.length > 0) {
            hits = rr.data as typeof hits
          } else if (offset === 0) {
            var rfb = await service
              .from('dataset_rows_flat')
              .select('id, data')
              .eq('dataset_id', rt.datasetId)
              .textSearch('tsv', topic, { type: 'websearch', config: 'english' })
              .order('row_index', { ascending: true })
              .range(0, pageSize - 1)
            if (rfb.error) return { error: 'Search failed: ' + rfb.error.message, hint: 'Simplify the query — plain terms, OR between alternatives.' }
            hits = (rfb.data || []) as typeof hits
          }
          if (hits.length === 0) break
          for (var h of hits) {
            // In-view rows first when filters are active; out-of-view matches
            // fill remaining space afterwards.
            if (readIdSet && !readIdSet.has(h.id)) { deferred.push({ id: h.id, data: h.data || {}, label: rt.label }); continue }
            keep(h.id, h.data || {}, rt.label)
          }
          scanned += hits.length
          if (hits.length < pageSize) break
          offset += pageSize
        }
        var { count: rc } = await service
          .from('dataset_rows_flat')
          .select('id', { count: 'exact', head: true })
          .eq('dataset_id', rt.datasetId)
          .textSearch('tsv', topic, { type: 'websearch', config: 'english' })
        matchTotal += rc || 0
      }
      for (var dv of deferred) { if (!keep(dv.id, dv.data, dv.label)) break }
    } else if (ctx.rowIds && ctx.rowIds.length > 0 && ctx.source !== 'collection') {
      // Untargeted + filters: walk the filtered view in evenly-spaced passes,
      // batch-fetching until the limit is filled with real verbatims.
      var ids = ctx.rowIds
      var stride = Math.max(1, Math.floor(ids.length / readLimit))
      for (var pass = 0; pass < stride && kept.length < readLimit && usedChars < READ_CHAR_CAP; pass++) {
        var pickIds: number[] = []
        for (var pi = pass; pi < ids.length && pickIds.length < readLimit; pi += stride) {
          if (!seenIds.has(ids[pi])) pickIds.push(ids[pi])
        }
        if (pickIds.length === 0) break
        var byId = await service
          .from('dataset_rows_flat')
          .select('id, data')
          .eq('dataset_id', ctx.datasetId)
          .in('id', pickIds.slice(0, 250))
        if (byId.error) return { error: 'Read failed: ' + byId.error.message }
        var got = (byId.data || []) as { id: number; data: Record<string, unknown> | null }[]
        if (got.length === 0) break
        for (var b of got) keep(b.id, b.data || {}, null)
      }
    } else {
      // Untargeted: deterministic representative sample — over-fetch when a
      // field is targeted so sparse columns still fill the limit.
      var budget = readField ? readLimit * 4 : readLimit
      var perTargetRead = Math.max(10, Math.ceil(budget / readTargets.length))
      for (var st of readTargets) {
        if (kept.length >= readLimit) break
        var sr = await service.rpc('sample_row_pairs', { p_dataset_id: st.datasetId, p_fields: [], p_limit: perTargetRead })
        if (!sr.error && sr.data) {
          for (var srow of sr.data as { data: Record<string, unknown> }[]) keep(null, srow.data, st.label)
        }
      }
    }

    var readResult: Record<string, unknown> = {
      readCount: kept.length,
      comments: kept.map(function(kp) { return kp.line }),
    }
    if (readField) {
      readResult.fieldUsed = readField
      if (emptyField > 0) readResult.rowsWithoutThisField = emptyField
      if (kept.length === 0) readResult.hint = 'No rows in this pull carry text in "' + readField + '" — its coverage may be sparse or year-specific. Check coverage with query_data field_counts first, or read without a topic query.'
    }
    if (topic) {
      readResult.totalMatching = matchTotal
      readResult.scope = whereLabel
        ? 'read ' + kept.length + ' verbatims matching "' + topic + '" from the subgroup ' + whereLabel + ' (' + ctx.rowIds!.length.toLocaleString() + ' rows) — always report this subgroup with your findings'
        : 'read ' + kept.length + ' verbatims from the ' + matchTotal.toLocaleString() + ' comments matching "' + topic + '" across the ENTIRE dataset' + (ctx.rowIds ? ' (in-view comments first)' : '')
    } else if (ctx.rowIds && ctx.source !== 'collection') {
      readResult.scope = whereLabel
        ? 'an evenly-spread sample of the subgroup ' + whereLabel + ' (' + ctx.rowIds.length.toLocaleString() + ' rows) — always report this subgroup with your findings'
        : 'an evenly-spread sample of the user\'s filtered view (' + ctx.rowIds.length.toLocaleString() + ' rows)'
    } else {
      readResult.scope = 'a representative sample of the whole dataset'
    }

    // ── Representativeness: does this pull's demographic mix match the
    // dataset? A targeted read can silently skew (one wave, one region, one
    // age band) — measure it and say so (owner 9/02).
    if (kept.length >= 30 && ctx.demoFields && ctx.demoFields.length > 0) {
      var drift: string[] = []
      for (var df of ctx.demoFields.slice(0, 3)) {
        var tally: Record<string, number> = {}
        var counted = 0
        for (var kp2 of kept) {
          var dv2 = kp2.data[df]
          if (typeof dv2 !== 'string' && typeof dv2 !== 'number') continue
          var key2 = String(dv2).trim()
          if (!key2) continue
          tally[key2] = (tally[key2] || 0) + 1
          counted++
        }
        if (counted < 20) continue
        var base = await runAggregateOp(service, ctx.datasetId, { rowCount: ctx.rowCount, source: ctx.source }, { op: 'field_counts', field: df, limit: 50, rowIds: ctx.rowIds || undefined })
        var baseCounts = (base.status === 200 ? base.body.counts : null) as Record<string, number> | null
        if (!baseCounts) continue
        var baseTotal = 0
        for (var bk in baseCounts) baseTotal += baseCounts[bk]
        if (baseTotal === 0) continue
        for (var val in baseCounts) {
          var baseShare = baseCounts[val] / baseTotal
          if (baseShare < 0.05) continue
          var pullShare = (tally[val] || 0) / counted
          if (Math.abs(pullShare - baseShare) >= 0.15) {
            drift.push(df + ': "' + val + '" is ' + Math.round(pullShare * 100) + '% of this pull vs ' + Math.round(baseShare * 100) + '% of the dataset')
          }
        }
      }
      if (drift.length > 0) {
        readResult.representativenessDrift = drift.slice(0, 4)
        readResult.driftNote = 'This pull\'s demographic mix differs meaningfully from the dataset — tell the user before generalizing.'
      }
    }
    return readResult
  }

  if (name === 'find_quotes') {
    var q = String(input.query || '').trim()
    if (!q) return { error: 'query required' }
    var quoteLimit = Math.min(Math.max(1, Number(input.limit) || 8), 20)
    var quoteField = resolveReadField(input, ctx)

    // Collection → search each member; single dataset → itself.
    var targets = ctx.source === 'collection'
      ? await resolveScopeMembers(service, ctx.datasetId)
      : [{ datasetId: ctx.datasetId, label: null as string | null }]
    if (targets.length === 0) targets = [{ datasetId: ctx.datasetId, label: null }]

    // Pull a candidate pool (rank-ordered RPC, textSearch fallback) so quotes
    // can prefer the user's filtered view when filters are active.
    type Candidate = { id: number; data: Record<string, unknown>; label: string | null }
    var perTarget = Math.max(quoteLimit, Math.ceil((quoteLimit * 5) / targets.length))
    var candidates: Candidate[] = []
    var total = 0
    for (var t of targets) {
      var rpcResult = await service.rpc('search_dataset_rows', {
        p_dataset_id: t.datasetId, p_query: q, p_limit: perTarget, p_offset: 0,
      })
      var rowsRaw: { id: number; data: Record<string, unknown> | null }[] = []
      if (!rpcResult.error && rpcResult.data && rpcResult.data.length > 0) {
        rowsRaw = rpcResult.data as typeof rowsRaw
      } else {
        var fb = await service
          .from('dataset_rows_flat')
          .select('id, data')
          .eq('dataset_id', t.datasetId)
          .textSearch('tsv', q, { type: 'websearch', config: 'english' })
          .order('row_index', { ascending: true })
          .range(0, perTarget - 1)
        if (fb.error) return { error: 'Search failed: ' + fb.error.message, hint: 'Simplify the query — plain terms, OR between alternatives.' }
        rowsRaw = (fb.data || []) as typeof rowsRaw
      }
      for (var r of rowsRaw) candidates.push({ id: r.id, data: r.data || {}, label: t.label })

      var { count } = await service
        .from('dataset_rows_flat')
        .select('id', { count: 'exact', head: true })
        .eq('dataset_id', t.datasetId)
        .textSearch('tsv', q, { type: 'websearch', config: 'english' })
      total += count || 0
    }

    // Prefer quotes from the filtered view when the user has filters active.
    var idSet = ctx.rowIds ? new Set(ctx.rowIds) : null
    if (idSet) {
      var inView: Candidate[] = []
      var outView: Candidate[] = []
      for (var c of candidates) (idSet.has(c.id) ? inView : outView).push(c)
      candidates = inView.concat(outView)
    }

    return {
      total: total,
      totalScope: 'rows matching across the ENTIRE dataset — active filters are NOT applied to this count',
      quotes: candidates
        .map(function(c) {
          var qtext = quoteFromRow(c.data, 350, quoteField)
          if (!qtext) return null
          var entry: Record<string, unknown> = { text: qtext }
          if (c.label) entry.source = c.label
          if (idSet) entry.inFilteredView = idSet.has(c.id)
          return entry
        })
        .filter(function(e): e is Record<string, unknown> { return e !== null })
        .slice(0, quoteLimit),
      ...(quoteField ? { fieldUsed: quoteField } : {}),
    }
  }

  return { error: 'Unknown tool: ' + name }
}
