# Dev Log — 2026-W20 (May 11–17, 2026)

Editorial log of what got worked on this week and **why**. Companion to the weekly governance audit. Append-only — entries reflect intent at time of writing, not later edits.

## 2026-05-11 (Mon) — Wire invite emails through Resend with branded HTML

- **Invite flow now actually sends an email.** Why: discovered while debugging "email invites aren't getting through" — `/api/invite` had never sent email; it generated a token + link and required the inviting admin to copy/paste it manually. Most users (correctly) assumed the system would auto-send and never delivered the link. Fixed by adding a Resend send to the POST handler using a new branded HTML template (`lib/email/inviteTemplate.ts`) with the orange/teal palette and "Sentimetrx is a Datanautix product" footer. From address: `Datanautix <invites@datanautix.com>` (parent-brand framing, since this is a transactional/onboarding email — distinct from `campaigns@sentimetrx.ai` which sends survey campaigns). Reply-to is the inviter's email so a confused recipient gets to a real person. Email send failure is non-fatal: the invite row still exists and the UI surfaces a "copy link manually" fallback flash — invites stay reliable even if Resend has an outage or the from-domain isn't verified yet. Pending: verify `datanautix.com` in Resend (SPF/DKIM/DMARC) before this can deliver in production.
