#!/usr/bin/env npx tsx
/**
 * Survey Response Simulator
 *
 * Generates realistic survey responses and submits them to a running SentimetRX instance.
 * Reads the study config to adapt to whatever questions/scales are configured.
 *
 * Usage:
 *   npx tsx prototype/simulate-responses.ts <study_guid> [count] [--base-url=http://localhost:3000]
 *
 * Examples:
 *   npx tsx prototype/simulate-responses.ts abc123              # 10 responses to localhost
 *   npx tsx prototype/simulate-responses.ts abc123 50           # 50 responses
 *   npx tsx prototype/simulate-responses.ts abc123 20 --base-url=https://staging.example.com
 */

// ── Config ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const flags = args.filter(a => a.startsWith('--'))
const positional = args.filter(a => !a.startsWith('--'))

const STUDY_GUID = positional[0]
const COUNT = parseInt(positional[1] || '10', 10)
const BASE_URL = flags.find(f => f.startsWith('--base-url='))?.split('=').slice(1).join('=') || 'http://localhost:3000'

if (!STUDY_GUID) {
  console.error('Usage: npx tsx prototype/simulate-responses.ts <study_guid> [count] [--base-url=URL]')
  process.exit(1)
}

// ── Realistic response data pools ───────────────────────────────────────────

const POSITIVE_FEEDBACK = [
  "Really impressed with the quality of service. The team went above and beyond.",
  "Everything was smooth from start to finish. Would definitely come back.",
  "Love the attention to detail. You can tell people here really care.",
  "Had a fantastic experience — the staff was incredibly helpful and friendly.",
  "One of the best experiences I've had. Keep doing what you're doing!",
  "Very professional and welcoming. Made me feel valued as a customer.",
  "The whole process was seamless. I appreciated how organized everything was.",
  "Great atmosphere and wonderful people. Exceeded my expectations.",
  "I was blown away by how responsive the team was to my needs.",
  "Top-notch service. I've already recommended you to friends.",
  "Your team made a complicated situation feel easy. Thank you!",
  "I'm genuinely impressed. This is exactly how customer service should be.",
  "Such a pleasant surprise. Everything about my visit was outstanding.",
  "The quality keeps getting better. Really happy I chose you.",
  "Couldn't be happier with how everything turned out. Well done.",
]

const NEUTRAL_FEEDBACK = [
  "It was fine overall. Nothing spectacular but nothing bad either.",
  "Decent experience. A few things could be improved but generally okay.",
  "Pretty standard service. Met my expectations but didn't exceed them.",
  "The basics were handled well. Some areas could use a bit more polish.",
  "Not bad. I've had better experiences elsewhere but also much worse.",
  "Average experience. The main thing got done which is what matters.",
  "It was okay. Some staff were great, others seemed disengaged.",
  "Satisfactory but room for improvement in a few areas.",
  "Middle of the road. Nothing to write home about but no complaints.",
  "Got what I needed done. Wouldn't say it was memorable though.",
]

const NEGATIVE_FEEDBACK = [
  "Pretty disappointed with the experience. Felt rushed and overlooked.",
  "The wait times were unacceptable. I almost left before being seen.",
  "Communication was really poor. Nobody seemed to know what was going on.",
  "I expected much better based on what I'd heard. Let down.",
  "Several things went wrong and nobody seemed to care about fixing them.",
  "Frustrating experience. Had to repeat myself multiple times.",
  "The service didn't match the price at all. Felt overcharged.",
  "Things were disorganized and chaotic. Needs serious improvement.",
  "I left feeling worse than when I arrived. Very disappointing.",
  "Not up to standard. I've been coming for years and quality has dropped.",
]

const SUGGESTIONS = [
  "Would be nice to have an online booking system so I don't have to call.",
  "Maybe add more options for evening availability? Hard to fit into work schedules.",
  "A loyalty program or repeat customer discount would go a long way.",
  "The parking situation needs work. It's really stressful finding a spot.",
  "More transparency about pricing upfront would help set expectations.",
  "Consider adding a feedback kiosk on-site so people can share thoughts in real time.",
  "The website could use an update — it's hard to find basic information.",
  "It'd be great to get text message reminders instead of just email.",
  "Cross-training staff so anyone can help with any question would speed things up.",
  "Offer a virtual option for people who can't come in person.",
  "An FAQ section on your website would cut down on a lot of phone calls.",
  "Better signage inside would help first-time visitors navigate.",
  "I think a follow-up call after service would make people feel cared for.",
  "More variety in your offerings would keep regulars engaged.",
  "A mobile app would be really convenient for managing appointments.",
]

const PSYCHO_POOLS: Record<string, string[]> = {
  // Generic catch-all for any psychographic question
  _default: ['Strongly agree', 'Agree', 'Neutral', 'Disagree', 'Strongly disagree',
             'Very likely', 'Likely', 'Unlikely', 'Very unlikely',
             'Always', 'Often', 'Sometimes', 'Rarely', 'Never'],
}

const DEMO_POOLS: Record<string, string[]> = {
  age:        ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'],
  gender:     ['male', 'female', 'nonbinary', 'prefer_not'],
  zip:        ['10001', '90210', '60601', '33101', '98101', '02101', '30301', '78701', '85001', '55401'],
  income:     ['under_25k', '25k_50k', '50k_75k', '75k_100k', '100k_150k', '150k_plus', 'prefer_not'],
  education:  ['high_school', 'some_college', 'associates', 'bachelors', 'masters', 'doctoral', 'prefer_not'],
  ethnicity:  ['white', 'black', 'hispanic', 'asian', 'native', 'pacific', 'multi', 'other', 'prefer_not'],
  employment: ['full_time', 'part_time', 'self_employed', 'student', 'retired', 'unemployed'],
  marital:    ['single', 'married', 'domestic', 'divorced', 'widowed'],
  household:  ['1', '2', '3', '4', '5_plus'],
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }
function weightedScore(weights: number[]): number {
  // weights[i] = relative probability of score (i+1)
  const total = weights.reduce((a, b) => a + b, 0)
  let r = Math.random() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r <= 0) return i + 1
  }
  return weights.length
}

type Sentiment = 'positive' | 'neutral' | 'negative'

function scoreSentiment(score: number, max: number): Sentiment {
  const pct = score / max
  if (pct >= 0.7) return 'positive'
  if (pct >= 0.4) return 'neutral'
  return 'negative'
}

function feedbackForSentiment(s: Sentiment): string {
  if (s === 'positive') return pick(POSITIVE_FEEDBACK)
  if (s === 'negative') return pick(NEGATIVE_FEEDBACK)
  return pick(NEUTRAL_FEEDBACK)
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// ── Main ────────────────────────────────────────────────────────────────────

interface StudyConfig {
  greeting: string
  npsEnabled?: boolean
  npsPrompt?: string
  experienceEnabled?: boolean
  ratingScale?: Array<{ score: number; label: string; emoji: string }>
  ratingPrompt?: string
  q3: string
  q3Enabled?: boolean
  q4: string
  q4Enabled?: boolean
  openingFlow?: Array<{ id: string; type: string; prompt?: string }>
  questions?: Array<{ id: string; type: string; prompt: string; enabled?: boolean; options?: string[]; conversationPosition?: string }>
  psychographicBank?: Array<{ key: string; q: string; opts: string[] }>
  psychoCount?: number
  demographicFields?: Array<{ key: string; type: string; enabled: boolean; options?: string[][] }>
  allowMultipleResponses?: boolean
}

async function fetchStudy(): Promise<{ guid: string; bot_name: string; config: StudyConfig }> {
  const res = await fetch(`${BASE_URL}/api/study/${STUDY_GUID}`)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Failed to fetch study: ${res.status} ${body}`)
  }
  return res.json()
}

function generateResponse(config: StudyConfig): {
  payload: Record<string, unknown>
  duration_sec: number
} {
  const ratingScale = config.ratingScale || [
    { score: 1, label: 'Poor' },
    { score: 2, label: 'Fair' },
    { score: 3, label: 'Average' },
    { score: 4, label: 'Good' },
    { score: 5, label: 'Excellent' },
  ]
  const maxScore = Math.max(...ratingScale.map(r => r.score))

  // Weighted distribution: skew toward positive (realistic for most surveys)
  // Score 1: 5%, 2: 10%, 3: 20%, 4: 35%, 5: 30%
  const npsWeights  = [5, 10, 20, 35, 30]
  const expWeights  = [5, 10, 20, 35, 30]

  const npsScore = weightedScore(npsWeights)
  const npsLabel = ratingScale.find(r => r.score === npsScore)?.label || `Score ${npsScore}`
  const npsSentiment = scoreSentiment(npsScore, maxScore)

  const expScore = weightedScore(expWeights)
  const expOption = ratingScale.find(r => r.score === expScore) || ratingScale[expScore - 1]
  const expLabel = expOption?.label || `Score ${expScore}`
  const expSentiment = scoreSentiment(expScore, maxScore)

  // Use the more extreme sentiment for open-ended content
  const overallSentiment: Sentiment = expSentiment === 'negative' || npsSentiment === 'negative'
    ? 'negative'
    : expSentiment === 'positive' && npsSentiment === 'positive'
      ? 'positive'
      : 'neutral'

  const payload: Record<string, unknown> = {
    agent: 'Simulator',
    timestamp: new Date().toISOString(),
  }

  // NPS
  if (config.npsEnabled !== false) {
    payload.npsRecommend = { score: npsScore, label: npsLabel }
  }

  // Experience rating
  if (config.experienceEnabled !== false) {
    payload.experienceRating = { score: expScore, label: expLabel, sentiment: expSentiment }
  }

  // Open-ended Q3/Q4
  const openEnded: Record<string, string> = {}
  if (config.q3Enabled !== false) {
    openEnded.q3 = feedbackForSentiment(overallSentiment)
  }
  if (config.q4Enabled !== false) {
    openEnded.q4 = pick(SUGGESTIONS)
  }
  // Sometimes add Q1 (follow-up to NPS)
  if (Math.random() < 0.7) {
    openEnded.q1 = feedbackForSentiment(npsSentiment)
  }
  payload.openEnded = openEnded

  // Opening answers (for opening flow items of type 'open_end')
  if (config.openingFlow) {
    const openEndItems = config.openingFlow.filter(f => f.type === 'open_end')
    if (openEndItems.length > 0) {
      const openingAnswers: Record<string, string> = {}
      for (const item of openEndItems) {
        openingAnswers[item.id] = feedbackForSentiment(overallSentiment)
      }
      payload.openingAnswers = openingAnswers
    }
  }

  // Custom questions
  if (config.questions && config.questions.length > 0) {
    const customAnswers: Record<string, string | string[]> = {}
    const enabledQs = config.questions.filter(q => q.enabled !== false && q.type !== 'hidden')

    for (const q of enabledQs) {
      if (q.type === 'open') {
        customAnswers[q.id] = pick([...POSITIVE_FEEDBACK, ...NEUTRAL_FEEDBACK, ...SUGGESTIONS])
      } else if (q.type === 'radio' || q.type === 'dropdown') {
        if (q.options && q.options.length > 0) {
          customAnswers[q.id] = pick(q.options)
        }
      } else if (q.type === 'checkbox') {
        if (q.options && q.options.length > 0) {
          const n = Math.floor(Math.random() * Math.min(3, q.options.length)) + 1
          const shuffled = [...q.options].sort(() => Math.random() - 0.5)
          customAnswers[q.id] = shuffled.slice(0, n)
        }
      } else if (q.type === 'likert' || q.type === 'rating') {
        customAnswers[q.id] = String(weightedScore(expWeights))
      } else if (q.type === 'numeric') {
        customAnswers[q.id] = String(Math.floor(Math.random() * 100) + 1)
      }
    }
    if (Object.keys(customAnswers).length > 0) {
      payload.customAnswers = customAnswers
    }
  }

  // Psychographics
  if (config.psychographicBank && config.psychographicBank.length > 0) {
    const psycho: Record<string, string> = {}
    const count = config.psychoCount || 3
    const pool = [...config.psychographicBank]
    const selected: typeof pool = []
    while (selected.length < count && pool.length > 0) {
      const i = Math.floor(Math.random() * pool.length)
      selected.push(...pool.splice(i, 1))
    }
    for (const q of selected) {
      if (q.opts && q.opts.length > 0) {
        psycho[q.key] = pick(q.opts)
      } else {
        psycho[q.key] = pick(PSYCHO_POOLS._default)
      }
    }
    payload.psychographics = psycho
  }

  // Demographics
  if (config.demographicFields) {
    const demo: Record<string, string> = {}
    const enabled = config.demographicFields.filter(d => d.enabled)
    for (const field of enabled) {
      if (field.options && field.options.length > 0) {
        // options are [value, label] tuples
        demo[field.key] = pick(field.options)[0]
      } else if (DEMO_POOLS[field.key]) {
        demo[field.key] = pick(DEMO_POOLS[field.key])
      } else if (field.type === 'text') {
        demo[field.key] = pick(DEMO_POOLS.zip) // fallback for text fields
      }
    }
    if (Object.keys(demo).length > 0) {
      payload.demographics = demo
    }
  }

  // Realistic duration: 90-600 seconds
  const duration_sec = Math.floor(Math.random() * 510) + 90

  return { payload, duration_sec }
}

async function submitResponse(payload: Record<string, unknown>, duration_sec: number, index: number): Promise<boolean> {
  const session_id = 'sim_' + Math.random().toString(36).slice(2) + Date.now().toString(36)

  const body = {
    study_guid: STUDY_GUID,
    payload,
    duration_sec,
    session_id,
    status: 'complete',
  }

  try {
    const res = await fetch(`${BASE_URL}/api/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const data = await res.json()

    if (res.ok) {
      const expScore = (payload.experienceRating as any)?.score || '?'
      const npsScore = (payload.npsRecommend as any)?.score || '?'
      console.log(`  ✓ Response ${index + 1}/${COUNT} — exp:${expScore} nps:${npsScore} duration:${duration_sec}s — id: ${data.response_id}`)
      return true
    } else {
      console.error(`  ✗ Response ${index + 1}/${COUNT} — ${res.status}: ${JSON.stringify(data)}`)
      return false
    }
  } catch (err) {
    console.error(`  ✗ Response ${index + 1}/${COUNT} — Network error:`, (err as Error).message)
    return false
  }
}

async function main() {
  console.log(`\n━━━ SentimetRX Response Simulator ━━━`)
  console.log(`  Study:    ${STUDY_GUID}`)
  console.log(`  Count:    ${COUNT}`)
  console.log(`  Base URL: ${BASE_URL}\n`)

  // 1. Fetch study config
  console.log('Fetching study config...')
  let study: { guid: string; bot_name: string; config: StudyConfig }
  try {
    study = await fetchStudy()
    console.log(`  Found: "${study.bot_name}"`)
    console.log(`  NPS: ${study.config.npsEnabled !== false ? 'on' : 'off'}`)
    console.log(`  Experience: ${study.config.experienceEnabled !== false ? 'on' : 'off'}`)
    console.log(`  Custom Qs: ${(study.config.questions || []).filter(q => q.enabled !== false && q.type !== 'hidden').length}`)
    console.log(`  Psycho Qs: ${(study.config.psychographicBank || []).length} (showing ${study.config.psychoCount || 3})`)
    console.log(`  Demographics: ${(study.config.demographicFields || []).filter(d => d.enabled).length} fields`)
    console.log()
  } catch (err) {
    console.error('Failed to fetch study:', (err as Error).message)
    process.exit(1)
  }

  // 2. Generate and submit
  console.log(`Submitting ${COUNT} responses...\n`)
  let success = 0
  let fail = 0

  for (let i = 0; i < COUNT; i++) {
    const { payload, duration_sec } = generateResponse(study.config)
    const ok = await submitResponse(payload, duration_sec, i)
    if (ok) success++; else fail++

    // Small delay to avoid rate limiting (30/min limit)
    if (i < COUNT - 1) {
      // If we're approaching rate limit, wait longer
      if ((i + 1) % 25 === 0) {
        console.log('  ⏳ Pausing to avoid rate limit...')
        await sleep(3000)
      } else {
        await sleep(200)
      }
    }
  }

  // 3. Summary
  console.log(`\n━━━ Complete ━━━`)
  console.log(`  ✓ Saved:  ${success}`)
  if (fail > 0) console.log(`  ✗ Failed: ${fail}`)
  console.log()

  if (fail > 0) {
    console.log('⚠️  Some responses failed. Check:')
    console.log('   1. Is the server running at ' + BASE_URL + '?')
    console.log('   2. Is the study active?')
    console.log('   3. Have the DB migration columns (status, session_id, fp_hash) been applied?')
  }
}

main().catch(console.error)
