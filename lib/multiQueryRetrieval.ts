// lib/multiQueryRetrieval.ts
// AGENT_TIERS Phase 2 — multi-query retrieval for Super Agents.
//
// A single query embedding misses knowledge phrased differently from how the
// user asked. Super agents retrieve for BOTH the raw question and one Haiku
// rewrite, then union the result sets here: dedup by chunk id (keeping the
// higher-confidence hit), re-rank by confidence, and take the top-K. Pure +
// generic so it unit-tests without the chatCore dependency graph.

export function mergeRankedChunks<T extends { id?: string | null; confidence?: number | null }>(
  sets: (T[] | null | undefined)[],
  limit: number,
): T[] {
  const byId = new Map<string, T>()
  const noId: T[] = []
  for (const set of sets) {
    if (!set) continue
    for (const c of set) {
      const id = c.id
      if (id == null) { noId.push(c); continue }
      const prev = byId.get(id)
      if (!prev || (c.confidence ?? 0) > (prev.confidence ?? 0)) byId.set(id, c)
    }
  }
  const merged = [...byId.values(), ...noId]
  // Stable-ish: sort by confidence desc; equal confidences keep insertion order.
  merged.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
  return limit > 0 ? merged.slice(0, limit) : merged
}
