# Dev Log — 2026-W20 (May 11–17, 2026)

Editorial log of what got worked on this week and **why**. Companion to the weekly governance audit. Append-only — entries reflect intent at time of writing, not later edits.

## 2026-05-11 (Mon, later) — Streamline the invite-acceptance flow end-to-end

- **Six fixes to the team-invite UX in one pass.** Why: walked the flow end to end after wiring up the email send and found the post-click experience was still kludgy. Symptoms were each minor on their own but compounded into a "this looks half-built" first impression for any new teammate.
  1. **Auto-login after accept.** The user just typed their password — making them re-enter it on `/login` was the worst step in the funnel. Acceptance page now calls `supabase.auth.signInWithPassword` after `/api/invite/register` succeeds and redirects straight to `/analyze`. Falls back to `/login?error=...` if auto-sign-in fails so the account isn't stranded.
  2. **Warm theme on `/invite/[token]`.** Was dark slate-950 + cyan; rest of the auth surface is cream gradient + orange/teal + concentric-rings logo. Visual whiplash gone.
  3. **Email field locked.** Was editable but typing a different email returned a 403 with "This invite was issued to a different email address" — looked like a bug. Now `readOnly` with a "locked to this invitation" hint label.
  4. **Org name + role visible.** Was always falling back to "Sentimetrx" because the org row was never joined in `GET /api/invite`. Added `organizations(name)` join and a "You've been invited to join **{Org}** as **{Role}**" header.
  5. **Resend invite button** — `POST /api/invite/[id]/resend` re-runs the same `sendInviteEmail` helper used by the original create. Lets admins recover from typos / spam folder / lost emails without revoke + recreate.
  6. **Revoke invite button** — `DELETE /api/invite/[id]` removes the invite row. Confirms first; immediately drops it from the pending list.
- **Auth bug fixed as part of #5/#6.** The original `POST /api/invite` only allowed callers whose org has `is_admin_org=true` (super-admins) — regular org owners got a 403 even though the team-invite UI is shown to them. New auth check: super-admin OR `users.role === 'owner' && users.org_id === target_org_id`. Same check on the new resend/revoke endpoints. The owner-can-invite path was effectively dead code before today; now it works.
- **Shared helper.** Extracted the email-build + Resend-send logic to `lib/email/sendInvite.ts` so create and resend can't drift.

## 2026-05-11 (Mon) — Wire invite emails through Resend with branded HTML

- **Invite flow now actually sends an email.** Why: discovered while debugging "email invites aren't getting through" — `/api/invite` had never sent email; it generated a token + link and required the inviting admin to copy/paste it manually. Most users (correctly) assumed the system would auto-send and never delivered the link. Fixed by adding a Resend send to the POST handler using a new branded HTML template (`lib/email/inviteTemplate.ts`) with the orange/teal palette and "Sentimetrx is a Datanautix product" footer. From address: `Sentimetrx <invites@sentimetrx.ai>` (the same verified Resend domain `campaigns@sentimetrx.ai` already uses — switched from an initial `invites@datanautix.com` plan to avoid the $20/mo cost of adding a second sending domain). Reply-to is the inviter's email so a confused recipient gets to a real person. Email send failure is non-fatal: the invite row still exists and the UI surfaces a "copy link manually" fallback flash — invites stay reliable even if Resend has an outage. Footer still reads "Sentimetrx is a Datanautix product" so the parent-brand framing is preserved without paying for a second domain.
