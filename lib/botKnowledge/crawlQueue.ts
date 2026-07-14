// lib/botKnowledge/crawlQueue.ts
// P2d — pure queue/cursor math for the resumable super crawl. No network here
// (the route does the fetching); split out so the batch-selection and
// link-merge rules are unit-testable and the checkpoint stays consistent
// across serverless invocations.

export const CRAWL_BATCH_PAGES = 20        // pages fetched per step()
export const CRAWL_TIME_BUDGET_MS = 45000  // step bails at this to stay under maxDuration

/**
 * Pick the next batch to fetch: up to `batchSize` queued URLs not already
 * visited and not exceeding the remaining page budget. Returns the batch and
 * the queue with those URLs removed (still-unvisited leftovers preserved in
 * order).
 */
export function takeBatch(
  queue: string[],
  visited: string[],
  batchSize: number,
  pageCap: number,
  pagesCrawled: number,
): { batch: string[]; rest: string[] } {
  const seen = new Set(visited)
  const room = Math.max(0, pageCap - pagesCrawled)
  const limit = Math.min(batchSize, room)
  const batch: string[] = []
  const rest: string[] = []
  const picked = new Set<string>()
  for (const url of queue) {
    if (batch.length < limit && !seen.has(url) && !picked.has(url)) {
      batch.push(url)
      picked.add(url)
    } else if (!seen.has(url) && !picked.has(url)) {
      rest.push(url)
      picked.add(url)
    }
    // drop already-visited / duplicate queue entries silently
  }
  return { batch, rest }
}

/**
 * Merge newly-discovered same-host links into the queue: append those not
 * already visited or queued, capped so the queue never grows unbounded past
 * what the page budget could consume.
 */
export function mergeDiscovered(
  queue: string[],
  visited: string[],
  discovered: string[],
  pageCap: number,
  pagesCrawled: number,
): string[] {
  const known = new Set<string>([...visited, ...queue])
  // Cap total outstanding work at 2× the remaining budget (headroom for dedup).
  const maxQueue = Math.max(0, (pageCap - pagesCrawled) * 2)
  const out = queue.slice()
  for (const url of discovered) {
    if (out.length >= maxQueue) break
    if (!known.has(url)) {
      known.add(url)
      out.push(url)
    }
  }
  return out
}

/** A job is finished when the queue is empty or the page budget is spent. */
export function crawlIsDone(queueLen: number, pagesCrawled: number, pageCap: number): boolean {
  return queueLen === 0 || pagesCrawled >= pageCap
}
