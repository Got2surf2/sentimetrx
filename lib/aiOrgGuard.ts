// lib/aiOrgGuard.ts
// Single-tenant assertion for the material that goes into a Claude prompt
// (SECURITY.md open item 7). The route gate proves the caller may see ONE
// resource; the guard proves the ROW SET assembled from it — which for a
// collection fans out to many member datasets — belongs to exactly that org
// before any of it is sent to a vendor. It is the last line against the
// pattern behind every CRITICAL finding to date: a service-role query that
// widened past its org.
//
// Pure module (the dataset checker takes the client as an argument) so it is
// unit-testable against tests/helpers/fakeSupabase. Error messages carry
// counts and ids, never row content.

export class CrossOrgPromptError extends Error {
  readonly status = 500
  constructor(readonly where: string, detail: string) {
    super(`${where}: refused to build a prompt from mixed-org data — ${detail}`)
    this.name = 'CrossOrgPromptError'
  }
}

type OrgRow = { org_id?: string | null }

/** Rows that carry org_id (responses, conversations, studies…): every row must
 *  be attributed to `expectedOrgId`. A row with no org_id is unattributable
 *  and is refused too — provenance has to be positive. Returns the rows so it
 *  can sit inline: `const rows = assertSingleOrg(await load(), orgId, where)`. */
export function assertSingleOrg<T extends OrgRow>(rows: readonly T[], expectedOrgId: string, where: string): T[] {
  let unattributed = 0
  const foreign = new Set<string>()
  for (const r of rows) {
    const o = r.org_id
    if (o == null || o === '') unattributed++
    else if (o !== expectedOrgId) foreign.add(o)
  }
  if (unattributed || foreign.size) {
    throw new CrossOrgPromptError(where,
      `${rows.length} rows: ${unattributed} without org_id, ${foreign.size} foreign org(s) [${[...foreign].join(', ')}] vs expected ${expectedOrgId}`)
  }
  return rows as T[]
}

/** Structural slice of a Supabase client (real or tests/helpers/fakeSupabase).
 *  `from` is typed unknown and cast below: postgrest-js's typed `select` parses
 *  column strings at the type level, which turns a structural comparison into a
 *  TS2589 for every caller. */
export interface DatasetsClient { from(table: string): unknown }
interface DatasetsQuery {
  select(cols: string): { in(col: string, ids: string[]): PromiseLike<{ data: unknown; error: { message: string } | null }> }
}

/** dataset_rows_flat rows carry no org_id — they inherit it from their dataset.
 *  For a prompt built across several datasets (a collection fan-out), check the
 *  DATASETS: any that exists must belong to `expectedOrgId`. An id with no
 *  datasets row (a stale collection member) contributes no rows and is left to
 *  the caller's own skip logic — the leak is a FOREIGN dataset, not a missing
 *  one. One indexed `in()` query, however many rows follow. */
export async function assertDatasetsBelongToOrg(
  service: DatasetsClient,
  datasetIds: readonly string[],
  expectedOrgId: string,
  where: string,
): Promise<void> {
  const ids = [...new Set(datasetIds)]
  if (ids.length === 0) return
  const { data, error } = await (service.from('datasets') as DatasetsQuery).select('id, org_id').in('id', ids)
  if (error) throw new CrossOrgPromptError(where, `could not verify dataset ownership (${error.message})`)
  const rows = (data as Array<{ id: string; org_id: string | null }> | null) ?? []
  const foreign = rows.filter(r => r.org_id !== expectedOrgId).map(r => r.id)
  if (foreign.length) {
    throw new CrossOrgPromptError(where,
      `${ids.length} dataset(s): ${foreign.length} outside org ${expectedOrgId} [${foreign.join(', ')}]`)
  }
}
