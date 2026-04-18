'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import Link from 'next/link'

// ── 20 Scripted Personas — City Council Development Plan Town Hall ──────

interface Persona {
  name: string
  bio: string
  sentiment: 'positive' | 'negative' | 'mixed'
  responses: string[]    // Sent in order across turns
  flags?: string[]       // Edge cases this persona tests
}

const PERSONAS: Persona[] = [
  {
    name: 'Long-time homeowner (20 yrs)',
    bio: 'Loves the neighborhood, worried about density',
    sentiment: 'mixed',
    responses: [
      "I've lived here for twenty years and I chose this neighborhood because of the quiet streets and big yards. I'm worried this development plan is going to change everything that made this place special.",
      "Look, I'm not against progress. But when you start talking about multi-family housing on lots that have always been single-family, that changes the whole feel. Traffic, noise, parking — it all gets worse.",
      "What I'd really like to see is some kind of height limit. Three stories max. That way you get some density without it feeling like you're living in a canyon.",
      "The mature trees on Elm Street — those have been here longer than any of us. If the plan involves cutting those down for road widening, you're going to have a fight on your hands.",
      "I guess what I'm saying is, involve us in the details. Don't just show up with a finished plan and ask us to rubber stamp it."
    ],
  },
  {
    name: 'Young renter, priced out',
    bio: 'Can\'t afford to buy, frustrated about affordability',
    sentiment: 'negative',
    responses: [
      "I've been renting here for four years and every year my rent goes up. I make decent money but I can't even think about buying in this neighborhood. The development plan needs to address affordability or it's just helping people who already have money.",
      "Every new project they build around here is luxury condos or townhomes starting at $450K. Who is that for? Not people like me who work in this community every day.",
      "I'd love to see the plan include some percentage of affordable units — like actually affordable, not 'affordable' in air quotes where it's still $1,800 a month.",
      "My friends have all moved to the suburbs because they can't afford it here. That's not healthy for a neighborhood. You need young people, you need diversity of income.",
      "If this plan doesn't have teeth on affordability — actual mandates, not just 'incentives' for developers — then it's just going to accelerate gentrification."
    ],
  },
  {
    name: 'Parent of school-age kids',
    bio: 'Excited about parks, wants safer streets near schools',
    sentiment: 'positive',
    responses: [
      "I'm really excited about the new park space in the plan. My kids are 7 and 10 and we're always looking for places to play that aren't a 20-minute drive away.",
      "The crosswalks near Lincoln Elementary are honestly scary. Cars fly through there at 40 mph during drop-off. If the development plan can address pedestrian safety, that alone would be huge.",
      "I love the idea of a community center with after-school programs. Right now there's nothing for kids between 3pm and 6pm unless you can afford private programs.",
      "One thing I'd add — the playground equipment at Memorial Park is from like 2005. If we're investing in the neighborhood, can we update that too?",
      "Overall I'm supportive. This feels like a plan that actually thinks about families, not just developers trying to maximize units."
    ],
  },
  {
    name: 'Small business owner on Main St',
    bio: 'Supports foot traffic but worried about parking',
    sentiment: 'mixed',
    responses: [
      "I run a coffee shop on Main Street. More residents means more customers, so I'm generally supportive. But I'm worried about what happens during the construction phase — that killed two businesses on Oak Ave last year.",
      "Parking is already tight. If you add 200 units and don't add parking, my customers are going to stop coming because they can't find a spot. It's simple math.",
      "I'd love to see the plan include some street-level retail requirements. Don't let developers build blank walls at ground level — that kills the walkability everyone says they want.",
      "The construction timeline matters too. If Main Street is torn up for 18 months, I need to know now so I can plan. Surprises kill small businesses.",
      "Can we get some kind of small business impact fund in the plan? Even temporary rent relief during construction would help shops like mine survive it."
    ],
  },
  {
    name: 'Retired teacher, fixed income',
    bio: 'Property taxes crushing her, fears more increases',
    sentiment: 'negative',
    responses: [
      "I'm on a fixed income. I retired from teaching after 35 years. My property taxes have gone up 40% in the last five years and I'm honestly not sure how much longer I can afford to stay in my own home.",
      "Every time they 'improve' the neighborhood, my assessment goes up. New park? Assessment goes up. New sidewalks? Assessment goes up. It feels like I'm being taxed out of my own community.",
      "Nobody at the council ever talks about protecting long-time residents from being displaced by rising costs. It's all about attracting new people and new money.",
      "I taught half the kids in this neighborhood. Now their parents can't afford to stay either. There needs to be a homestead exemption or some kind of freeze for seniors.",
      "I'm not against development. I just want to know that someone at that table is thinking about people like me who are already here and struggling."
    ],
  },
  {
    name: 'Cyclist and transit advocate',
    bio: 'Wants bike lanes and bus routes, not more cars',
    sentiment: 'positive',
    responses: [
      "I bike to work every day and honestly, the infrastructure is dangerous. The development plan is a once-in-a-generation chance to build protected bike lanes and I really hope the council takes it seriously.",
      "Every transportation study shows that adding lanes doesn't reduce traffic — it induces demand. We should be investing in bus rapid transit and bike infrastructure instead of wider roads.",
      "The bus route on Washington Ave was cut three years ago and now there's no public transit option for the entire south side. This plan needs to bring that back.",
      "I love that the plan mentions 'complete streets.' That's the right framework. Sidewalks, bike lanes, bus shelters, street trees — design for people, not just cars.",
      "Cities that invest in multimodal transportation see property values go up and traffic go down. This isn't radical — it's what every successful city is doing."
    ],
  },
  {
    name: 'Contractor who builds locally',
    bio: 'Sees economic opportunity, wants faster permitting',
    sentiment: 'positive',
    responses: [
      "As someone who builds in this area, I'm excited about the development plan. It means jobs for local tradespeople and a chance to modernize some aging infrastructure.",
      "The biggest bottleneck right now is permitting. It takes 8-10 months to get a permit approved for a simple renovation. If we're talking about large-scale development, that process needs to be streamlined.",
      "I'd advocate for local hiring requirements in the plan. Make sure the jobs go to people who live here, not to out-of-state contractors who undercut on labor.",
      "The stormwater requirements are outdated. If we're adding density, we need to invest in modern drainage or we're going to see flooding like we had on Pine Street last spring.",
      "I'm ready to build. Just tell me the rules are clear, the timeline is realistic, and the inspections won't take six weeks each."
    ],
  },
  {
    name: 'HOA board president (NIMBY)',
    bio: 'Wants development but not near his subdivision',
    sentiment: 'mixed',
    responses: [
      "I represent the Lakewood Estates HOA — 240 homes. We're not opposed to development in principle. But the proposed rezoning on the parcel adjacent to our community is very concerning.",
      "Our property values are the highest in the district. If you put a five-story mixed-use building 50 feet from our back fences, you're going to destroy what people paid a premium for.",
      "Why can't the high-density development go on the old industrial lots on the east side? There's plenty of space there that wouldn't impact existing residential neighborhoods.",
      "We've spent $2 million on community amenities — pool, clubhouse, trails. We didn't make that investment so the council could change the zoning next door and undermine it all.",
      "I'm asking the council to create buffer zones. At minimum 200 feet between existing single-family and any new multi-family. That's a reasonable compromise."
    ],
  },
  {
    name: 'Environmental activist',
    bio: 'Opposes tree removal, worried about flooding',
    sentiment: 'negative',
    responses: [
      "The plan calls for removing 47 mature oaks to widen Carter Boulevard. Those trees are 60-80 years old. Once they're gone, they're gone. You can't replace that canopy with saplings.",
      "Has anyone done a real environmental impact study? The wetlands along the creek are a natural flood buffer. If you develop that area, you're putting hundreds of homes at risk during heavy rain.",
      "We had three flooding events last year — three. And the solution is to add more impervious surface? That's not development, that's a disaster waiting to happen.",
      "I want to see green infrastructure in this plan. Bioswales, rain gardens, permeable pavement. Not just pipes and concrete that push the water problem downstream.",
      "The city's own climate plan says we need to increase tree canopy by 20% by 2035. This development plan directly contradicts that goal. Has anyone even read both documents?"
    ],
  },
  {
    name: 'Restaurant owner near proposed site',
    bio: 'More customers good, but construction impact',
    sentiment: 'mixed',
    responses: [
      "I own the Italian place on 3rd Avenue. Long-term, more residents nearby would be great for my business. But I survived COVID barely — I can't survive two years of construction blocking my entrance.",
      "When they did the water main work on Central Ave, foot traffic dropped 60% for the restaurants on that block. Two closed permanently. I don't want that to happen to us.",
      "If the timeline is realistic and there's a plan to maintain access during construction, I can work with that. But I need specifics, not just promises.",
      "Could the city consider a temporary property tax reduction for businesses in the construction zone? That would help offset the revenue loss during the build-out.",
      "I'd also love to see more outdoor dining space in the plan. Wider sidewalks with café seating would benefit every restaurant on the block, not just during construction but permanently."
    ],
  },
  {
    name: 'Angry resident about traffic',
    bio: 'Ranting about dangerous intersection, emotional',
    sentiment: 'negative',
    responses: [
      "The intersection at Oak and 5th is a death trap. I've seen three accidents there in the last year, including one where a kid on a bike got hit. And now you want to add MORE traffic to this area?",
      "I've called the city about that intersection SEVEN times. Seven! Nobody calls back, nobody fixes the light timing, nobody adds a turn signal. And now you're talking about development?",
      "A woman in my neighborhood was T-boned at that intersection last March. She spent two weeks in the hospital. Her family is still dealing with the medical bills. This isn't abstract — people are getting hurt.",
      "Fix the infrastructure we have before building new stuff. That's all I'm asking. The roads are crumbling, the signals are from the 1990s, and you want to pour money into shiny new projects.",
      "I'm not going to stop showing up to these meetings until something changes. Every single one. Until someone at that council table actually does something about traffic safety."
    ],
  },
  {
    name: 'New resident, just moved in',
    bio: 'Chose neighborhood for walkability, excited',
    sentiment: 'positive',
    responses: [
      "We moved here six months ago specifically because of the development plan. We came from the suburbs and wanted a walkable neighborhood where we didn't need two cars.",
      "The mixed-use concept is exactly what modern neighborhoods need. I love being able to walk to a coffee shop, a grocery store, and a park all within ten minutes.",
      "Back where we moved from, everything was strip malls and parking lots. This plan feels like it's building something with actual character and community identity.",
      "I'd love to see the plan include co-working spaces. A lot of people work remotely now and having a local workspace option would reduce the need for commuting entirely.",
      "We're planning to be here long-term and raise our kids here. Knowing the neighborhood has a thoughtful development vision makes us feel like we made the right choice."
    ],
  },
  {
    name: 'Politically motivated resident',
    bio: 'Blames the mayor, compares to corruption elsewhere',
    sentiment: 'mixed',
    flags: ['sensitive-politics'],
    responses: [
      "Let's be honest about what's really going on here. The mayor's biggest campaign donor is the developer who stands to make millions from this rezoning. Does anyone else find that suspicious?",
      "This is exactly what happened in that scandal in the next county over — council members voting on projects where they had financial interests. I want to know who on this council has ties to the developers involved.",
      "I voted for better schools and roads, not for handing public land over to private developers at below-market rates. This feels like the kind of backroom deal that voters hate.",
      "The transparency here is terrible. Why were the developer meetings held behind closed doors? If this plan is so great, why wasn't the community involved from day one?",
      "I'm not saying anyone is corrupt. I'm saying the optics are bad and the process has not been transparent enough to build public trust. That's a governance failure."
    ],
  },
  {
    name: 'Resident with biased housing concerns',
    bio: 'Links new housing to demographic fears',
    sentiment: 'negative',
    flags: ['sensitive-discrimination'],
    responses: [
      "I'm concerned about who these new affordable units are going to attract. Our neighborhood has always been safe and quiet, and I've heard about what happens when you concentrate low-income housing.",
      "Look, I'm not trying to be insensitive but property crime goes up when you add Section 8 housing. That's just statistics. Has anyone looked at what happened in Riverside when they did this?",
      "My neighbors and I worked hard to buy in this neighborhood. We don't want to see it go downhill because someone decided to social engineer the demographics.",
      "I pay a lot in property taxes to live in a nice area. I don't think it's unreasonable to want some say in who's moving in next door.",
      "Can we at least get a commitment that the new housing will have the same standards? Same maintenance requirements, same HOA rules, same expectations for behavior?"
    ],
  },
  {
    name: 'Single mom, works two jobs',
    bio: 'Needs childcare and affordability, not luxury',
    sentiment: 'mixed',
    responses: [
      "I work two jobs and I'm raising two kids by myself. When I look at this plan, I don't see anything for people like me. I see luxury townhomes and fancy restaurants. Where's the daycare? Where's the affordable grocery store?",
      "The nearest childcare that I can actually afford is a 40-minute bus ride. If this plan added a subsidized childcare center, that alone would change my life and a lot of other parents' lives.",
      "I can barely make rent now. Every time something new gets built in this neighborhood, rents go up within a year. How do I know this plan won't push me out entirely?",
      "I don't need a wine bar or a yoga studio. I need a laundromat that's open past 8pm and a bus that runs on weekends. Can we please think about what working families actually need?",
      "I want my kids to grow up here. This is their school, their friends, their community. But if development means displacement, then it's not development — it's just pushing poor people somewhere else."
    ],
  },
  {
    name: 'Elderly resident with mobility issues',
    bio: 'Loves sidewalk improvements, wants accessibility',
    sentiment: 'positive',
    responses: [
      "I use a walker and the sidewalks on my block are a disaster. Cracked, uneven, tree roots pushing them up. The plan to rebuild sidewalks throughout the neighborhood would make a real difference for people like me.",
      "I want to mention ADA compliance. A lot of the curb cuts in this area don't meet current standards. If we're going to rebuild, let's do it right so everyone can get around safely.",
      "Bus shelters with benches and shade would be wonderful. I take the bus to my doctor's appointments and right now I stand in the sun waiting because there's nowhere to sit.",
      "I appreciate that someone is thinking about streetlights too. I don't go out after dark anymore because the lighting on Maple Street is terrible. I've tripped twice on broken pavement I couldn't see.",
      "This neighborhood has been good to me for 30 years. Making it accessible and safe for older residents — that's not just kind, it's practical. We're a growing part of the population."
    ],
  },
  {
    name: 'Disengaged teenager',
    bio: 'Dragged here by parent, minimal responses',
    sentiment: 'negative',
    flags: ['curt-detection'],
    responses: [
      "idk my mom made me come",
      "sure I guess",
      "whatever",
      "not really",
      "can I go now"
    ],
  },
  {
    name: 'Off-topic dog park enthusiast',
    bio: 'Only wants to talk about dog parks, ignores questions',
    sentiment: 'mixed',
    flags: ['off-topic-redirect'],
    responses: [
      "Before we talk about anything else, I want to bring up the dog park situation. We have ONE dog park for the entire east side and it's basically a mud pit. We need at least two more.",
      "I started a petition for a dog park on the vacant lot on Birch Street. We have 847 signatures. I have copies if anyone wants one. Dogs are family and they deserve proper recreation space.",
      "Did you know that neighborhoods with dog parks see a 12% increase in social cohesion? I read a study about it. It's not just about dogs — it's about community building.",
      "I don't really have opinions about the road stuff but PLEASE can someone address the dog waste stations? We need more of them and they need to actually be stocked with bags.",
      "Every other city our size has at least four dog parks. We have one. One! And it doesn't even have a separate area for small dogs. My Chihuahua is terrified."
    ],
  },
  {
    name: 'Spanish-speaking resident',
    bio: 'Starts English, switches to Spanish mid-conversation',
    sentiment: 'positive',
    flags: ['language-switch'],
    responses: [
      "I think the development plan is very good for our neighborhood. My family has lived here for twelve years and we want to see it grow.",
      "The community garden idea is beautiful. Many families in our area grow their own vegetables and having a dedicated space would bring everyone together.",
      "Me gustaría que el plan incluya más opciones de transporte público. Muchas familias aquí no tienen carro y dependen del autobús para ir al trabajo y llevar a los niños a la escuela.",
      "También necesitamos más señalización en español. Muchos de mis vecinos no hablan inglés y no entienden los avisos de construcción o los cambios en las rutas de tráfico.",
      "Gracias por escucharnos. Es importante que toda la comunidad tenga voz en estos cambios, no solo los que hablan inglés o los que tienen más dinero."
    ],
  },
  {
    name: 'Hostile/profane resident',
    bio: 'Escalating frustration, uses profanity',
    sentiment: 'negative',
    flags: ['content-safety'],
    responses: [
      "This whole plan is a joke. You're going to ruin this neighborhood just to line some developer's pockets. I've been to three of these meetings and nothing ever changes.",
      "Oh great, another 'community input session' where you pretend to listen and then do whatever the hell you were going to do anyway. What a waste of my time.",
      "The last 'improvement' project left my street torn up for eight months. Eight damn months! And the road is STILL worse than before they started. This is bullshit.",
      "You want my honest opinion? This plan is crap and everyone on that council knows it. They don't give a damn about us — they care about tax revenue and campaign donations.",
      "I'm done being polite about this. Fix the roads, lower my taxes, and stop building overpriced condos nobody can afford. That's it. That's the whole plan you need."
    ],
  },
]

// ── Simulator ──────────────────────────────────────────────────────────

interface Session { id: string; name: string; status: string; config: any; discussion_guide: any[]; participants: number; turns: number }
interface LogEntry { text: string; type: 'ok' | 'err' | 'info' | 'dim' }

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export default function TownHallSimulatorPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [count, setCount] = useState(20)
  const [turnsPerParticipant, setTurnsPerParticipant] = useState(4)
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

    addLog(`Session: "${session.name}" (${session.status})`, 'info')

    // Cap to available personas
    const participantCount = Math.min(count, PERSONAS.length)
    if (count > PERSONAS.length) addLog(`Capped to ${PERSONAS.length} scripted personas`, 'info')

    addLog(`Simulating ${participantCount} personas, up to ${turnsPerParticipant} turns each`, 'info')

    // Shuffle personas for variety
    const shuffled = [...PERSONAS].sort(() => Math.random() - 0.5).slice(0, participantCount)

    // Make sure session is active
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
      addLog(`   ${persona.bio}`, 'dim')

      // Detect if this persona switches language
      const isLanguageSwitcher = persona.flags?.includes('language-switch')

      // Join
      let turnNumber = 0
      let themeId: string | null = null
      try {
        const jr = await fetch('/api/townhall/join/' + selectedId, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: 'en' }),
        })
        const jd = await jr.json()
        if (jd.error) { addLog(`   Join failed: ${jd.error}`, 'err'); fail++; continue }
        turnNumber = jd.turn_number || 1
        themeId = jd.theme_id || null
      } catch (e) { addLog(`   Join failed: ${(e as Error).message}`, 'err'); fail++; continue }

      // Chat turns — use scripted responses in order
      const maxTurns = Math.min(turnsPerParticipant, persona.responses.length)
      for (let t = 0; t < maxTurns; t++) {
        if (stopRef.current) break

        const message = persona.responses[t]
        // Detect language for the Spanish switcher
        const isSpanish = isLanguageSwitcher && /[áéíóúñ¿¡]/.test(message)
        const lang = isSpanish ? 'es' : 'en'

        try {
          const cr = await fetch('/api/townhall/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_id: selectedId, participant_id: pid,
              message, turn_number: turnNumber, theme_id: themeId,
              skipped: false, language: lang,
            }),
          })
          const cd = await cr.json()
          const preview = message.length > 70 ? message.slice(0, 70) + '...' : message
          if (cd.is_final) {
            addLog(`   Turn ${t + 1}: "${preview}" → FINAL (${cd.source || '?'})`, 'ok')
            ok++; turnsDone++
            break
          }
          turnNumber = cd.turn_number
          themeId = cd.theme_id
          ok++
          addLog(`   Turn ${t + 1}: "${preview}" → ${cd.source || '?'}${isSpanish ? ' [ES]' : ''}`)
        } catch (e) {
          fail++
          addLog(`   Turn ${t + 1}: ERROR ${(e as Error).message}`, 'err')
        }

        turnsDone++
        setProgress({ done: turnsDone, total: totalTurns, ok, fail })

        // Delay between turns
        await sleep(200)
      }

      // Rate limit pause every 5 participants
      if ((p + 1) % 5 === 0 && p < participantCount - 1 && !stopRef.current) {
        addLog('Pausing for rate limit...', 'dim')
        await sleep(2000)
      }
    }

    addLog(`\nDone! ${ok} turns saved, ${fail} failed across ${participantCount} personas.`, 'info')
    setRunning(false)
  }, [selectedId, count, turnsPerParticipant, sessions, addLog])

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  const selected = sessions.find(s => s.id === selectedId)

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-800">Town Hall Simulator</h1>
            <p className="text-sm text-gray-500">20 scripted personas — city council development plan feedback</p>
          </div>
          <Link href="/admin/simulator" className="text-xs text-teal-600 hover:text-teal-800 font-medium">
            Survey Simulator →
          </Link>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
          {/* Session picker */}
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
                <span className="text-amber-600 ml-2">(session is {selected.status} — will need restart)</span>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Participants (max {PERSONAS.length})</label>
              <input type="number" value={count} onChange={e => setCount(parseInt(e.target.value) || 10)}
                min={1} max={PERSONAS.length}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Turns per Participant</label>
              <input type="number" value={turnsPerParticipant} onChange={e => setTurnsPerParticipant(parseInt(e.target.value) || 4)}
                min={1} max={5}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:outline-none" />
            </div>
          </div>

          {/* Persona preview */}
          <details className="mb-4">
            <summary className="text-xs font-semibold text-gray-500 cursor-pointer hover:text-gray-700">
              Preview personas ({PERSONAS.length} scripted)
            </summary>
            <div className="mt-2 max-h-60 overflow-y-auto border border-gray-100 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left px-3 py-1.5 text-gray-500 font-semibold">#</th>
                    <th className="text-left px-3 py-1.5 text-gray-500 font-semibold">Persona</th>
                    <th className="text-left px-3 py-1.5 text-gray-500 font-semibold">Sentiment</th>
                    <th className="text-left px-3 py-1.5 text-gray-500 font-semibold">Edge case</th>
                  </tr>
                </thead>
                <tbody>
                  {PERSONAS.map((p, i) => (
                    <tr key={i} className="border-t border-gray-50">
                      <td className="px-3 py-1 text-gray-400">{i + 1}</td>
                      <td className="px-3 py-1">
                        <span className="font-medium text-gray-700">{p.name}</span>
                        <span className="text-gray-400 ml-1">— {p.bio}</span>
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

