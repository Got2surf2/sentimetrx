# Sentimetrx — Full-Text Search + AI Re-Ranking Spec

**Module:** `/app/api/datasets/[datasetId]/search/route.ts`, `components/analyze/textmine/SearchPanel.tsx`, dataset-header search modal in `app/analyze/[datasetId]/DatasetHeader.tsx`
**Storage:** `dataset_rows_flat` with `tsv` TSVECTOR column + GIN index, plus `search_dataset_rows()` RPC (migration `031_dataset_search.sql`)
**External APIs:** Anthropic via `callAI` (used for query expansion + re-ranking); no other third-party APIs
**Feature gate:** `organizations.features.analyze` (search lives inside TextMine, gated with the rest of the analyze module)

> **Spec scope:** complete enough to rebuild the search feature from scratch.
> Includes the migration verbatim, the `search_dataset_rows()` PL/pgSQL,
> every step of the query pipeline (expansion → candidate fetch → re-rank →
> threshold → pagination), both AI prompts verbatim, and the SearchPanel UI
> behavior. Source of truth is the code — current as of 2026-05-06.

---

## 1. Overview

A user types into the search modal in the dataset header. Two paths:

1. **AI Search off** — `q` runs through `websearch_to_tsquery('english', q)` and matches against the `tsv` column on `dataset_rows_flat`. Pure full-text, ranked by `ts_rank_cd`. Fast, cheap.
2. **AI Search on** —
   - Step A: `callAI` expands the query into a synonym list. ("disappointed with food" → "disappointed unhappy upset disliked food meal dish dining")
   - Step B: those synonyms are OR-joined into a websearch tsquery and 100 candidates per target are pulled (RPC, ts_rank ordered).
   - Step C: a *second* `callAI` ("strict scorer") re-ranks the candidates 0.0–1.0 by how fully they answer the **original** natural-language query, penalising partial matches on multi-concern queries.
   - Step D: candidates with score ≥ 0.3 survive, sorted by score, paginated.

Collections (the `source: 'collection'` virtual datasets) are handled by resolving to member datasets and unioning per-target candidate pools.

The whole thing runs in one HTTP request — no async jobs, no caching, no precomputation beyond the GIN index.

---

## 2. Database Schema — `sql/031_dataset_search.sql`

### tsv column + GIN index

```sql
ALTER TABLE dataset_rows_flat ADD COLUMN IF NOT EXISTS tsv TSVECTOR;
CREATE INDEX IF NOT EXISTS idx_drf_tsv ON dataset_rows_flat USING GIN(tsv);
```

### Auto-population trigger

```sql
CREATE OR REPLACE FUNCTION drf_tsv_trigger() RETURNS TRIGGER AS $$
DECLARE
  txt TEXT := '';
  val TEXT;
  key TEXT;
BEGIN
  FOR key, val IN SELECT k, v::text FROM jsonb_each_text(NEW.data) AS x(k, v)
  LOOP
    -- Skip very short values and numeric-only values
    IF length(val) > 2 AND val ~ '[a-zA-Z]' THEN
      txt := txt || ' ' || val;
    END IF;
  END LOOP;
  NEW.tsv := to_tsvector('english', COALESCE(txt, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_drf_tsv ON dataset_rows_flat;
CREATE TRIGGER trg_drf_tsv
  BEFORE INSERT OR UPDATE OF data ON dataset_rows_flat
  FOR EACH ROW EXECUTE FUNCTION drf_tsv_trigger();
```

The trigger concatenates every string field from the row's `data` JSONB (skipping numeric-only values and tokens shorter than 3 chars) and computes `to_tsvector('english', ...)`. Fires on `INSERT` and on `UPDATE OF data` so that updating any other column doesn't unnecessarily recompute the tsv.

### Search RPC

```sql
CREATE OR REPLACE FUNCTION search_dataset_rows(
  p_dataset_id UUID, p_query TEXT, p_limit INT DEFAULT 50, p_offset INT DEFAULT 0
)
RETURNS TABLE(
  id        BIGINT,
  row_index INT,
  data      JSONB,
  rank      REAL,
  headline  TEXT
) AS $$
DECLARE
  tsquery_val TSQUERY;
BEGIN
  tsquery_val := websearch_to_tsquery('english', p_query);

  RETURN QUERY
  SELECT
    r.id, r.row_index, r.data,
    ts_rank_cd(r.tsv, tsquery_val)::REAL AS rank,
    ts_headline('english',
      (SELECT string_agg(v, ' | ')
       FROM jsonb_each_text(r.data) AS x(k, v)
       WHERE length(v) > 2 AND v ~ '[a-zA-Z]'),
      tsquery_val,
      'StartSel=<mark>, StopSel=</mark>, MaxWords=25, MinWords=10, MaxFragments=2'
    ) AS headline
  FROM dataset_rows_flat r
  WHERE r.dataset_id = p_dataset_id
    AND r.tsv @@ tsquery_val
  ORDER BY rank DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Backfill

```sql
UPDATE dataset_rows_flat SET tsv = to_tsvector('english',
  COALESCE((SELECT string_agg(v, ' ') FROM jsonb_each_text(data) AS x(k, v)
    WHERE length(v) > 2 AND v ~ '[a-zA-Z]'), ''))
WHERE tsv IS NULL;
```

> **Historical note:** the original migration left this backfill block commented
> out, which silently shipped to production with all pre-existing rows having
> NULL `tsv` — so search returned zero results until backfilled. The fix
> uncommented the block (May 2026) and the live database was hand-backfilled
> via a Node script that walked all NULL-tsv rows and re-wrote `data = data` on
> each, firing the trigger. Re-running this migration is idempotent.

### Why `websearch_to_tsquery`, not `plainto_tsquery`

The original migration used `plainto_tsquery`, which AND's everything. AI-expanded queries like `"disappointed unhappy upset disliked food meal"` then required *every* token to be present, so almost nothing matched. The fix is `websearch_to_tsquery`, which understands `OR` as an explicit operator. The route's expansion path produces strings like `"disappointed OR unhappy OR upset OR disliked OR food OR meal"` for that reason.

---

## 3. The Search Route — `app/api/datasets/[datasetId]/search/route.ts`

`GET` only. Auth required. Returns `{ results, total, rawTotal, reranked, query, searchQuery?, aiInterpretation? }`.

### Query parameters

| Param | Default | Notes |
|---|---|---|
| `q` | required | Natural-language query |
| `limit` | 50 | Capped at 200 |
| `offset` | 0 | For pagination over the candidate pool |
| `ai` | `'false'` | When `'true'`, runs expansion + re-rank |

### Constants

```typescript
const AI_CANDIDATE_POOL = 100         // pulled from the RPC per target before re-ranking
const AI_RELEVANCE_THRESHOLD = 0.3    // keep candidates scored ≥ this
```

### Pipeline

#### Step 1 — Auth + ownership check

Resolve the caller via `getCallerOrgContext(supabase)` from `lib/auth/orgAccess.ts` — returns `{ userId, orgId, isAdmin }`. 401 if no `userId`/`orgId`. Load the dataset's `org_id, source`; 404 if it doesn't exist. **Admin bypass**: super-admins (`isAdmin === true`) can search any org's dataset; non-admins get 404 if `dataset.org_id !== orgId`. This matches the rest of the analyze module ("admin Phase E: super-admins cross-org").

#### Step 2 — Resolve targets

```typescript
let targets: Array<{ datasetId: string; label: string | null }> = [{ datasetId: params.datasetId, label: null }]
if ((dataset as any).source === 'collection') {
  const { data: collection } = await service.from('collections').select('id').eq('dataset_id', params.datasetId).single()
  if (collection) {
    const { data: members } = await service
      .from('collection_members')
      .select('dataset_id, label')
      .eq('collection_id', collection.id)
      .order('sort_order', { ascending: true })
    if (members?.length) targets = members.map(m => ({ datasetId: m.dataset_id, label: m.label }))
  }
}
```

For non-collection datasets, `targets` is just the dataset itself. For collections, it's every member, with their per-member label that gets attached to result rows as `_collection_label`.

#### Step 3 — AI query expansion (only when `ai=true`)

```typescript
const result = await callAI({
  tier: 'fast',
  maxTokens: 100,
  timeoutMs: 5000,
  system: '...EXPANSION_PROMPT...',
  messages: [{ role: 'user', content: rawQuery }],
  usage: { org_id: dataset.org_id, resource_type: 'dataset', resource_id: params.datasetId, event_type: 'search' },
})
```

**Expansion system prompt (verbatim):**

```
You are a search query optimizer. The user wants to search through survey responses, social comments, or discussion transcripts.

Given their natural language query, extract the key search terms that would match relevant text.
Focus on the core concepts, not filler words.
If the query implies sentiment (e.g., "negative comments about..."), include sentiment-related synonyms.
If the query mentions a demographic or attribute, include related terms.

Return ONLY the search terms, space-separated. No explanation.
Example: "find comments from parents worried about school safety" → "parent parents school safety worried concern unsafe"
```

If the response is non-empty (length > 2), `searchQuery` is replaced with the expanded terms and `isExpanded = true`. The original `rawQuery` is kept for the re-ranker so it can score against intent.

#### Step 4 — Build the websearch query string

```typescript
let tsQueryStr = searchQuery
if (isExpanded) {
  const terms = searchQuery.split(/\s+/).filter(w => w.length > 1)
  if (terms.length > 1) tsQueryStr = terms.join(' OR ')
}
```

For single-word queries or non-AI mode, the raw query is passed through. AI-expanded queries become `term1 OR term2 OR term3 ...` so any synonym match qualifies.

#### Step 5 — Fetch candidate pool

```typescript
const candidatePool = useAI ? AI_CANDIDATE_POOL : limit
const perTargetCap = targets.length > 0 ? Math.ceil(candidatePool / targets.length) : candidatePool
```

For non-AI: pool size = `limit`. For AI: 100 candidates total, divided equally among targets.

For each target, prefer the **rank-ordered RPC**, fall back to plain `.textSearch`:

```typescript
// Try the RPC first — returns rows ordered by ts_rank DESC
const rpcResult = await service.rpc('search_dataset_rows', {
  p_dataset_id: t.datasetId,
  p_query:      tsQueryStr,
  p_limit:      perTargetCap,
  p_offset:     0,
})

if (!rpcResult.error && rpcResult.data && rpcResult.data.length > 0) {
  matched = rpcResult.data.map(...)   // already sorted by ts_rank DESC
} else {
  // Fallback: same query without rank ordering
  const fb = await service
    .from('dataset_rows_flat')
    .select('id, row_index, data')
    .eq('dataset_id', t.datasetId)
    .textSearch('tsv', tsQueryStr, { type: 'websearch', config: 'english' })
    .order('row_index', { ascending: true })
    .range(0, perTargetCap - 1)
  matched = (fb.data || []).map(...)
}
```

The RPC path is materially better because candidates are biased toward keyword-densest matches — the AI re-ranker then sees the rows most likely to be relevant. The fallback path was historically necessary when the live RPC was still using `plainto_tsquery` and silently returned zero rows; it's preserved as a graceful degradation path.

For each matched row, attach `_collection_label` if the target has one, then push into `results`.

#### Step 6 — Total count

Per target, count the total matches via `.textSearch` (head-only, count-exact) so the response can show "re-ranked N of M keyword matches". Sum across targets → `total`.

#### Step 7 — AI re-ranking (only when `ai=true` AND `results.length > 1`)

Format candidates with 1-indexed prefixes and a 240-char snippet of the row's stringy fields:

```typescript
const numbered = results.map((r, i) => '[' + (i + 1) + '] ' + snippetFromRow(r.data, 240)).join('\n\n')
```

Call the strict scorer:

```typescript
const rankResult = await callAI({
  tier: 'fast',
  maxTokens: 1500,
  timeoutMs: 20000,
  system: '...STRICT_SCORER_PROMPT...',
  messages: [{ role: 'user', content: 'Query: ' + rawQuery + '\n\nCandidates:\n' + numbered }],
  usage: { org_id: dataset.org_id, resource_type: 'dataset', resource_id: params.datasetId, event_type: 'search_rerank' },
})
```

**Strict scorer system prompt (verbatim):**

```
You are a strict search relevance scorer. Score each candidate snippet 0.0-1.0 for how fully it answers the user's query.

CRITICAL: identify every distinct concern in the query (split on "and", "+", commas, "with", lists). The score MUST reflect how many concerns the snippet actually addresses with substance — not just keyword presence.

For multi-concern queries (e.g. "X and Y", "A, B, and C"):
- A snippet must address ALL concerns substantively to score above 0.75.
- Addressing only one of two concerns: maximum 0.55.
- Addressing two of three concerns: maximum 0.65.
For single-concern queries:
- Snippet directly and substantively about the topic: 0.8-1.0.
- Mentions the topic in passing: 0.4-0.6.
Always:
- Coincidental keyword match without intent alignment: 0.0-0.2.
- Treat paraphrases as full matches ("staff hurried us" = "rushed service").

Return ONLY one line per candidate in the form "INDEX|SCORE". No explanation. No header. No extra text.
```

Note this prompt scores against `rawQuery` (the user's original natural-language sentence), **not** against the OR-expanded synonym soup. The expansion exists only to widen recall in step 5; the AI then judges relevance against intent.

#### Step 8 — Parse, filter, sort

```typescript
const scores = new Map<number, number>()
for (const line of (rankResult.text || '').split('\n')) {
  const m = line.match(/(\d+)\s*[|:]\s*([01](?:\.\d+)?)/)
  if (m) {
    const idx = parseInt(m[1]) - 1
    const score = parseFloat(m[2])
    if (idx >= 0 && idx < results.length && !isNaN(score)) scores.set(idx, score)
  }
}

if (scores.size > 0) {
  const annotated = results.map((r, i) => ({ ...r, rank: scores.get(i) ?? 0 }))
  annotated.sort((a, b) => b.rank - a.rank)
  results = annotated.filter(r => r.rank >= AI_RELEVANCE_THRESHOLD)
  reranked = true
}
```

The regex `(\d+)\s*[|:]\s*([01](?:\.\d+)?)` accepts `1|0.85` or `1: 0.85` — tolerant of slight format drift. Anything below 0.3 is dropped. Rank order is descending. If no scores parsed, the original ts_rank ordering survives.

#### Step 9 — Paginate and return

```typescript
const paged = results.slice(offset, offset + limit)

return NextResponse.json({
  results:        paged,
  total:          reranked ? results.length : total,
  rawTotal:       total,
  reranked,
  query:          rawQuery,
  searchQuery:    searchQuery !== rawQuery ? searchQuery : undefined,
  aiInterpretation,
})
```

`total` reflects the post-threshold count when re-ranked, so the UI can render "showing X of Y results matching intent". `rawTotal` is always the raw keyword-match count for context.

---

## 4. SearchPanel — `components/analyze/textmine/SearchPanel.tsx`

The result UI. Single self-contained component (input + AI-mode toggle + results), no internal routing. Surfaced in **two places**, both passing only `datasetId` (+ optional `openEndedField`): (1) the dataset-header search modal (`DatasetHeader.tsx`, available from every tab), and (2) **inline at the top of the TextMine → Comments view** (`TextMineModule.tsx`) so you can search the comment text in place. Same component, same `/search` endpoint — no duplicated search logic.

### Props

```typescript
interface Props {
  datasetId:       string
  openEndedField?: string   // optional: prefer this field as the "comment" column
}
```

### State

```typescript
const [query,            setQuery]            = useState('')
const [results,          setResults]          = useState<SearchResult[]>([])
const [total,            setTotal]            = useState(0)
const [rawTotal,         setRawTotal]         = useState(0)
const [searching,        setSearching]        = useState(false)
const [searched,         setSearched]         = useState(false)
const [aiMode,           setAiMode]           = useState(false)
const [aiInterpretation, setAiInterpretation] = useState<string | null>(null)
const [reranked,         setReranked]         = useState(false)
const [expanded,         setExpanded]         = useState<number | null>(null)   // index of currently-expanded result
```

### Layout (flex column with pinned header)

```
┌────────────────────────────────────────┐
│ Search bar (flex-shrink:0, pinned)    │
│ AI interpretation banner (optional)   │
│ Searching spinner (when in flight)    │
├────────────────────────────────────────┤
│ Results — flex:1, scrolls internally  │
│ ┌─ Result card                       │
│ │  comment text (up to 600 chars)    │
│ │  · location · author · ★ rating    │
│ │  · relevance: NN%  (when reranked) │
│ │  ┌─ expanded: full row fields ───┐│
│ └─                                  └│
└────────────────────────────────────────┘
```

The outer modal (provided by `DatasetHeader`) gives the panel `height: 100%; max-height: 85vh` so the search bar stays anchored while the results scroll independently.

### Comment-text detection

Many dataset row schemas don't have an obvious "comment" column. The panel chooses the best string field via:

```typescript
const COMMENT_FIELD_PATTERNS = [
  /^review_text$/i, /^comment_text$/i, /^body$/i, /^message$/i, /^content$/i,
  /^text$/i, /^comment$/i, /^response$/i, /^answer$/i, /^feedback$/i,
  /comment/i, /text$/i, /response/i,
]
const NON_COMMENT_FIELDS = /^(_|location|address|place_id|review_id|review_date|author|rating|likes|city|state|country|name|title|url|id$|created|updated|date)/i
```

Order:
1. If `openEndedField` prop is set and present in the row, use it.
2. Walk patterns; return first key whose name matches a comment pattern AND doesn't match `NON_COMMENT_FIELDS`, with value > 20 chars.
3. Fallback: the longest non-metadata string field.
4. Worst case: stringified JSON, truncated to 200 chars.

This was added because Google Reviews rows had `location` (the venue name) as the first long string, so the previous "first long string" heuristic showed restaurant names as the comment text.

### Re-rank score display

When `reranked === true` and a row has a `rank` between 0 and 1, the metadata strip shows `relevance: 60%` etc. Without re-ranking, the strip omits the score (every row has rank=1 so the percent would be misleading).

### Highlight

The route returns no highlight markup (the `headline` field from the RPC is computed but not currently surfaced — a future enhancement). The panel itself doesn't currently render `<mark>` tags on the comment text. Adding highlighting would mean either rendering `headline` directly or running a client-side regex over the matched terms.

---

## 5. Dataset-header search modal — `app/analyze/[datasetId]/DatasetHeader.tsx`

The search button lives in the header bar (left zone, after Filters and Ask Ana). Clicking sets `setShowSearch(true)`.

### Modal mount

```jsx
{showSearch && (
  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 2000,
                display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
                padding: '80px 16px 24px' }}
       onClick={function() { setShowSearch(false) }}>
    <div style={{ width: '100%', maxWidth: 700, height: '100%', maxHeight: '85vh',
                  display: 'flex', flexDirection: 'column' }}
         onClick={function(e) { e.stopPropagation() }}>
      <SearchPanel datasetId={dataset.id} />
    </div>
  </div>
)}
```

- Click backdrop to close (event bubbles, modal child stops propagation).
- 80px top padding clears the fixed nav.
- Modal width capped at 700px; height fills viewport up to 85vh.
- Modal is a flex column so SearchPanel can pin its search bar at the top via its own `flex-shrink: 0` rules.

There's no intermediate "search modes" UI — the AI checkbox is inside SearchPanel itself.

---

## 6. AI Integration & Usage Logging

Every AI call passes the standard `usage:` context so the spend shows up in `/admin/usage`:

| Call | `event_type` | tier | maxTokens | timeoutMs |
|---|---|---|---|---|
| Query expansion | `search` | `fast` | 100 | 5000 |
| Re-rank scorer | `search_rerank` | `fast` | 1500 | 20000 |

Both pass `resource_type: 'dataset'`, `resource_id: datasetId`, `org_id`. See `USAGE_ACCOUNTING.md` § 4 for how the dispatcher resolves models and parses token counts.

---

## 7. Performance Notes

- The GIN index on `tsv` makes `.textSearch` and the RPC O(log N) on the matched-row count.
- The trigger `BEFORE UPDATE OF data` is keyed on the `data` column specifically — updating `row_index` or `dataset_id` doesn't recompute the tsv.
- `search_dataset_rows()` with `LIMIT 100` is sub-50ms even on 100K-row datasets in our testing.
- The re-ranker's 20s timeout is conservative — typical re-rank of 100 candidates is ~3-5s with Haiku.
- For non-AI search, total round-trip is dominated by the Postgres query (≤100ms typically). For AI search, total is ~5-8s end-to-end (5s expansion + 3-5s re-rank + Postgres).

---

## 8. Cross-References

- **`callAI` (`lib/ai.ts`)** — the dispatcher used for both AI calls. See `USAGE_ACCOUNTING.md` for provider resolution and auto-logging.
- **Collections** — defined in `sql/021_collections.sql` (out of scope for this spec). The route handles them transparently by resolving to member datasets.
- **OpinionPopover** (`components/analyze/textmine/OpinionPopover.tsx`) — *not* search; it's a separate per-noun cluster view. Mentioned only because it lives nearby in the codebase.
- **Sentiment / negation** — handled in `lib/contentGuard.ts` (AFINN with negation flipping) and `lib/themeUtils.ts` (per-theme aggregate). Search itself does pure FTS — no sentiment interpretation, no negation handling. A query like "not bad food" runs `websearch_to_tsquery('english', 'not bad food')` which Postgres treats as `!bad & food` (the `!` becomes a NOT operator).

---

## 9. Build Checklist (Rebuilding from Scratch)

1. Apply `sql/031_dataset_search.sql` — adds `tsv` column + GIN index + `drf_tsv_trigger` + `search_dataset_rows` RPC + backfill.
2. Verify backfill worked: `SELECT count(*) FROM dataset_rows_flat WHERE tsv IS NULL` → should be 0. If non-zero, `UPDATE dataset_rows_flat SET data = data WHERE tsv IS NULL` to fire the trigger.
3. Build `/api/datasets/[datasetId]/search/route.ts` per § 3 — auth check, target resolution, optional expansion, RPC-with-fallback, optional re-rank, response.
4. Build `SearchPanel.tsx` per § 4 — `useState` shape, comment-field detection, result rendering.
5. Mount the modal in `DatasetHeader.tsx` per § 5.
6. Wire the AI tiers + usage logging via `lib/ai.ts` + `lib/usageLog.ts`.
7. Test the full pipeline:
   - Plain query on a small dataset → see results.
   - AI Search on a multi-concern query → expansion banner shows + relevance pills appear.
   - Search a collection → results from multiple member datasets, each tagged with `_collection_label`.
   - Edge: empty query, query matching nothing, query matching everything (should still cap at limit).
