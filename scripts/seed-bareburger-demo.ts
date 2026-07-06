/**
 * Seed the Bareburger demo conversational survey.
 *
 *   npx tsx scripts/seed-bareburger-demo.ts            → TEST project (default; view via `npm run dev`)
 *   npx tsx scripts/seed-bareburger-demo.ts --prod     → PRODUCTION db (only when explicitly asked)
 *   npx tsx scripts/seed-bareburger-demo.ts --org <id> → attach to a specific org (else first org)
 *
 * Upserts by slug 'bareburger' so it's safe to re-run after tweaking the config.
 * Public URL once seeded + status=active:  /s/bareburger
 *
 * Design (per owner brief):
 *  - 5-star experience rating (NPS off).
 *  - Per-score follow-up (experienceFollowUp, mode 'per-response'):
 *      1–3 probe what went wrong; 4 & 5 ask a "what can we improve" question.
 *  - AI clarifier fires on thin answers (useAIClarify:true) — the /api/clarify pass.
 *  - Bareburger-tailored psychographics (organic / plant-based / sustainability lean).
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { StudyConfig } from '@/lib/types'

function envLocal(name: string): string | null {
  const strip = (v: string) => v.trim().replace(/^["']|["']$/g, '')
  if (process.env[name]) return strip(process.env[name]!)
  try {
    const line = readFileSync('.env.local', 'utf8').split('\n').find(l => l.startsWith(name + '='))
    return line ? strip(line.slice(name.length + 1)) : null
  } catch { return null }
}

const config: StudyConfig = {
  greeting:
    "Hey there! 🍔 Thanks for stopping by Bareburger. Mind sharing how your visit went? It takes about a minute — and it helps us keep the food honest and the experience great.",
  brandTag: 'Bareburger',
  headerSubtitle: 'Guest experience survey',
  headerStatus: 'Ready for your feedback',

  // ── 5-star experience rating (NPS off) ──────────────────────────────
  npsEnabled: false,
  experienceEnabled: true,
  ratingType: 'experience',
  experienceRatingLabel: 'Overall Experience',
  ratingPrompt: 'How would you rate your overall experience at Bareburger today?',
  ratingScale: [
    { score: 1, emoji: '😞', label: 'Poor' },
    { score: 2, emoji: '😕', label: 'Fair' },
    { score: 3, emoji: '😐', label: 'Okay' },
    { score: 4, emoji: '😊', label: 'Great' },
    { score: 5, emoji: '🤩', label: 'Amazing' },
  ],
  openingFlow: [{ id: 'experience_rating', type: 'experience_rating' }],

  // ── Appropriate follow-up by score ──────────────────────────────────
  // 1–3: probe what fell short. 4 & 5: "what can we improve" (per brief).
  // useAI on each; the AI clarifier (/api/clarify) fires on thin answers.
  experienceFollowUp: {
    enabled: true,
    mode: 'per-response',
    exportLabel: 'Experience Follow-up',
    sharedPrompt: '',
    shareClarify: false,
    shareAI: false,
    perResponse: {
      '1': { prompt: "I'm really sorry today missed the mark. What was the main thing that went wrong?", clarify: true, useAI: true },
      '2': { prompt: "Thanks for being honest — that helps us fix things. What let you down most today?", clarify: true, useAI: true },
      '3': { prompt: "Appreciate the candor. What's the one thing that would've made today's visit better?", clarify: true, useAI: true },
      '4': { prompt: "Glad you enjoyed it! What's one thing we could improve to make your next visit even better?", clarify: true, useAI: true },
      '5': { prompt: "Amazing — that's what we love to hear! 🎉 Even on a great day, is there anything, big or small, we could still improve?", clarify: true, useAI: true },
    },
  },

  // AI clarifier on
  useAIClarify: true,
  maxClarifierCount: 2,
  clarifiers: {
    default: 'Could you tell me a bit more about that?',
    burger: 'Was that about the patty, the toppings, the bun, or how it was cooked?',
    food: 'Was that about the taste, the ingredients, portion size, or how it was cooked?',
    service: 'Which part of the service — ordering, the staff, or how quickly your food came out?',
    wait: 'Was the wait at the counter, for a table, or for your food to arrive?',
    price: 'Was that about the price of a specific item, or the overall value?',
    vegan: 'Which plant-based or dietary option are you referring to?',
    clean: 'Was that about the dining area, the tables, or the restrooms?',
  },

  // Legacy general open-ends off — the per-score follow-up carries the open-end
  q3: '',
  q3Enabled: false,
  q4: '',
  q4Enabled: false,

  // ── Psychographics (Bareburger-tailored: organic / plant-based / sourcing) ──
  psychoCount: 3,
  psychographicBank: [
    { key: 'bb_food_values', exportLabel: 'Food Values', q: 'When choosing where to eat, which of these matters most to you?',
      opts: ['Organic and all-natural ingredients', 'Great taste above all', 'Good value for money', 'Speed and convenience', 'Variety and menu options'] },
    { key: 'bb_diet_identity', exportLabel: 'Diet Identity', q: 'Which best describes how you eat?',
      opts: ['Omnivore — I eat everything', 'Flexitarian — cutting back on meat', 'Vegetarian', 'Vegan / plant-based', 'Gluten-free or another dietary need'] },
    { key: 'bb_sustainability', exportLabel: 'Sustainability Attitude', q: 'How much does sustainability and sourcing influence where you eat?',
      opts: ['A lot — I seek out responsibly-sourced food', "Somewhat — it's a nice bonus", "A little — I notice but it rarely decides", 'Not really — taste and price come first'] },
    { key: 'bb_health_conscious', exportLabel: 'Health Consciousness', q: 'How health-conscious are you when eating out?',
      opts: ['Very — I always look for the healthier option', 'Fairly — I balance treat and health', "A little — I notice but don't let it decide", 'Not much — I order what I crave'] },
    { key: 'bb_visit_driver', exportLabel: 'Visit Driver', q: 'What mainly brought you to Bareburger today?',
      opts: ['A better-for-you burger fix', 'Plant-based / dietary-friendly options', 'Meeting friends or family', 'A quick bite nearby', "Trying it for the first time"] },
    { key: 'bb_discovery', exportLabel: 'Discovery Channel', q: 'How did you first discover Bareburger?',
      opts: ['Walked past a location', 'Friend or family recommendation', 'Social media', 'A delivery app', 'Online search or reviews'] },
    { key: 'bb_loyalty', exportLabel: 'Visit Frequency', q: 'How often do you eat at Bareburger?',
      opts: ["It's a regular go-to", 'Every few weeks', 'Once in a while', 'First visit today'] },
    { key: 'bb_order_mode', exportLabel: 'Order Mode', q: 'How did you order today?',
      opts: ['Dine-in at the counter or table', 'Takeout', 'Mobile / online order', 'A delivery app'] },
  ],

  industry: 'casual_dining',

  // ── Closing ─────────────────────────────────────────────────────────
  closingMessage: 'Thanks so much for sharing — it genuinely helps us do better. Enjoy the rest of your day! 🌱',
  closingCard: 'Your feedback has been saved. Thanks for helping us keep it fresh.',

  // ── Theme (Bareburger green / earthy) ───────────────────────────────
  theme: {
    primaryColor: '#5b8c3e',
    headerGradient: 'linear-gradient(135deg, #6cb33f, #3f6b28)',
    backgroundColor: '#101a0c',
    accentColor: '#8fd14f',
    botAvatarGradient: 'linear-gradient(135deg, #6cb33f, #3f6b28)',
  },
}

async function main() {
  const args = process.argv.slice(2)
  const useProd = args.includes('--prod')
  const orgFlagIdx = args.indexOf('--org')
  const explicitOrg = orgFlagIdx >= 0 ? args[orgFlagIdx + 1] : null

  const url = useProd ? envLocal('NEXT_PUBLIC_SUPABASE_URL') : envLocal('SUPABASE_TEST_URL')
  const key = useProd ? envLocal('SUPABASE_SERVICE_ROLE_KEY') : envLocal('SUPABASE_TEST_SERVICE_ROLE_KEY')
  if (!url || !key) { console.error(`Missing Supabase creds for ${useProd ? 'PROD' : 'TEST'} in .env.local`); process.exit(1) }
  if (!useProd) {
    const prodUrl = envLocal('NEXT_PUBLIC_SUPABASE_URL')
    if (prodUrl && prodUrl === url) { console.error('Refusing: SUPABASE_TEST_URL equals the prod URL.'); process.exit(1) }
  }

  const db = createClient(url, key, { auth: { persistSession: false } })
  console.log(`▶ Seeding Bareburger demo → ${useProd ? '⚠️  PRODUCTION' : 'TEST'} (${url.replace(/^https:\/\//, '').replace(/\.supabase\.co.*/, '')})`)

  // Resolve org
  let orgId = explicitOrg
  if (!orgId) {
    const { data: orgs, error } = await db.from('organizations').select('id, name').order('created_at', { ascending: true }).limit(1)
    if (error || !orgs?.length) { console.error('No organization found to attach the study to:', error?.message); process.exit(1) }
    orgId = orgs[0].id
    console.log(`  org: ${orgs[0].name} (${orgId})`)
  }

  // Upsert by slug
  const { data: existing } = await db.from('studies').select('id, guid').eq('slug', 'bareburger').maybeSingle()
  const row = {
    name: 'Bareburger — Guest Experience',
    bot_name: 'Bareburger',
    bot_emoji: '🍔',
    status: 'active',
    slug: 'bareburger',
    org_id: orgId,
    config,
  }

  if (existing) {
    const { error } = await db.from('studies').update(row).eq('id', existing.id)
    if (error) { console.error('Update failed:', error.message); process.exit(1) }
    console.log(`✓ Updated existing study  guid=${existing.guid}`)
    console.log(`  URL: /s/bareburger   (or /s/${existing.guid})`)
  } else {
    const guid = randomUUID()
    const { error } = await db.from('studies').insert({ guid, ...row })
    if (error) { console.error('Insert failed:', error.message); process.exit(1) }
    console.log(`✓ Created study  guid=${guid}`)
    console.log(`  URL: /s/bareburger   (or /s/${guid})`)
  }
}

main()
