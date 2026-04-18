'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import Link from 'next/link'

// ── Persona Profile (no scripted lines — AI generates responses) ───────

interface Persona {
  name: string
  bio: string
  attitude: string
  style: string
  concerns: string
  edge?: string
  sentiment: 'positive' | 'negative' | 'mixed'
  flags?: string[]
  switch_language?: string
}

// ── Persona Packs ──────────────────────────────────────────────────────

const COMMUNITY_PACK: Persona[] = [
  { name: 'Long-time homeowner', bio: 'Lived in the neighborhood 20+ years, raised kids here, deeply invested in community character', attitude: 'Protective but reasonable', style: 'Personal stories, references history', concerns: 'Density changes, traffic, property values, neighborhood character', sentiment: 'mixed' },
  { name: 'Young renter, priced out', bio: 'Renting for 4 years, decent income but can\'t afford to buy, watches friends leave', attitude: 'Frustrated, feels unheard', style: 'Direct, occasionally sarcastic', concerns: 'Affordability, gentrification, luxury development vs real needs', sentiment: 'negative' },
  { name: 'Parent of school-age kids', bio: 'Two kids ages 7 and 10, active in school PTA, walks kids to school', attitude: 'Enthusiastic about kid-friendly improvements', style: 'Practical, solution-oriented', concerns: 'Pedestrian safety, parks, after-school programs, playgrounds', sentiment: 'positive' },
  { name: 'Small business owner', bio: 'Runs a shop on the main commercial street, survived COVID barely', attitude: 'Cautiously supportive but worried about disruption', style: 'Business-minded, talks numbers', concerns: 'Parking, construction impact, foot traffic, small business survival', sentiment: 'mixed' },
  { name: 'Retired teacher on fixed income', bio: '35-year teaching career, now on pension, property taxes rising', attitude: 'Worried about displacement, feels forgotten', style: 'Emotional, references teaching career and students', concerns: 'Property taxes, senior displacement, cost of living', sentiment: 'negative' },
  { name: 'Transit and cycling advocate', bio: 'Bikes to work daily, active in local transit coalition', attitude: 'Passionate, well-researched', style: 'Cites studies, uses urbanist language', concerns: 'Bike infrastructure, bus routes, car dependency, walkability', sentiment: 'positive' },
  { name: 'Local contractor', bio: 'Builds and renovates in the area, employs local tradespeople', attitude: 'Optimistic about opportunity', style: 'Practical, talks process and timelines', concerns: 'Permitting delays, local hiring, stormwater, building codes', sentiment: 'positive' },
  { name: 'HOA board president', bio: 'Represents 200+ homes in a subdivision adjacent to development', attitude: 'Not opposed in principle but protective of his neighborhood', style: 'Formal, uses property value arguments', concerns: 'Buffer zones, height limits, rezoning near existing homes', edge: 'Classic NIMBY — wants development elsewhere', sentiment: 'mixed' },
  { name: 'Environmental activist', bio: 'Member of local conservation group, monitors flooding and tree canopy', attitude: 'Alarmed, data-driven', style: 'Cites specific trees, flood events, environmental studies', concerns: 'Tree removal, flooding, impervious surfaces, green infrastructure', sentiment: 'negative' },
  { name: 'Restaurant owner near construction', bio: 'Runs a popular restaurant near proposed development, fears construction impact', attitude: 'Supportive long-term but anxious about survival', style: 'Tells specific stories from past construction impacts', concerns: 'Construction timeline, access during build, revenue loss, tax relief', sentiment: 'mixed' },
  { name: 'New resident who chose the area', bio: 'Moved here 6 months ago specifically for the development plan, from suburbs', attitude: 'Enthusiastic, wants walkability', style: 'Compares to where they moved from', concerns: 'Walkability, mixed-use, co-working, modern amenities', sentiment: 'positive' },
  { name: 'Single parent working two jobs', bio: 'Raising two kids alone, needs practical infrastructure', attitude: 'Exhausted, pragmatic, feels invisible in planning', style: 'Blunt about real needs vs luxury amenities', concerns: 'Childcare, affordable transit, laundromat, weekend bus service', sentiment: 'mixed' },
  { name: 'Elderly resident with mobility issues', bio: 'Uses a walker, depends on bus, has lived here 30 years', attitude: 'Grateful for improvements, advocates for accessibility', style: 'Specific about ADA issues, sidewalk conditions', concerns: 'Sidewalks, curb cuts, bus shelters, lighting, benches', sentiment: 'positive' },
  // Edge cases
  { name: 'Disengaged teenager', bio: 'Dragged here by parent, does not want to participate', attitude: 'Completely disinterested', style: 'Minimal words, no engagement', concerns: '', sentiment: 'negative', flags: ['curt-detection'] },
  { name: 'Off-topic enthusiast', bio: 'Has a single pet issue and will not stop talking about it', attitude: 'Obsessively focused on their issue', style: 'Ignores questions, pivots every answer back to their topic', concerns: 'Their one pet issue only', sentiment: 'mixed', flags: ['off-topic-redirect'] },
  { name: 'Non-English speaker', bio: 'Bilingual resident, starts in English but more comfortable in their native language', attitude: 'Eager to participate, wants to be heard', style: 'Starts in English, switches language around turn 3', concerns: 'Representation, signage in their language, transit access', sentiment: 'positive', flags: ['language-switch'], switch_language: 'es' },
  { name: 'Frustrated profanity user', bio: 'Has attended many meetings with no results, patience exhausted', attitude: 'Escalating hostility, uses mild profanity', style: 'Starts irritated, gets more aggressive each turn', concerns: 'Broken promises, government waste, ignored complaints', sentiment: 'negative', flags: ['content-safety'] },
  { name: 'Political conspiracy theorist', bio: 'Sees corruption everywhere, references specific officials and donors', attitude: 'Suspicious, confrontational', style: 'Names names, references backroom deals and campaign money', concerns: 'Transparency, developer influence, closed-door meetings', sentiment: 'mixed', flags: ['sensitive-politics'] },
  { name: 'Coded discrimination commenter', bio: 'Concerned about "who moves in" using property values and crime statistics as cover', attitude: 'Uses plausible deniability, coded language', style: 'Says "I\'m not trying to be insensitive but..." frequently', concerns: 'Property crime, "neighborhood character", Section 8, "those people"', sentiment: 'negative', flags: ['sensitive-discrimination'] },
]

const EMPLOYEE_PACK: Persona[] = [
  { name: 'Veteran employee (15 years)', bio: 'Has seen many changes, institutional knowledge, approaching burnout', attitude: 'Cynical but cares deeply', style: 'References past initiatives that failed', concerns: 'Workload, recognition, broken promises, institutional memory', sentiment: 'mixed' },
  { name: 'Enthusiastic new hire', bio: 'Joined 3 months ago, full of energy and ideas', attitude: 'Optimistic, wants to contribute', style: 'Suggests ideas freely, asks why things are done a certain way', concerns: 'Onboarding, career growth, mentorship, innovation', sentiment: 'positive' },
  { name: 'Middle manager squeezed both ways', bio: 'Manages a team of 8, reports to VP, pressure from both directions', attitude: 'Pragmatic, stretched thin', style: 'Talks about competing priorities and resource constraints', concerns: 'Headcount, budget cuts, team morale, unclear priorities', sentiment: 'mixed' },
  { name: 'Remote worker feeling disconnected', bio: 'Went remote during COVID, never came back, feels out of the loop', attitude: 'Worried about being forgotten', style: 'Mentions missing hallway conversations and informal updates', concerns: 'Remote inclusion, communication tools, promotion equity, isolation', sentiment: 'negative' },
  { name: 'Hourly front-line worker', bio: 'Customer-facing role, no work-from-home option, different reality from corporate', attitude: 'Feels like two different companies exist', style: 'Contrasts corporate perks with frontline reality', concerns: 'Scheduling, break room conditions, pay equity, recognition', sentiment: 'negative' },
  { name: 'High performer considering leaving', bio: 'Top performer, has an offer from a competitor, testing whether leadership listens', attitude: 'Quiet frustration, measured', style: 'Asks probing questions about direction and values', concerns: 'Growth ceiling, compensation, mission alignment, leadership trust', sentiment: 'mixed' },
  { name: 'Working parent juggling everything', bio: 'Two kids under 5, partner also works, dependent on schedule flexibility', attitude: 'Grateful for flexibility but needs more support', style: 'Practical, talks about real daily challenges', concerns: 'Flexible hours, childcare support, meeting overload, PTO', sentiment: 'mixed' },
  { name: 'DEI champion', bio: 'Active in employee resource groups, advocates for inclusive policies', attitude: 'Passionate about representation', style: 'Cites data on diversity gaps, shares personal experiences', concerns: 'Hiring practices, promotion equity, ERG funding, inclusive culture', sentiment: 'positive' },
  { name: 'IT/ops person nobody listens to', bio: 'Maintains the systems everyone depends on, rarely consulted on decisions', attitude: 'Mildly resentful, technically precise', style: 'Points out downstream effects of decisions', concerns: 'Technical debt, tool sprawl, change management, being consulted', sentiment: 'negative' },
  { name: 'Executive skeptic', bio: 'Director-level, privately questions the strategy', attitude: 'Diplomatically critical', style: 'Asks pointed questions framed as curiosity', concerns: 'Strategy clarity, market position, resource allocation', sentiment: 'mixed' },
  { name: 'Burned out team lead', bio: 'Carrying the workload of two people since layoffs, exhausted', attitude: 'Beyond frustrated, considering a break', style: 'Short sentences, heavy sighs', concerns: 'Workload, backfills, mental health, unsustainable pace', sentiment: 'negative' },
  // Edge cases
  { name: 'Disengaged attendee', bio: 'Mandatory attendance, multitasking, minimal participation', attitude: 'Checked out', style: 'One-word answers', concerns: '', sentiment: 'negative', flags: ['curt-detection'] },
  { name: 'Benefits obsessive', bio: 'Only cares about one topic: benefits/compensation', attitude: 'Single-minded', style: 'Ignores every question, steers to benefits', concerns: 'Health insurance, 401k match, PTO policy', sentiment: 'mixed', flags: ['off-topic-redirect'] },
  { name: 'Non-English speaking employee', bio: 'Works in operations, stronger in native language', attitude: 'Wants to contribute but language barrier', style: 'Starts in English, switches mid-conversation', concerns: 'Language support, safety signage, inclusion', sentiment: 'positive', flags: ['language-switch'], switch_language: 'es' },
  { name: 'Angry about layoffs', bio: 'Lost close colleagues in recent layoffs, patience gone', attitude: 'Hostile, uses profanity', style: 'Escalates each turn', concerns: 'Layoff decisions, severance, leadership accountability', sentiment: 'negative', flags: ['content-safety'] },
]

const CUSTOMER_PACK: Persona[] = [
  { name: 'Loyal long-term customer', bio: 'Using the product/service for 5+ years, evangelizes to friends', attitude: 'Supportive but has wish list', style: 'References specific features and history', concerns: 'Feature requests, loyalty rewards, product direction', sentiment: 'positive' },
  { name: 'Recently churned customer', bio: 'Left 3 months ago, came back reluctantly', attitude: 'Wary, testing whether things improved', style: 'Compares to competitors, skeptical', concerns: 'What drove them away, trust, reliability', sentiment: 'mixed' },
  { name: 'Price-sensitive shopper', bio: 'Always comparing prices, switches for deals', attitude: 'Transactional, value-focused', style: 'Talks numbers, compares competitors', concerns: 'Pricing, bundles, hidden fees, value for money', sentiment: 'mixed' },
  { name: 'Power user / super fan', bio: 'Uses every feature, knows the product better than some employees', attitude: 'Enthusiastic but opinionated', style: 'Suggests specific improvements, references advanced features', concerns: 'Performance, advanced features, API access, customization', sentiment: 'positive' },
  { name: 'First-time customer', bio: 'Just started, still figuring it out', attitude: 'Cautiously optimistic', style: 'Asks basic questions, compares to what they used before', concerns: 'Onboarding, learning curve, documentation, first impressions', sentiment: 'positive' },
  { name: 'Angry support escalation', bio: 'Had a terrible support experience, still unresolved', attitude: 'Furious, wants accountability', style: 'References specific ticket numbers and dates', concerns: 'Support quality, resolution time, being passed around', sentiment: 'negative' },
  { name: 'Enterprise buyer', bio: 'Evaluating for a team of 200, decision-maker', attitude: 'Professional, ROI-focused', style: 'Asks about scale, security, compliance, contracts', concerns: 'Enterprise features, SLAs, data privacy, bulk pricing', sentiment: 'mixed' },
  { name: 'Accessibility advocate', bio: 'Uses assistive technology, encounters barriers regularly', attitude: 'Patient but persistent', style: 'Specific about WCAG violations and screen reader issues', concerns: 'Accessibility, inclusive design, ADA compliance', sentiment: 'mixed' },
  { name: 'Small business owner user', bio: 'Uses the product to run their business, any downtime costs money', attitude: 'Dependent and nervous about changes', style: 'Talks about business impact of every decision', concerns: 'Reliability, breaking changes, migration paths, pricing stability', sentiment: 'mixed' },
  // Edge cases
  { name: 'One-word reviewer', bio: 'Gives minimal feedback, rates things 3 stars with no explanation', attitude: 'Indifferent', style: 'Barely responds', concerns: '', sentiment: 'negative', flags: ['curt-detection'] },
  { name: 'Feature request broken record', bio: 'Wants one specific feature and brings it up constantly', attitude: 'Fixated', style: 'Steers every answer to their feature request', concerns: 'Their one feature request', sentiment: 'mixed', flags: ['off-topic-redirect'] },
  { name: 'International customer', bio: 'Non-English speaking user in a growing market', attitude: 'Eager but language barrier', style: 'Starts English, switches to native language', concerns: 'Localization, local payment methods, support in their language', sentiment: 'positive', flags: ['language-switch'], switch_language: 'es' },
  { name: 'Raging reviewer', bio: 'Left a 1-star review, still angry, escalating', attitude: 'Hostile, uses profanity', style: 'Gets worse each turn', concerns: 'Product failure, refund, accountability', sentiment: 'negative', flags: ['content-safety'] },
]

const RESTAURANT_PACK: Persona[] = [
  { name: 'Regular diner (weekly)', bio: 'Comes in every week, knows the staff by name, has a usual order', attitude: 'Loyal but notices every change', style: 'References specific dishes and past visits', concerns: 'Menu consistency, portion sizes, favorite dishes staying, atmosphere', sentiment: 'positive' },
  { name: 'First-time visitor', bio: 'Trying the restaurant for the first time based on a recommendation', attitude: 'Curious, forming first impressions', style: 'Compares to other restaurants, comments on ambiance', concerns: 'Menu clarity, welcome experience, value, atmosphere', sentiment: 'positive' },
  { name: 'Food allergy parent', bio: 'Child has severe nut allergy, hypervigilant about cross-contamination', attitude: 'Anxious but appreciative when accommodated', style: 'Asks detailed ingredient questions, needs staff knowledge', concerns: 'Allergen labeling, kitchen protocols, staff training, safe options', sentiment: 'mixed' },
  { name: 'Date night couple', bio: 'Uses the restaurant for special occasions, cares about ambiance', attitude: 'Wants a great experience, judges the details', style: 'Talks about lighting, noise, service timing', concerns: 'Noise level, wait times, romantic atmosphere, cocktail quality', sentiment: 'mixed' },
  { name: 'Delivery/takeout customer', bio: 'Orders 2-3 times a week via delivery app, rarely dines in', attitude: 'Convenient but frustrated by packaging and delivery issues', style: 'Compares in-restaurant vs delivered quality', concerns: 'Packaging, food temp on arrival, delivery accuracy, app experience', sentiment: 'mixed' },
  { name: 'Yelp/Google reviewer', bio: 'Reviews every restaurant they visit, has a following', attitude: 'Evaluating everything for public review', style: 'Detailed observations, judges presentation and consistency', concerns: 'Photo-worthy plating, consistency, service attitude, unique offerings', sentiment: 'mixed' },
  { name: 'Budget-conscious family', bio: 'Family of 5, needs kid menu and reasonable prices', attitude: 'Loves the food but watches the bill', style: 'Calculates value, mentions kids\' preferences', concerns: 'Kids menu quality, portion value, family-friendliness, noise tolerance', sentiment: 'positive' },
  { name: 'Brunch enthusiast', bio: 'Lives for weekend brunch, tries every new spot', attitude: 'Adventurous eater, Instagram-aware', style: 'Talks about trendy items, presentation, drinks', concerns: 'Brunch menu creativity, cocktails, wait times on weekends, ambiance', sentiment: 'positive' },
  { name: 'Long-time server/staff member', bio: 'Worked here 3 years, knows operations inside and out', attitude: 'Cares about the place but feels overworked', style: 'Speaks from behind-the-scenes experience', concerns: 'Staffing, tip distribution, schedule flexibility, management communication', sentiment: 'mixed' },
  { name: 'Neighboring business owner', bio: 'Runs a shop next door, shares parking and foot traffic', attitude: 'Collaborative but territorial about shared resources', style: 'Talks about neighborhood synergy and conflicts', concerns: 'Shared parking, noise, dumpster placement, mutual customer traffic', sentiment: 'mixed' },
  { name: 'Health-conscious diner', bio: 'Counts macros, needs nutritional info, prefers whole foods', attitude: 'Appreciative of healthy options, frustrated by lack of info', style: 'Asks about ingredients, cooking methods, substitutions', concerns: 'Nutritional transparency, healthy options, ingredient quality, customization', sentiment: 'mixed' },
  // Edge cases
  { name: 'Hangry complainer', bio: 'Waited too long, increasingly hostile about service', attitude: 'Escalating frustration', style: 'Gets more aggressive each turn', concerns: 'Wait times, slow service, cold food', sentiment: 'negative', flags: ['content-safety'] },
  { name: 'Non-English speaking diner', bio: 'Tourist or immigrant, struggles with English menu', attitude: 'Wants to enjoy the meal but communication is hard', style: 'Starts in English, switches to native language', concerns: 'Menu translation, dietary communication, feeling welcome', sentiment: 'positive', flags: ['language-switch'], switch_language: 'es' },
  { name: 'Silent eater', bio: 'Eats alone, headphones in, gives minimal feedback', attitude: 'Not rude, just private', style: 'One-word answers', concerns: '', sentiment: 'mixed', flags: ['curt-detection'] },
]

const STAKEHOLDER_PACK: Persona[] = [
  { name: 'Board member', bio: 'Serves on the board, fiduciary responsibility, governance focus', attitude: 'Strategic, risk-aware', style: 'Asks about metrics, compliance, fiduciary duty', concerns: 'ROI, risk management, governance, strategic alignment', sentiment: 'mixed' },
  { name: 'Major donor/investor', bio: 'Significant financial contributor, expects impact and transparency', attitude: 'Expects accountability', style: 'Talks about impact per dollar, reporting', concerns: 'Impact measurement, financial transparency, reporting cadence', sentiment: 'mixed' },
  { name: 'Community partner (nonprofit)', bio: 'Runs a partner organization, co-delivers services', attitude: 'Collaborative but protective of their mission', style: 'References partnership agreements and shared clients', concerns: 'Coordination, credit sharing, funding allocation, overlap', sentiment: 'positive' },
  { name: 'Government liaison', bio: 'City/county contact, manages grants and compliance', attitude: 'Bureaucratic but supportive', style: 'References regulations, deadlines, reporting requirements', concerns: 'Compliance, grant deliverables, audit readiness, timelines', sentiment: 'mixed' },
  { name: 'Vendor/supplier', bio: 'Provides goods or services, depends on the relationship', attitude: 'Wants stability and clear expectations', style: 'Talks about contracts, payment terms, communication', concerns: 'Payment reliability, contract terms, volume commitments, feedback loops', sentiment: 'mixed' },
  { name: 'Media/press contact', bio: 'Local journalist covering the organization', attitude: 'Seeking the story, asks probing questions', style: 'Journalistic — who, what, when, why, how much', concerns: 'Transparency, public interest stories, access, accuracy', sentiment: 'mixed' },
  { name: 'Volunteer coordinator', bio: 'Manages 50+ volunteers, bridge between org and community', attitude: 'Passionate but overwhelmed', style: 'Talks about volunteer experience and retention', concerns: 'Volunteer training, appreciation, burnout, scheduling tools', sentiment: 'positive' },
  { name: 'Beneficiary/client', bio: 'Receives services from the organization, lived experience', attitude: 'Grateful but has real feedback on gaps', style: 'Personal stories, specific about what worked and what didn\'t', concerns: 'Service quality, wait times, dignity, follow-through', sentiment: 'mixed' },
  { name: 'Skeptical taxpayer', bio: 'Questions how public money is spent, attends meetings to hold accountable', attitude: 'Adversarial but legitimate', style: 'Demands numbers, questions overhead, cites waste', concerns: 'Overhead ratio, executive compensation, measurable outcomes', sentiment: 'negative' },
  { name: 'Peer organization leader', bio: 'Runs a similar org in another region, sharing best practices', attitude: 'Collegial, comparative', style: 'References what they do differently, benchmarking', concerns: 'Best practices, benchmarks, collaboration opportunities', sentiment: 'positive' },
  // Edge cases
  { name: 'Disengaged board appointee', bio: 'Political appointment, doesn\'t engage meaningfully', attitude: 'Going through the motions', style: 'Minimal responses', concerns: '', sentiment: 'mixed', flags: ['curt-detection'] },
  { name: 'Agenda-driven lobbyist', bio: 'Represents an interest group, every answer steers to their cause', attitude: 'Relentless advocacy', style: 'Pivots every topic to their agenda', concerns: 'Their single legislative/policy priority', sentiment: 'mixed', flags: ['off-topic-redirect'] },
  { name: 'International partner', bio: 'Partner from another country, language barrier', attitude: 'Eager to collaborate despite communication challenges', style: 'Switches to native language when complex topics arise', concerns: 'Cultural sensitivity, translation, international standards', sentiment: 'positive', flags: ['language-switch'], switch_language: 'es' },
]

const PACKS: Record<string, { label: string; personas: Persona[] }> = {
  community: { label: 'Community', personas: COMMUNITY_PACK },
  employee: { label: 'Employee', personas: EMPLOYEE_PACK },
  customer: { label: 'Customer', personas: CUSTOMER_PACK },
  restaurant: { label: 'Restaurant', personas: RESTAURANT_PACK },
  stakeholder: { label: 'Stakeholder', personas: STAKEHOLDER_PACK },
}

// ── Simulator ──────────────────────────────────────────────────────────

interface Session { id: string; name: string; status: string; config: any; discussion_guide: any[]; participants: number; turns: number }
interface LogEntry { text: string; type: 'ok' | 'err' | 'info' | 'dim' }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export default function TownHallSimulatorPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [pack, setPack] = useState('community')
  const [count, setCount] = useState(15)
  const [turnsPerParticipant, setTurnsPerParticipant] = useState(4)
  const [enabledPersonas, setEnabledPersonas] = useState<Record<number, boolean>>({})
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [progress, setProgress] = useState({ done: 0, total: 0, ok: 0, fail: 0 })
  const stopRef = useRef(false)
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/townhall/sessions')
      .then(r => r.json())
      .then(data => setSessions(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  // Auto-select pack based on session type
  useEffect(() => {
    const s = sessions.find(s => s.id === selectedId)
    if (s?.config?.session_type) {
      const type = s.config.session_type
      if (PACKS[type]) setPack(type)
    }
  }, [selectedId, sessions])

  // Reset enabled personas when pack changes
  useEffect(() => {
    const all: Record<number, boolean> = {}
    PACKS[pack].personas.forEach((_, i) => { all[i] = true })
    setEnabledPersonas(all)
  }, [pack])

  const addLog = useCallback((text: string, type: LogEntry['type'] = 'ok') => {
    setLogs(prev => [...prev, { text, type }])
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [])

  const run = useCallback(async () => {
    if (!selectedId) return
    stopRef.current = false
    setRunning(true)
    setLogs([])

    const session = sessions.find(s => s.id === selectedId)
    if (!session) { addLog('Session not found', 'err'); setRunning(false); return }

    const currentPack = PACKS[pack]
    const allPersonas = currentPack.personas.filter((_, i) => enabledPersonas[i] !== false)
    const participantCount = Math.min(count, allPersonas.length)
    const shuffled = [...allPersonas].sort(() => Math.random() - 0.5).slice(0, participantCount)

    const cfg = session.config || {}
    const topics = (session.discussion_guide || []).filter((t: any) => t.enabled !== false).map((t: any) => t.label)
    const sessionContext = {
      org_name: cfg.context?.org_name || '',
      event_description: cfg.context?.event_description || '',
      topics,
    }

    addLog(`Session: "${session.name}" (${session.status})`, 'info')
    addLog(`Pack: ${currentPack.label} — ${participantCount} personas, ${turnsPerParticipant} turns each`, 'info')
    addLog(`Topics: ${topics.join(', ') || 'none'}`, 'info')
    addLog(`AI-generated responses (not scripted)\n`, 'dim')

    if (session.status === 'setup') {
      addLog('Starting session...', 'info')
      try {
        await fetch('/api/townhall/sessions/' + selectedId, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'active' }),
        })
      } catch { addLog('Failed to start session', 'err'); setRunning(false); return }
    }

    const totalTurns = participantCount * turnsPerParticipant
    setProgress({ done: 0, total: totalTurns, ok: 0, fail: 0 })

    let ok = 0, fail = 0, turnsDone = 0

    for (let p = 0; p < participantCount; p++) {
      if (stopRef.current) { addLog('Stopped.', 'info'); break }

      const persona = shuffled[p]
      const pid = 'sim_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
      const flags = persona.flags?.length ? ` [${persona.flags.join(', ')}]` : ''
      addLog(`── ${persona.name} (${persona.sentiment})${flags}`, 'info')
      addLog(`   ${persona.bio.slice(0, 100)}`, 'dim')

      let turnNumber = 0, themeId: string | null = null, lastBotMessage = ''
      try {
        const jr = await fetch('/api/townhall/join/' + selectedId, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: 'en' }),
        })
        const jd = await jr.json()
        if (jd.error) { addLog(`   Join failed: ${jd.error}`, 'err'); fail++; continue }
        turnNumber = jd.turn_number || 1
        themeId = jd.theme_id || null
        lastBotMessage = jd.bot_message || ''
      } catch (e) { addLog(`   Join failed: ${(e as Error).message}`, 'err'); fail++; continue }

      let currentLang = 'en'
      for (let t = 0; t < turnsPerParticipant; t++) {
        if (stopRef.current) break

        let message: string
        try {
          const simRes = await fetch('/api/townhall/simulate', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ persona, bot_message: lastBotMessage, session_context: sessionContext, turn_number: t + 1, language: currentLang }),
          })
          const simData = await simRes.json()
          message = simData.message || 'That\'s an important issue.'
          if (simData.language) currentLang = simData.language
        } catch {
          message = 'I think that matters to our community.'
        }

        try {
          const cr = await fetch('/api/townhall/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: selectedId, participant_id: pid, message, turn_number: turnNumber, theme_id: themeId, skipped: false, language: currentLang }),
          })
          const cd = await cr.json()
          const preview = message.length > 60 ? message.slice(0, 60) + '...' : message
          const src = cd.source || 'guide'
          const final = cd.is_final ? ' [FINAL]' : ''
          addLog(`   T${t + 1}: "${preview}" → ${src}${final}${currentLang !== 'en' ? ` [${currentLang.toUpperCase()}]` : ''}`)
          turnNumber = cd.turn_number || turnNumber + 1
          themeId = cd.theme_id || themeId
          lastBotMessage = cd.bot_message || ''
          ok++
          if (cd.is_final) break
        } catch (e) {
          fail++
          addLog(`   T${t + 1}: ERROR ${(e as Error).message}`, 'err')
        }

        turnsDone++
        setProgress({ done: turnsDone, total: totalTurns, ok, fail })
        await sleep(300)
      }

      if ((p + 1) % 5 === 0 && p < participantCount - 1 && !stopRef.current) {
        addLog('   [pause 3s]', 'dim')
        await sleep(3000)
      }
    }

    addLog(`\nDone! ${ok} turns saved, ${fail} failed across ${participantCount} personas.`, 'info')
    setRunning(false)
  }, [selectedId, count, pack, turnsPerParticipant, enabledPersonas, sessions, addLog])

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  const selected = sessions.find(s => s.id === selectedId)
  const currentPack = PACKS[pack]

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-800">Town Hall Simulator</h1>
            <p className="text-sm text-gray-500">AI-driven personas — responses generated from profiles + session topics</p>
          </div>
          <Link href="/admin/simulator" className="text-xs text-teal-600 hover:text-teal-800 font-medium">
            Survey Simulator →
          </Link>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-500 mb-1">Session</label>
            <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:outline-none bg-white">
              <option value="">Select a Town Hall session...</option>
              {sessions.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({s.status}) — {s.participants} participants, {s.turns} turns</option>
              ))}
            </select>
          </div>

          {selected && (
            <div className="text-sm text-orange-700 bg-orange-50 rounded-lg px-3 py-2 mb-4">
              <strong>{selected.name}</strong> — {selected.discussion_guide?.length || 0} topics
              {selected.status !== 'setup' && selected.status !== 'active' && (
                <span className="text-amber-600 ml-2">(session is {selected.status})</span>
              )}
            </div>
          )}

          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-500 mb-1">Persona Pack</label>
            <div className="flex flex-wrap gap-2">
              {Object.entries(PACKS).map(([key, p]) => (
                <button key={key} onClick={() => setPack(key)}
                  className="px-3 py-2 rounded-lg text-xs font-semibold transition-colors"
                  style={{ background: pack === key ? '#fff4ef' : '#f9fafb', border: '1px solid ' + (pack === key ? '#E8632A' : '#e5e7eb'), color: pack === key ? '#E8632A' : '#6b7280' }}>
                  {p.label} ({p.personas.length})
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Participants (max {currentPack.personas.length})</label>
              <input type="number" value={count} onChange={e => setCount(parseInt(e.target.value) || 10)}
                min={1} max={currentPack.personas.length}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Turns per Participant</label>
              <input type="number" value={turnsPerParticipant} onChange={e => setTurnsPerParticipant(parseInt(e.target.value) || 4)}
                min={1} max={6}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:outline-none" />
            </div>
          </div>

          <details className="mb-4">
            <summary className="text-xs font-semibold text-gray-500 cursor-pointer hover:text-gray-700">
              Personas ({Object.values(enabledPersonas).filter(Boolean).length}/{currentPack.personas.length} enabled)
            </summary>
            <div className="mt-2 max-h-72 overflow-y-auto border border-gray-100 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-1.5 text-gray-500 font-semibold w-8"></th>
                    <th className="text-left px-3 py-1.5 text-gray-500 font-semibold">Persona</th>
                    <th className="text-left px-3 py-1.5 text-gray-500 font-semibold">Sentiment</th>
                    <th className="text-left px-3 py-1.5 text-gray-500 font-semibold">Edge case</th>
                  </tr>
                </thead>
                <tbody>
                  {currentPack.personas.map((p, i) => (
                    <tr key={i} className={'border-t border-gray-50' + (enabledPersonas[i] === false ? ' opacity-40' : '')}>
                      <td className="px-3 py-1">
                        <input type="checkbox" checked={enabledPersonas[i] !== false}
                          onChange={e => setEnabledPersonas(prev => ({ ...prev, [i]: e.target.checked }))}
                          className="rounded" />
                      </td>
                      <td className="px-3 py-1">
                        <span className="font-medium text-gray-700">{p.name}</span>
                        <span className="text-gray-400 ml-1 hidden sm:inline">— {p.bio.slice(0, 60)}{p.bio.length > 60 ? '...' : ''}</span>
                      </td>
                      <td className="px-3 py-1">
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                          p.sentiment === 'positive' ? 'bg-green-100 text-green-600' :
                          p.sentiment === 'negative' ? 'bg-red-100 text-red-600' :
                          'bg-amber-100 text-amber-600'
                        }`}>{p.sentiment}</span>
                      </td>
                      <td className="px-3 py-1 text-gray-400">{p.flags?.join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <div className="flex items-center gap-3">
            <button onClick={run} disabled={running || !selectedId}
              className="px-5 py-2.5 text-white rounded-lg font-semibold text-sm hover:opacity-90 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              style={{ background: '#E8632A' }}>
              {running ? 'Running...' : 'Run Simulation'}
            </button>
            {running && (
              <button onClick={() => { stopRef.current = true }}
                className="px-5 py-2.5 bg-red-500 text-white rounded-lg font-semibold text-sm hover:bg-red-600 transition-colors">
                Stop
              </button>
            )}
            {selected && (
              <Link href={'/townhall/' + selectedId}
                className="px-4 py-2.5 text-sm font-medium text-orange-600 hover:text-orange-800" target="_blank">
                View Admin Panel →
              </Link>
            )}
          </div>

          {progress.total > 0 && (
            <div className="mt-4">
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-300" style={{ width: pct + '%', background: '#E8632A' }} />
              </div>
              <div className="text-xs text-gray-500 mt-1 text-right">
                {progress.done} / {progress.total} turns ({progress.ok} saved{progress.fail > 0 ? `, ${progress.fail} failed` : ''})
              </div>
            </div>
          )}
        </div>

        {logs.length > 0 && (
          <div className="bg-gray-900 rounded-xl p-4 max-h-[500px] overflow-y-auto font-mono text-xs leading-relaxed">
            {logs.map((l, i) => (
              <div key={i} className={
                l.type === 'err' ? 'text-red-400' :
                l.type === 'info' ? 'text-sky-400' :
                l.type === 'dim' ? 'text-gray-600' :
                'text-green-400'
              }>
                {l.text}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>
    </div>
  )
}
