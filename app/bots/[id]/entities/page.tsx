// app/bots/[id]/entities/page.tsx
// Entity catalog — bot-scoped entity_catalog browser + extract trigger.
// Server wrapper handles auth + bot lookup + org gate; EntitiesClient
// renders the UI. See docs/BOTS.md § 9.y.4.

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import { slugify } from '@/lib/entityFilter'
import EntitiesClient from './EntitiesClient'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

interface AgentRow {
  id: string
  name: string
  slug: string
  org_id: string
  brand_tag: string | null
}

export default async function BotEntitiesPage(props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, full_name, organizations(is_admin_org, logo_url, name, features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations)
  const isAdmin = !!orgData?.is_admin_org

  const service = createServiceRoleClient()
  // Service-role lookup pairs id with org_id for non-admins (multi-tenancy
  // invariant); admins may load any org's agent.
  let agentQuery = service.from('agents').select('id, name, slug, org_id, brand_tag').eq('id', params.id)
  if (!isAdmin && userData?.org_id) agentQuery = agentQuery.eq('org_id', userData.org_id)
  const { data: bot } = await agentQuery.single() as { data: AgentRow | null }
  if (!bot) redirect('/bots')
  if (!isAdmin && bot.org_id !== userData?.org_id) redirect('/bots')

  // Resolve the brand collection (if this agent is brand-tagged) so the editor
  // can link to the shared brand-glossary editor (Phase 5).
  let brandCollectionId: string | null = null
  const brandTag = String(bot.brand_tag ?? '').trim()
  if (brandTag) {
    const { data: col } = await service
      .from('collections').select('id')
      .eq('org_id', bot.org_id).eq('kind', 'brand').eq('slug', slugify(brandTag))
      .maybeSingle() as { data: { id: string } | null }
    brandCollectionId = col?.id ?? null
  }

  return (
    <EntitiesClient
      botId={params.id}
      botName={bot.name}
      botSlug={bot.slug}
      brandTag={bot.brand_tag ?? null}
      brandCollectionId={brandCollectionId}
      logoUrl={orgData?.logo_url}
      orgName={orgData?.name}
      isAdmin={isAdmin}
      userEmail={user.email!}
      fullName={userData?.full_name || undefined}
      features={orgData?.features}
    />
  )
}
