# Campaign Manager — Promotion Checklist (Staging → Production)

**Built:** 2026-04-09 on `sentimetrx-staging`  
**Phase:** 1 (core CRUD, respondent upload, email templates, manual send)

---

## 1. Database Migration

Run `sql/008_campaigns.sql` in the **production** Supabase SQL Editor.

Creates:
- `campaigns` table
- `campaign_respondents` table
- `campaign_emails` table
- `campaign_send_log` table
- `campaign_schedules` table
- `current_org_id()` helper function
- `campaign_unsubscribe()` function
- RLS policies for all 5 tables
- Performance indexes

**Pre-requisite:** The `touch_updated_at()` trigger function must already exist (from `001_schema.sql`).

---

## 2. New Files to Copy

### API Routes
```
app/api/campaigns/route.ts                        — List/create campaigns
app/api/campaigns/[id]/route.ts                    — Get/update/delete campaign
app/api/campaigns/[id]/respondents/route.ts        — List/upload respondents
app/api/campaigns/[id]/emails/route.ts             — CRUD email templates
app/api/campaigns/[id]/send/route.ts               — Send campaign emails
app/api/campaigns/[id]/test-send/route.ts          — Send test email
app/api/campaigns/[id]/stats/route.ts              — Campaign analytics
app/api/campaigns/unsubscribe/[token]/route.ts     — Public unsubscribe
```

### Pages
```
app/campaigns/page.tsx                             — Campaign dashboard (server)
app/campaigns/CampaignDashboardClient.tsx           — Campaign dashboard (client)
app/campaigns/[id]/page.tsx                        — Campaign detail (server)
app/campaigns/[id]/CampaignDetailClient.tsx         — Campaign detail (client)
app/studies/[id]/campaigns/page.tsx                — Study-scoped campaign list
app/studies/[id]/campaigns/new/page.tsx             — New campaign (server)
app/studies/[id]/campaigns/new/NewCampaignClient.tsx — New campaign form (client)
```

### Library
```
lib/email/provider.ts                              — Email provider abstraction
```

### SQL
```
sql/008_campaigns.sql                              — Database migration
```

---

## 3. Modified Files (apply diffs)

| File | Change |
|------|--------|
| `lib/types.ts` | Added `campaigns` to `OrgFeatures`, added `EmailProviderType`, `CampaignStatus`, `RespondentStatus`, `SendTarget`, `Campaign`, `CampaignRespondent`, `CampaignEmail`, `CampaignSendLog`, `CampaignStats` types |
| `components/nav/TopNav.tsx` | Added `campaignsEnabled` prop, added "Campaigns" nav link, added `'campaigns'` to `currentPage` union |
| `app/dashboard/DashboardClient.tsx` | Added `campaignsEnabled` prop, passed to `TopNav` and `StudyCard`, added "Campaigns" button on study cards |
| `app/dashboard/page.tsx` | Passes `campaignsEnabled={!!orgData?.features?.campaigns \|\| isAdmin}` to `DashboardClient` |
| `components/analyze/OrgFeatureToggles.tsx` | Added `campaigns` to features type, added Campaign Manager toggle switch |
| `app/admin/clients/[id]/AdminClientDetail.tsx` | Added `campaigns` to `Org.features` interface |

---

## 4. Environment Variables

No new env vars required for Phase 1 (uses existing `RESEND_API_KEY`).

**Optional for Phase 2+:**
- `SENDGRID_API_KEY` — if orgs want SendGrid
- AWS SES credentials — if orgs want SES
- SMTP credentials — stored per-campaign in `email_config` JSONB

---

## 5. Post-Deployment Steps

1. Run the SQL migration on production Supabase
2. Deploy the code to production Vercel
3. In the admin panel, enable "Campaign Manager" for target organizations
4. Verify by creating a test campaign from a study

---

## 6. Phase 2 Roadmap (not yet built)

- Automated reminder scheduling (cron job / Supabase Edge Function)
- Thank you / incomplete auto-emails triggered on response submission
- Bounce/open/click webhook handlers per provider
- Send window restrictions (time-of-day gating)
- A/B testing for subject lines
- Campaign cloning
- CSV export of campaign results
