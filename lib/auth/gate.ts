// lib/auth/gate.ts
// THE resource-access gate for service-role route handlers (SECURITY.md open
// item 11). Nine parallel `gate*` functions had grown across app/api — each
// re-deriving the caller's org + admin flag and re-implementing "does this
// resource belong to the caller's org, or is the caller a platform admin".
// Same rule, five different denial shapes (403 vs 404, four messages). This is
// the single implementation; a route keeps at most a thin adapter around it.
//
// Policy (lib/auth/orgAccess.ts, SECURITY.md §3): a cross-org hit gets the
// SAME 404 + message as "does not exist", so a non-admin cannot probe for a
// resource's existence. Platform admins (organizations.is_admin_org) cross
// orgs. No org on the caller → 401.
//
// Every lookup pairs the id with the columns it needs and nothing else; the
// service-role client is used for both the caller and the resource, so the
// gate does not depend on the caller's RLS view of `users`.
import 'server-only'
import { NextResponse } from 'next/server'

/** The slice of a Supabase client the gate needs — structural, so the real
 *  service-role client and tests/helpers/fakeSupabase both satisfy it without
 *  dragging the full generic client type through every call site. */
export interface GateClient { from(table: string): unknown }
type Service = GateClient
// postgrest-js parses the column string at the TYPE level inside `select`, so a
// structural interface that names `select` makes tsc walk that machinery for
// every caller (TS2589). Typing `from` as unknown and casting to this local
// shape keeps the check trivial and the module fake-friendly.
interface GateQuery {
  select(cols: string): { eq(col: string, val: string): { maybeSingle(): PromiseLike<{ data: unknown }> } }
}
const q = (service: Service, table: string): GateQuery => service.from(table) as GateQuery

export type GateResourceType =
  | 'agent'            // agents.id
  | 'dataset'          // datasets.id
  | 'collection'       // collections.id
  | 'study'            // studies.id
  | 'campaign'         // campaigns.id
  | 'pulseiq_session'  // pulseiq_sessions.id, or its slug
  | 'conversation'     // an agent id (agent conversations) OR a survey response id

export const NOT_AVAILABLE = "This resource isn't available to your account."

export interface CallerOrg { orgId: string | null; isAdmin: boolean }
export type GateOk = { ok: true; targetOrgId: string; userOrgId: string | null; isAdmin: boolean }
export type GateDenied = { ok: false; status: 401 | 404; error: string }
export type GateResult = GateOk | GateDenied

type OrgIdRow = { org_id?: string | null }

const TABLE: Record<Exclude<GateResourceType, 'conversation' | 'pulseiq_session'>, string> = {
  agent: 'agents',
  dataset: 'datasets',
  collection: 'collections',
  study: 'studies',
  campaign: 'campaigns',
}

/** The caller's org + platform-admin flag, by user id (service-role flavor of
 *  getCallerOrgContext). Two indexed point reads; no embedded relation, so the
 *  result shape is the same on every client and in the test fake. */
export async function resolveCallerOrg(service: Service, userId: string): Promise<CallerOrg> {
  const { data: u } = await q(service, 'users').select('org_id').eq('id', userId).maybeSingle()
  const orgId = (u as OrgIdRow | null)?.org_id ?? null
  if (!orgId) return { orgId: null, isAdmin: false }
  const { data: o } = await q(service, 'organizations').select('is_admin_org').eq('id', orgId).maybeSingle()
  return { orgId, isAdmin: (o as { is_admin_org?: boolean | null } | null)?.is_admin_org === true }
}

/** Which org owns this resource — null when it does not exist. */
export async function resolveResourceOrgId(service: Service, type: GateResourceType, id: string): Promise<string | null> {
  if (type === 'pulseiq_session') {
    // By id first, then by slug. A slug against the uuid column comes back as a
    // cast error (data null), never a throw, so no shape pre-check is needed.
    const { data: byId } = await q(service, 'pulseiq_sessions').select('org_id').eq('id', id).maybeSingle()
    const org = (byId as OrgIdRow | null)?.org_id
    if (org) return org
    const { data } = await q(service, 'pulseiq_sessions').select('org_id').eq('slug', id.toLowerCase()).maybeSingle()
    return (data as OrgIdRow | null)?.org_id ?? null
  }
  if (type === 'conversation') {
    const { data: bot } = await q(service, 'agents').select('org_id').eq('id', id).maybeSingle()
    const botOrg = (bot as OrgIdRow | null)?.org_id
    if (botOrg) return botOrg
    const { data: resp } = await q(service, 'responses').select('study_id').eq('id', id).maybeSingle()
    const studyId = (resp as { study_id?: string | null } | null)?.study_id
    if (!studyId) return null
    const { data: study } = await q(service, 'studies').select('org_id').eq('id', studyId).maybeSingle()
    return (study as OrgIdRow | null)?.org_id ?? null
  }
  const { data } = await q(service, TABLE[type]).select('org_id').eq('id', id).maybeSingle()
  return (data as OrgIdRow | null)?.org_id ?? null
}

/** Gate with an already-resolved caller (routes that ran getCallerOrgContext). */
export async function gateResourceAccess(
  service: Service,
  caller: CallerOrg,
  type: GateResourceType,
  id: string,
): Promise<GateResult> {
  if (!caller.orgId) return { ok: false, status: 401, error: 'Unauthorized' }
  const targetOrgId = await resolveResourceOrgId(service, type, id)
  if (!targetOrgId) return { ok: false, status: 404, error: NOT_AVAILABLE }
  if (!caller.isAdmin && targetOrgId !== caller.orgId) return { ok: false, status: 404, error: NOT_AVAILABLE }
  return { ok: true, targetOrgId, userOrgId: caller.orgId, isAdmin: caller.isAdmin }
}

/** Gate by user id (routes that only have the authenticated user). */
export async function gateResourceForUser(
  service: Service,
  userId: string,
  type: GateResourceType,
  id: string,
): Promise<GateResult> {
  return gateResourceAccess(service, await resolveCallerOrg(service, userId), type, id)
}

/** The denial as a route response — one shape everywhere. */
export function gateDenied(d: GateDenied): NextResponse {
  return NextResponse.json({ error: d.error }, { status: d.status })
}
