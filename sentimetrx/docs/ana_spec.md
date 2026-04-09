# Ana by Datanautix — Full System Specification & Server-Side Migration Guide

**Version:** Current as of March 2026  
**Purpose:** Complete technical handoff document. Covers (1) what the system is and does, (2) every technical detail of the current implementation, and (3) exact instructions for migrating from a client-side HTML file to a server-side application where proprietary code and API credentials are never exposed to the browser.

---

## PART 1 — WHAT TO SAY TO THE RECEIVING CLAUDE INSTANCE

Copy and paste this as your opening message:

---

> I need you to take a fully-functional single-file client-side web application called **Ana by Datanautix** and convert it into a proper server-side web application. The goal is to protect the proprietary source code and API keys from being exposed in the browser.
>
> I am attaching the current `textmine.html` file. Everything currently runs in the browser via Babel transpilation at runtime. Your job is to:
>
> 1. Set up a **Node.js + Express** server (or equivalent — see spec for options)
> 2. Move all Anthropic API calls to server-side proxy endpoints so the API key is never sent to the browser
> 3. Bundle the React JSX into proper compiled JavaScript using Vite or webpack so the source is minified and the Babel standalone CDN dependency is removed
> 4. Keep all data processing (CSV parsing, statistics, theme counting, filtering) on the client side — these are not secret and need to run fast against user-uploaded data that never leaves the browser
> 5. Serve the app as a Node.js web server with a clean build pipeline
>
> The full specification is in `ana_spec.md`. Read it completely before writing any code. It tells you exactly which functions to move to the server, the exact API request/response shapes, every dependency, every design token, and every behavioural rule.
>
> Work through this methodically:
> - Read the spec first
> - Set up the project structure
> - Create the server with proxy endpoints
> - Migrate the build system
> - Verify nothing is broken

---

## PART 2 — SYSTEM OVERVIEW

### What Ana Is

Ana by Datanautix is a **qualitative + quantitative analytics platform** that runs entirely in the browser. Users upload CSV/TSV/JSON survey or feedback data, configure a schema, apply thematic analysis (either AI-powered via Claude or from pre-built industry libraries), and explore results through four analysis tabs: Data, TextMine, Charts, and Statistics.

### What Makes It Proprietary

- The **industry theme libraries** (18 libraries, each with 8 hand-crafted themes, keywords, and descriptions) represent significant IP
- The **prompt engineering** for Claude API calls (theme mining, theme summaries, cross-group comparison, JSON auto-labelling)
- The **statistical engine** (pure-JS implementations of Welch's t-test, Mann-Whitney U, one-way ANOVA, chi-square, OLS regression, Shapiro-Wilk, Wilson confidence intervals, Pearson/Spearman correlation)
- The **theme-counting algorithm** with Wilson score confidence intervals

### Current Security Problem

The entire application — including all prompts, theme libraries, and business logic — ships as readable source inside `<script type="text/babel">` in a single HTML file. Anyone can open DevTools and read everything.

---

## PART 3 — CURRENT TECHNICAL ARCHITECTURE

### File Structure

Single file: `textmine.html` (~4,900 lines, ~400KB)

```
textmine.html
├── <head>  CDN script tags (React, ReactDOM, Babel, Plotly)
├── <style> Global CSS (keyframe animations: spin, blink, slidein, fadein)
└── <script type="text/babel">
    ├── Constants & config              (L1–L30)
    ├── Industry theme libraries        (L33–L182)   ← PROPRIETARY
    ├── Utilities & constants           (L224–L260)
    ├── callClaude() + API helpers      (L260–L400)  ← API KEY EXPOSED
    ├── ApiKeyModal component           (L300–L400)
    ├── Data parsing utilities          (L431–L545)
    ├── Statistical engine              (L549–L611)  ← PROPRIETARY
    ├── Derived field helpers           (L613–L685)
    ├── Filter engine                   (L688–L736)
    ├── UI primitives                   (L743–L750)
    ├── WordCloud component             (L753–L872)
    ├── SamplingControl component       (L875–L913)
    ├── ThemeEditor component           (L917–L1155)
    ├── BreakdownSelector component     (L1159–L1202)
    ├── CommentsPanel component         (L1206–L1377)
    ├── ExportModal component           (L1381–L1452)
    ├── BreakdownDist component         (L1456–L1641)
    ├── ThemePickerModal component      (L1645–L1736)
    ├── SourceDataTab component         (L1746–L2034)
    ├── SchemaTab component             (L2035–L2190)
    ├── Statistics panel components     (L2191–L2478)
    ├── TextMine helper functions       (L2479–L2570)
    ├── Chart infrastructure            (L2573–L3134)
    ├── 12 Chart components             (L3135–L3601)
    ├── ChartsTab wrapper               (L3603–L3663)
    ├── FiltersTab component            (L3667–L3951)
    ├── CompareTab component            (L3955–L4142)
    ├── UploadModal component           (L4146–L4275)
    └── App() root component            (L4279–end)
```

### CDN Dependencies

```html
React 18.2.0        https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js
ReactDOM 18.2.0     https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js
Babel 7.23.2        https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.2/babel.min.js
Plotly.js 2.26.0    https://cdnjs.cloudflare.com/ajax/libs/plotly.js/2.26.0/plotly.min.js
```

After migration: React/ReactDOM/Plotly become npm packages. Babel standalone is eliminated entirely (replaced by build-time compilation).

### Design System

```javascript
const T = {
  bg: "#f4f5f7",           // page background
  bgCard: "#ffffff",       // card background
  bgSidebar: "#ffffff",    // sidebar background
  border: "#e5e7eb",       // light border
  borderMid: "#d1d5db",    // medium border
  text: "#111827",         // primary text
  textMid: "#374151",      // secondary text
  textMute: "#6b7280",     // muted text
  textFaint: "#9ca3af",    // faint text
  accent: "#e8622a",       // primary orange (Ana brand)
  accentDark: "#c4501f",   // dark orange
  accentBg: "#fff4ef",     // orange tint background
  accentMid: "#fbd5c2",    // orange mid
  green: "#16a34a",
  greenBg: "#f0fdf4",
  greenMid: "#bbf7d0",
  red: "#dc2626",
  redBg: "#fef2f2",
  amber: "#d97706",
  amberBg: "#fffbeb",
  amberMid: "#fde68a",
  blue: "#2563eb",
  blueBg: "#eff6ff",
  purple: "#7c3aed",
  purpleBg: "#f5f3ff",
}
// NOTE: T.redMid does NOT exist — use T.red+"40" for transparent red
```

### Global CSS Animations

Must be preserved exactly:

```css
@keyframes spin   { from { transform: rotate(0deg) }  to { transform: rotate(360deg) } }
@keyframes blink  { 0%,100% { opacity: 0.2 } 50% { opacity: 1 } }
@keyframes fadein { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
.fadein  { animation: fadein 0.22s ease both }
.slidein { animation: fadein 0.18s ease both }
```

### Constants

```javascript
const CLAUDE_MODEL    = "claude-sonnet-4-20250514"
const DISCOVERY_ROWS  = 60      // max rows sent to Claude for theme discovery
const DISCOVERY_CHARS = 150     // max chars per response for discovery
const STORAGE_KEY     = "textmine_claude_api_key"
const STORAGE_AI_ON   = "textmine_ai_enabled"
const STORAGE_AI_MODE = "textmine_ai_mode"  // "auto" | "demand"
```

---

## PART 4 — THE FOUR CLAUDE API ENDPOINTS

This is the most security-critical section. All four calls currently go directly from the browser to `https://api.anthropic.com/v1/messages` with the API key in the request header. After migration, the browser calls your server, your server calls Anthropic.

### Endpoint 1: Theme Mining (`POST /api/mine-themes`)

**When triggered:** User clicks "⟡ Generate Themes with AI" in Data → Theme Model tab.

**Client sends to server:**
```json
{
  "fieldName": "feedback_text",
  "discoveryRows": [
    { "text": "The onboarding was confusing", "segment": "SMB", "region": "APAC" },
    ...
  ],
  "totalRows": 847,
  "samplePct": 0,
  "schemaContext": "id:id; feedback_text:open-ended; segment:categorical (SMB,Enterprise,Mid-Market); region:categorical (APAC,EMEA,NA)"
}
```

**Server-side system prompt:**
```
You are a qualitative research expert. Return ONLY raw JSON — no markdown, no backticks. Start with { and end with }.
```

**Server-side user message (constructed from received data):**
```
Thematic analysis on {N} responses (from {total} total) for field '{fieldName}'.

Schema: {schemaContext}

Responses:
1. The onboarding was confusing
2. Support team was very helpful
...

Identify 4-7 distinct themes. Return:
{"themes":[{"id":"t1","name":"Name","description":"One sentence.","keywords":["k1","k2","k3"],"sentiment":"positive","count":0,"percentage":0,"relatedThemes":[]}],"summary":"2-3 sentences.","fieldName":"{fieldName}"}
```

**Server returns to client:**
```json
{
  "themes": [...],
  "summary": "...",
  "fieldName": "feedback_text"
}
```

**Client then runs** `recountThemes(parsed.themes, fullData, fieldName)` locally against the complete dataset.

**max_tokens:** 4000  
**Timeout:** 55 seconds

---

### Endpoint 2: Theme Summary (`POST /api/summarise-theme`)

**When triggered:** User clicks on a theme card and AI summary is requested in the CommentsPanel.

**Client sends to server:**
```json
{
  "themeName": "Onboarding & Setup",
  "themeDescription": "Issues and experiences with the initial product setup process.",
  "matchedCount": 47,
  "comments": [
    "1. The setup wizard was really unclear",
    "2. Took me 3 days to figure out the API",
    ...
  ]
}
```

**Server-side system prompt:**
```
You are an expert qualitative researcher. Return ONLY raw JSON starting with { and ending with }.
```

**Server-side user message:**
```
Summarize these {matchedCount} comments about theme "{themeName}" ({themeDescription}).

Comments:
1. ...
2. ...

Return: {"headline":"1 punchy sentence max 15 words","summary":"3-4 sentence synthesis of what people are saying","sentiment":"positive|negative|mixed|neutral","keyQuotes":["verbatim short excerpt from one of the numbered comments above","verbatim short excerpt from another comment","verbatim short excerpt from a third comment"]}

IMPORTANT: keyQuotes must be verbatim short excerpts taken directly from the comments listed above — not paraphrases.
```

**Server returns to client:**
```json
{
  "headline": "...",
  "summary": "...",
  "sentiment": "mixed",
  "keyQuotes": ["...", "...", "..."]
}
```

**max_tokens:** 4000  
**Timeout:** 55 seconds

---

### Endpoint 3: Cross-Group Comparison (`POST /api/compare-groups`)

**When triggered:** User clicks "⟡ AI Compare" in TextMine → Compare tab.

**Client sends to server:**
```json
{
  "themeNames": ["Onboarding", "Support Quality", "Pricing"],
  "breakdownField": "segment",
  "groupSummaries": [
    {
      "group": "SMB",
      "texts": ["The onboarding took forever", "Pricing is great for small teams", ...]
    },
    {
      "group": "Enterprise",
      "texts": ["Integration was smooth", "Support team is excellent", ...]
    }
  ]
}
```

**Server-side system prompt:**
```
You are a qualitative research expert. Return ONLY raw JSON, no markdown, starting with { and ending with }.
```

**Server-side user message:**
```
Compare how these themes appear across groups.

Themes: ["Onboarding","Support Quality","Pricing"]

Groups (field: segment):
[{"group":"SMB","texts":[...]},{"group":"Enterprise","texts":[...]}]

Return: {"comparisons":[{"themeName":"x","insight":"sentence"}],"overallInsight":"sentence"}
```

**Server returns to client:**
```json
{
  "comparisons": [
    { "themeName": "Onboarding", "insight": "SMB users struggle significantly more than Enterprise with initial setup." }
  ],
  "overallInsight": "Enterprise segment reports consistently better experiences across all themes."
}
```

**max_tokens:** 4000  
**Timeout:** 55 seconds

---

### Endpoint 4: JSON Auto-Label (`POST /api/auto-label`)

**When triggered:** User pastes keyword arrays in ThemeEditor and clicks "⟡ Auto-label with AI".

**Client sends to server:**
```json
{
  "groups": [
    { "keywords": ["wait", "waiting", "appointment", "slow", "queue"] },
    { "keywords": ["doctor", "nurse", "staff", "friendly", "helpful"] }
  ]
}
```

**Server-side prompt (single user message, no system prompt needed):**
```
You are a qualitative research analyst. I have {N} groups of survey keywords. For each group generate: (1) a concise theme name (2-4 words), (2) a one-sentence description, (3) a sentiment (positive/negative/mixed/neutral).

Return ONLY a JSON array with no markdown:
[{"name":"Theme Name","description":"One sentence.","sentiment":"mixed"},...]

Keyword groups:
1. wait, waiting, appointment, slow, queue
2. doctor, nurse, staff, friendly, helpful
```

**Server returns to client:**
```json
[
  { "name": "Wait Times", "description": "Patient frustration with waiting periods.", "sentiment": "negative" },
  { "name": "Staff Warmth", "description": "Positive experiences with clinical staff interactions.", "sentiment": "positive" }
]
```

**max_tokens:** 1000  
**Timeout:** 30 seconds

---

### Endpoint 5: API Key Validation (`POST /api/validate-key`)

**When triggered:** User enters API key and clicks "Test & Save".

**Client sends:**
```json
{ "apiKey": "sk-ant-..." }
```

**Server:** Makes a minimal call to Anthropic with `max_tokens: 5`, message `"hi"`. Returns 200 if valid, 401 if invalid, 429 if quota exceeded.

**IMPORTANT:** In the server-side model, the API key can be stored server-side as an environment variable (`ANTHROPIC_API_KEY`) and never sent to clients at all. The UI key input modal becomes optional — if `ANTHROPIC_API_KEY` is set in the server environment, the client never needs to provide a key. If you want per-user keys (multi-tenant), the client still sends keys but they must be validated and never logged.

---

## PART 5 — WHAT STAYS CLIENT-SIDE

These functions contain no proprietary IP worth hiding, process user data that must not leave the browser, and need to run synchronously for UI responsiveness. **Keep them in the compiled client bundle:**

### Data Parsing
```javascript
parseCSV(text, delim)         // RFC-compliant CSV/TSV parser
parseJSON(text)               // strips markdown fences, then JSON.parse
```

### Schema Detection
```javascript
computeFieldStats(fieldName, values)   // detects open-ended/categorical/numeric/date/id/ignore
buildSchema(data)                       // runs computeFieldStats on all fields
recomputeForType(f, newType, data)      // recalculates field stats when user changes type
isDateLike(strVals)                     // 80% threshold date detection
parseDate(s)                            // date string normaliser
sortDates(vals)                         // date sort
```

### Data Transformation Pipeline
```javascript
applyDerivedFields(rows, derivedFields)      // age→group, YOB→generation etc
applyMappedFields(rows, catValueMaps)        // categorical → numeric mappings
applyFilters(rows, filters)                  // global filter application
```

### Theme Counting (runs on full dataset after AI returns themes)
```javascript
recountThemes(themes, fullRows, fieldName)   // Wilson CI, regex keyword matching
_kwRegex(kw)                                 // keyword regex builder (stem-aware)
highlightKeywords(text, keywords)            // JSX highlight spans
commentMatchesTheme(text, theme)             // per-comment theme test
```

### Statistics Engine (pure math, no proprietary IP)
```javascript
_mean, _variance, _std, _median, _quantile
_skewness, _kurtosis, _shapiroWilk
_pearsonR, _spearmanR, _rank
_welchTTest, _mannWhitneyU, _oneWayANOVA
_chiSquareStat, _invertMatrix, _olsRegression
_tDist2p, _fDistP, _chiSqP, _normCDF, _probit
_getNum(field, data)
```

### Sampling
```javascript
sampleSize95(N)           // Cochran formula, 95% CI, p=0.5, e=0.05
evenSample(arr, n)        // evenly-spaced reservoir sampling
prepareCorpusPct(...)     // builds discovery corpus at sampling percentage
```

### Derived Field Logic
```javascript
ageToGroup(age)           // age → "18-24", "25-34" etc
yobToGeneration(yob)      // year of birth → Gen Z, Millennial etc
detectAgeField(...)       // heuristic age field detector
```

### Export
```javascript
doExport(format, aliases, opts)   // CSV download, "datanautix ready" format
```

---

## PART 6 — WHAT MOVES TO THE SERVER (PROTECT THIS)

### Industry Theme Libraries (`INDUSTRY_THEMES`)

18 libraries. Each library has 8 themes. Each theme has: `id`, `name`, `description`, `keywords[]`, `sentiment`.

Libraries (alphabetical):
- Automotive Repair
- Casual Dining
- Education
- Fast Food
- Financial Services
- Fine Dining
- HR / Employee Experience
- Healthcare
- Higher Education
- Hospitality / Hotels
- Media / Entertainment
- Non-Profit / Charity
- Performing Arts / Venues
- Political Opinion Survey
- Retail / E-commerce
- SaaS / Software
- Sports
- Travel / Tourism

**New API endpoint needed:**
```
GET /api/industry-themes
```
Returns the full `INDUSTRY_THEMES` object. This is called once on app load and cached client-side in memory (not localStorage — so it's gone on page refresh, forcing another server fetch). No authentication required unless you want to gate access.

Alternatively, serve it as a separate JS bundle chunk that is **not** inlined in the HTML — it still loads but requires a separate HTTP request and cannot be easily scraped without running the app.

### Claude API Prompts

The four prompts detailed in Part 4. These live in the server-side route handlers only.

### The callClaude Wrapper

```javascript
// Currently (client-side, INSECURE):
async function callClaude(userMessage, systemPrompt, timeoutMs=55000) {
  const apiKey = getApiKey();  // from localStorage
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    headers: { "x-api-key": apiKey, ... }
  });
}

// After migration (server-side proxy):
// Client calls: POST /api/mine-themes (etc.)
// Server calls: POST https://api.anthropic.com/v1/messages
// API key: process.env.ANTHROPIC_API_KEY (never sent to browser)
```

---

## PART 7 — RECOMMENDED SERVER ARCHITECTURE

### Tech Stack

```
Backend:   Node.js 20+ with Express 4.x
Frontend:  React 18 + Vite 5 (build tool, replaces Babel standalone)
Charts:    Plotly.js 2.26.0 (npm package, not CDN)
API:       Anthropic SDK (@anthropic-ai/sdk) or raw fetch — either works
Auth:      Optional — start with IP-based or single shared key
Deploy:    Any Node host: Railway, Render, Fly.io, AWS EC2, DigitalOcean
```

### Project Structure

```
ana/
├── server/
│   ├── index.js               # Express app entry point
│   ├── routes/
│   │   └── ai.js              # All 5 AI proxy endpoints
│   └── data/
│       └── industryThemes.js  # INDUSTRY_THEMES object (server-only)
├── client/
│   ├── index.html             # Shell HTML (no Babel, no source)
│   ├── main.jsx               # React entry point
│   ├── App.jsx                # Root component
│   ├── components/            # All React components
│   │   ├── data/
│   │   │   ├── SourceDataTab.jsx
│   │   │   ├── SchemaTab.jsx
│   │   │   └── UploadModal.jsx
│   │   ├── textmine/
│   │   │   ├── ThemeEditor.jsx
│   │   │   ├── CommentsPanel.jsx
│   │   │   ├── CompareTab.jsx
│   │   │   ├── BreakdownDist.jsx
│   │   │   └── WordCloud.jsx
│   │   ├── charts/
│   │   │   ├── ChartsTab.jsx
│   │   │   ├── BarChart.jsx
│   │   │   ├── DistributionChart.jsx
│   │   │   ├── TimeSeriesChart.jsx
│   │   │   ├── TreemapChart.jsx
│   │   │   └── ... (12 chart components total)
│   │   ├── statistics/
│   │   │   ├── DescriptivesPanel.jsx
│   │   │   ├── CorrelationsPanel.jsx
│   │   │   ├── GroupTestsPanel.jsx
│   │   │   └── RegressionPanel.jsx
│   │   └── ui/               # Shared primitives (Card, Spinner, Badge etc.)
│   ├── lib/
│   │   ├── api.js             # Client-side fetch wrappers → server proxy
│   │   ├── stats.js           # Statistical engine (pure JS, client-side)
│   │   ├── themes.js          # recountThemes, _kwRegex, highlighting
│   │   ├── schema.js          # buildSchema, computeFieldStats, etc.
│   │   ├── filters.js         # applyFilters, applyDerivedFields
│   │   ├── csv.js             # parseCSV, parseJSON
│   │   └── constants.js       # T design tokens, THEME_PALETTE, etc.
│   └── vite.config.js
├── package.json
├── .env                       # ANTHROPIC_API_KEY=sk-ant-...
└── .env.example
```

### Server `index.js` Skeleton

```javascript
import express from 'express'
import { json } from 'express'
import { fileURLToPath } from 'url'
import path from 'path'
import aiRoutes from './routes/ai.js'

const app = express()
app.use(json({ limit: '10mb' }))  // large datasets in request body

// API routes (protected, server-side only)
app.use('/api', aiRoutes)

// Serve built frontend
const __dirname = path.dirname(fileURLToPath(import.meta.url))
app.use(express.static(path.join(__dirname, '../dist')))
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../dist/index.html'))
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(`Ana running on :${PORT}`))
```

### Server `routes/ai.js` Skeleton

```javascript
import Anthropic from '@anthropic-ai/sdk'
import { INDUSTRY_THEMES } from '../data/industryThemes.js'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// ── GET /api/industry-themes ──────────────────────────────────────────────
router.get('/industry-themes', (req, res) => {
  res.json(INDUSTRY_THEMES)
})

// ── POST /api/mine-themes ─────────────────────────────────────────────────
router.post('/mine-themes', async (req, res) => {
  const { fieldName, discoveryRows, totalRows, schemaContext } = req.body
  const corpusText = discoveryRows.map((r, i) => `${i+1}. ${r.text}`).join('\n')
  const userMsg = `Thematic analysis on ${discoveryRows.length} responses (from ${totalRows} total) for field '${fieldName}'.\n\nSchema: ${schemaContext}\n\nResponses:\n${corpusText}\n\nIdentify 4-7 distinct themes. Return:\n{"themes":[{"id":"t1","name":"Name","description":"One sentence.","keywords":["k1","k2","k3"],"sentiment":"positive","count":0,"percentage":0,"relatedThemes":[]}],"summary":"2-3 sentences.","fieldName":"${fieldName}"}`
  
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: 'You are a qualitative research expert. Return ONLY raw JSON — no markdown, no backticks. Start with { and end with }.',
      messages: [{ role: 'user', content: userMsg }]
    })
    const raw = msg.content.map(b => b.text || '').join('')
    const clean = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
    res.json(JSON.parse(clean))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/summarise-theme ─────────────────────────────────────────────
router.post('/summarise-theme', async (req, res) => {
  const { themeName, themeDescription, matchedCount, comments } = req.body
  const userMsg = `Summarize these ${matchedCount} comments about theme "${themeName}" (${themeDescription}).\n\nComments:\n${comments.join('\n')}\n\nReturn: {"headline":"1 punchy sentence max 15 words","summary":"3-4 sentence synthesis","sentiment":"positive|negative|mixed|neutral","keyQuotes":["verbatim excerpt","verbatim excerpt","verbatim excerpt"]}\n\nIMPORTANT: keyQuotes must be verbatim short excerpts from the comments above — not paraphrases.`
  
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: 'You are an expert qualitative researcher. Return ONLY raw JSON starting with { and ending with }.',
      messages: [{ role: 'user', content: userMsg }]
    })
    const raw = msg.content.map(b => b.text || '').join('')
    res.json(JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/compare-groups ──────────────────────────────────────────────
router.post('/compare-groups', async (req, res) => {
  const { themeNames, breakdownField, groupSummaries } = req.body
  const userMsg = `Compare how these themes appear across groups.\n\nThemes: ${JSON.stringify(themeNames)}\n\nGroups (field: ${breakdownField}):\n${JSON.stringify(groupSummaries)}\n\nReturn: {"comparisons":[{"themeName":"x","insight":"sentence"}],"overallInsight":"sentence"}`
  
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: 'You are a qualitative research expert. Return ONLY raw JSON, no markdown, starting with { and ending with }.',
      messages: [{ role: 'user', content: userMsg }]
    })
    const raw = msg.content.map(b => b.text || '').join('')
    res.json(JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/auto-label ──────────────────────────────────────────────────
router.post('/auto-label', async (req, res) => {
  const { groups } = req.body
  const groupsText = groups.map((g, i) => `${i+1}. ${g.keywords.join(', ')}`).join('\n')
  const prompt = `You are a qualitative research analyst. I have ${groups.length} groups of survey keywords. For each group generate: (1) a concise theme name (2-4 words), (2) a one-sentence description, (3) a sentiment (positive/negative/mixed/neutral).\n\nReturn ONLY a JSON array with no markdown:\n[{"name":"Theme Name","description":"One sentence.","sentiment":"mixed"},...]\n\nKeyword groups:\n${groupsText}`
  
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    })
    const raw = msg.content.map(b => b.text || '').join('')
    res.json(JSON.parse(raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ── POST /api/validate-key ────────────────────────────────────────────────
// Optional — only needed if supporting user-supplied keys (multi-tenant mode)
router.post('/validate-key', async (req, res) => {
  const { apiKey } = req.body
  try {
    const client = new Anthropic({ apiKey })
    await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 5,
      messages: [{ role: 'user', content: 'hi' }]
    })
    res.json({ valid: true })
  } catch (e) {
    res.status(401).json({ valid: false, error: e.message })
  }
})
```

### Client `lib/api.js` (replaces all direct Anthropic fetch calls)

```javascript
// All calls now go to your own server, not Anthropic directly
// The browser never sees an API key

export async function mineThemes({ fieldName, discoveryRows, totalRows, schemaContext }) {
  const res = await fetch('/api/mine-themes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fieldName, discoveryRows, totalRows, schemaContext })
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function summariseTheme({ themeName, themeDescription, matchedCount, comments }) {
  const res = await fetch('/api/summarise-theme', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ themeName, themeDescription, matchedCount, comments })
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function compareGroups({ themeNames, breakdownField, groupSummaries }) {
  const res = await fetch('/api/compare-groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ themeNames, breakdownField, groupSummaries })
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function autoLabel({ groups }) {
  const res = await fetch('/api/auto-label', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groups })
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export async function fetchIndustryThemes() {
  const res = await fetch('/api/industry-themes')
  if (!res.ok) throw new Error('Failed to load industry themes')
  return res.json()
}
```

---

## PART 8 — UI COMPONENT INVENTORY (COMPLETE)

All components to migrate, with their props signatures:

### Navigation Components

```
TopBar
  props: topTab, setTopTab, hasData, themesOk, aiEnabled, apiKey,
         onToggleAI, onOpenKey, filters, schema, columnAliases,
         onOpenFilters, visitedTabs

SubTabBar
  props: topTab, subTab, setSubTab, hasData, themesOk
```

### Data Tab Components

```
SourceDataTab
  props: activeSubTab, onNavigate, hasData, parsedData, schema,
         schemaEdited, openFields, activeField, setActiveField,
         samplePct, setSamplePct, lastRunPct, themeSource, themeLibName,
         themes, loading, error, onMineThemes, onOpenKey, onOpenThemeEditor,
         onRerunCounts, aiActive, onNavigateToThemes, checkedInds,
         setCheckedInds, applyCheckedInds, columnAliases, toggleInd,
         onApplyIndustry, industryThemes [NEW — was INDUSTRY_THEMES constant]

SchemaTab
  props: schema, onTypeChange, scoreFields, onToggleScore,
         columnAliases, setAlias, catValueMaps, setCatValueMaps,
         derivedFields, setDerivedFields, hideHeader

UploadModal
  props: onLoad, onClose

ExportModal
  props: exportFields, activeField, schema, columnAliases,
         onClose, onExport

ThemeEditor
  props: onApply, onClose, apiKey, industryThemes [NEW]
```

### TextMine Tab Components

```
WordCloud
  props: themes, themeColors, parsedData, activeField, onWordClick

SamplingControl
  props: samplePct, setSamplePct, parsedData, activeField,
         lastRunPct, onRerun, themeSource

CommentsPanel
  props: theme, allThemes, parsedData, activeField, catFields,
         themeColors, schema, columnAliases, ignoredFields,
         breadcrumb, setBreadcrumb, origin, setOrigin

BreakdownDist
  props: themes, parsedData, activeField, breakdownField,
         selectedValues, schema, columnAliases, aliases, themeColors

CompareTab
  props: themes, parsedData, schema, breakdownField, setBreakdownField,
         aliases, themeColors, apiKey [for AI compare — now server proxy]

ThemePickerModal
  props: schema, apiKey, aiActive, onPickAI, onPickIndustry, onClose
```

### Statistics Tab Components

```
DescriptivesPanel
  props: schema, filteredData, selField, setSelField

CorrelationsPanel
  props: schema, filteredData, corrType, setCorrType, selCell, setSelCell

GroupTestsPanel
  props: schema, filteredData, testType, setTestType,
         numF, setNumF, catF, setCatF, catF2, setCatF2

RegressionPanel
  props: schema, filteredData, outcome, setOutcome,
         predictors, setPredictors
```

### Charts Tab Components (12 charts)

```
ChartsTab          props: filteredData, schema, columnAliases, themes, activeChart, setActiveChart
BarChart           props: data, schema, aliases
DistributionChart  props: data, schema, aliases
ScatterChart       props: data, schema, aliases
CrosstabChart      props: data, schema, aliases
TimeSeriesChart    props: data, schema, aliases, themes
TreemapChart       props: data, schema, aliases
BubbleChart        props: data, schema, aliases
WaterfallChart     props: data, schema, aliases
BulletChart        props: data, schema, aliases
FunnelChart        props: data, schema, aliases
GanttChart         props: data, schema, aliases
NPSDriverChart     props: data, schema, aliases, themes
```

### Shared UI Primitives

```
Card({children, style})
MiniBar({label, value, max, color, subtitle})
Spinner({color})
Badge({label, color, bg, border})
SectionLabel({children})
OrangeBtn({children, onClick, disabled, style})
BottomLine({text})
SigBadge({p})
StatRow({label, value, sub})
StatPanelHeader({icon, title, desc})
StatsEmpty({icon, msg, sub})
FieldPill({label, active, onClick})
DSSelect({label, value, onChange, options, style})
DSChart (Plotly wrapper — renders inside fixed-height div)
ChartSelect({label, value, onChange, options})
ChartToggle({value, onChange, options})
EmptyChart({msg})
StatChip({label, value})
CompareBar({label, labelPct, count, share, maxShare, color, labelColor, isUnclassified, sig, themeName, groupLabel, onBarClick})
```

---

## PART 9 — APP-LEVEL STATE (COMPLETE INVENTORY)

All state lives in `App()`. No Redux/Zustand — pure React useState/useRef/useMemo/useCallback.

```javascript
// Data
parsedData          useState([])         // raw uploaded rows
schema              useState([])         // field definitions
hasData             useState(false)
schemaEdited        useState(false)
rawText             useState("")          // paste textarea content
derivedFields       useState([])         // age→group, YOB→gen configs
catValueMaps        useState({})         // categorical→numeric mappings
columnAliases       useState({})         // display name overrides
scoreFields         useState(new Set())  // fields used as score drivers

// API / AI
apiKey              useState(getApiKey)  // from localStorage
aiEnabled           useState(getAiEnabled)
aiMode              useState(getAiMode)  // "auto" | "demand"
showApiKeyModal     useState(false)

// Theme model
activeField         useState(null)       // currently active open-ended field
themes              useState(null)       // {themes:[], summary:"", fieldName:""}
themeSource         useState(null)       // "ai" | "industry" | null
themeLibName        useState(null)       // e.g. "Healthcare"
samplePct           useState(0)          // 0=auto, 1-100=manual
lastRunPct          useState(null)
samplingInfo        useState(null)       // {sampled:N, total:M}
loading             useState(false)
loadingDetail       useState(false)
error               useState(null)

// TextMine navigation
selectedTheme       useState(null)
themeDetail         useState(null)
drillTheme          useState(null)
breakdownField      useState(null)
selectedValues      useState(new Set())

// Industry library selection
checkedInds         useState(new Set())

// Navigation
topTab              useState("data")
subTabs             useState({data:"data",textmine:"themes",charts:"charts",statistics:"descriptives"})

// Persisted sub-panel state (survives tab switches)
themesView          useState("distribution")
chartType           useState("bar")        // active chart in Charts tab
commentsBreadcrumb  useState([])
commentsOrigin      useState("themes")
descSel             useState(null)
corrType            useState("pearson")
corrSelCell         useState(null)
groupTestType       useState("auto")
groupNumF           useState("")
groupCatF           useState("")
groupCatF2          useState("")
regrOutcome         useState(null)
regrPredictors      useState(new Set())

// Modals
showUploadModal     useState(false)
showThemeEditor     useState(false)
showExportModal     useState(false)
showFiltersModal    useState(false)

// Filters
filters             useState({})

// Lazy filter refresh
visitedSinceFilter  useState(new Set())
pendingFilterData   useState(null)

// Refs
schemaRef           useRef(schema)           // always-current schema
samplePctRef        useRef(samplePct)        // always-current sample pct
breakdownRef        useRef({field,values})   // always-current breakdown
filteredDataSnapshotRef useRef(filteredData) // snapshot before filter change
prevThemesOk        useRef(false)            // for auto-navigate to themes
```

---

## PART 10 — CRITICAL IMPLEMENTATION RULES

These are non-obvious behaviours discovered through extensive debugging. The receiving Claude instance must respect all of them.

### Theme Counting — NO Global Regex Flag

```javascript
// WRONG — global flag causes lastIndex bug, gives count=0 after first test()
const regex = new RegExp(pattern, 'gi')  // NEVER use 'g' in recountThemes

// CORRECT — use 'i' flag only, rebuild regex for each row
const regex = new RegExp(pattern, 'i')
rows.forEach(row => regex.test(row))  // works correctly
```

### Keyword Regex Pattern (Stem-Aware)

```javascript
function _kwRegex(kw) {
  const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('(?<![a-z])' + esc + '\\w*', 'gi')  // 'g' ok here for highlighting
}
```

### CompareBar: share and maxShare Must Use Same Units

```javascript
// In themes distribution view:
//   share = pctFrac (0.0–1.0), maxShare = 1
// In compare group view:
//   share = count/groupTotal * 100, maxShare = max(share across all themes in group)
// NEVER mix count/totalMatches with count/groupTotal
```

### THEME_PALETTE Keys

```javascript
// Keys are: bg, border, text, light
// pal.bar DOES NOT EXIST — use pal.border for bar/dot colour
// pal.bg for background, pal.text for label colour, pal.light for subtle fill
```

### Treemap: branchvalues:"remainder"

Do NOT use `branchvalues:"total"` — the parent node value must be ≥ sum of children, which breaks when using `agg()` values. Use `branchvalues:"remainder"`.

### filteredData Pipeline Order

```javascript
const withDerived = applyDerivedFields(parsedData, derivedFields)
const withMapped  = applyMappedFields(withDerived, catValueMaps)
const result      = applyFilters(withMapped, filters)
```

### Schema State Declaration Order

`catValueMaps` useState MUST be declared BEFORE `effectiveScoreFields` useMemo.

### handleTypeChange — Preserve Themes

Only clear themes if the type change leaves zero open-ended fields remaining:

```javascript
const handleTypeChange = (fieldName, newType) => {
  const newSchema = schemaRef.current.map(f =>
    f.field === fieldName ? recomputeForType(f, newType, parsedData) : f
  )
  setSchema(newSchema)
  setSchemaEdited(true)
  if (newType !== 'open-ended') {
    const remainingOpen = newSchema.filter(f => f.type === 'open-ended')
    if (remainingOpen.length === 0) {
      setThemes(null)
      setSamplingInfo(null)
      setSelectedTheme(null)
      setThemeDetail(null)
      setDrillTheme(null)
    }
  }
}
```

### Navigation Functions

```javascript
// ALWAYS use:
handleTopTab(id)   // switches top tab
handleSubTab(id)   // switches sub tab within current top tab
navigateTo(top, sub)  // switches both

// NEVER directly call:
setTopTab()        // bypasses visited-tab tracking
setSubTabs()       // same problem
```

### Lazy Filter Refresh

Tabs only receive updated `filteredData` after they've been visited since the last filter change. This prevents stale chart re-renders in background tabs:

```javascript
const getFilteredDataForTab = (topTab, subTab) => {
  const key = topTab + "." + subTab
  if (visitedSinceFilter.has(key)) return filteredData
  return filteredDataSnapshotRef.current
}
```

### INDUSTRY_THEMES After Migration

`INDUSTRY_THEMES` is no longer a client-side constant. It must be fetched from `/api/industry-themes` on app load and stored in component state. Pass it as a prop to `SourceDataTab`, `ThemeEditor`, and `ThemePickerModal`. Remove the `const INDUSTRY_THEMES = {...}` from the client bundle entirely.

```javascript
// In App.jsx
const [industryThemes, setIndustryThemes] = useState({})
useEffect(() => {
  fetch('/api/industry-themes').then(r => r.json()).then(setIndustryThemes)
}, [])
```

### Age/Generation Constants

These stay client-side (not proprietary):

```javascript
const AGE_GROUP_ORDER = ["Under 18","18–24","25–34","35–44","45–54","55–64","65+"]
const GEN_ORDER = ["Silent Gen (pre-1946)","Boomers (1946–1964)","Gen X (1965–1980)",
                   "Millennials (1981–1996)","Gen Z (1997–2012)","Gen Alpha (2013+)"]
```

### sortOpts Helper (Keep in Client)

```javascript
function sortOpts(options) {
  const TOP = ["none","count","all","","_all_"]
  const top = options.filter(o => TOP.includes(String(o.v || "")))
  const rest = options.filter(o => !TOP.includes(String(o.v || "")))
                      .slice().sort((a,b) => String(a.l||"").localeCompare(String(b.l||"")))
  return top.concat(rest)
}
```

---

## PART 11 — BUILD SYSTEM MIGRATION

### vite.config.js

```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../dist',
    sourcemap: false,    // IMPORTANT: no sourcemaps in production (hides code)
    minify: 'terser',
    terserOptions: {
      compress: { drop_console: true },
      mangle: { toplevel: true }    // aggressively rename variables
    }
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000'   // dev: proxy API calls to Express
    }
  }
})
```

### package.json

```json
{
  "name": "ana-datanautix",
  "type": "module",
  "scripts": {
    "dev:server": "node --watch server/index.js",
    "dev:client": "cd client && vite",
    "build": "cd client && vite build",
    "start": "node server/index.js"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.24.0",
    "express": "^4.18.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "plotly.js": "^2.26.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.0.0",
    "vite": "^5.0.0",
    "terser": "^5.0.0"
  }
}
```

---

## PART 12 — THE API KEY MODAL (HOW TO HANDLE)

### Option A: Server holds the key (recommended for single-tenant/own use)

Set `ANTHROPIC_API_KEY` in server `.env`. Remove the ApiKeyModal component entirely. The AI toggle becomes a simple on/off switch. No key management needed in the UI.

### Option B: Per-user keys (multi-tenant)

Keep ApiKeyModal. Client sends key as `Authorization: Bearer sk-ant-...` header on every `/api/*` request. Server reads `req.headers.authorization`, strips `Bearer `, uses that key for the Anthropic call. Never store user keys server-side. User manages their own key in localStorage as before.

### Option C: Session-based (middle ground)

Client POSTs key once to `/api/set-key`, server stores in express-session. All subsequent `/api/*` calls use session key. Good for shared deployments where you want to authenticate users first.

---

## PART 13 — DATA FLOW DIAGRAM

```
USER BROWSER                          YOUR SERVER              ANTHROPIC
─────────────────────────────────────────────────────────────────────────
[Upload CSV/TSV/JSON]
    → parseCSV() [client]
    → buildSchema() [client]
    → filteredData pipeline [client]

[Click "Generate Themes with AI"]
    → prepareCorpusPct() [client]    POST /api/mine-themes
    → discovery rows built           → construct prompt
                                     → POST /v1/messages →
                                     ←  JSON themes       ←
    ← themes object received
    → recountThemes() [client]       (full dataset counted locally)
    → setThemes() [client]

[Click theme for AI summary]
    → collect matched comments       POST /api/summarise-theme
    → send 60 comments               → construct prompt
                                     → POST /v1/messages →
                                     ← summary JSON       ←
    ← summary rendered

[Compare Groups]
    → build group text samples       POST /api/compare-groups
                                     → construct prompt
                                     → POST /v1/messages →
                                     ← comparison JSON    ←
    ← insights rendered

[Auto-label JSON keywords]
    → keyword groups                 POST /api/auto-label
                                     → construct prompt
                                     → POST /v1/messages →
                                     ← labels JSON        ←
    ← editable table populated

[ALL STATISTICS]
    → runs entirely client-side      (no server call)
    → _welchTTest, _anovaBL etc

[ALL CHARTS]
    → Plotly.newPlot() client-side   (no server call)

[Export CSV]
    → generates Blob client-side     (no server call)
    → browser download link

[Industry Themes load]
                                     GET /api/industry-themes
                                     ← INDUSTRY_THEMES object
    ← stored in App state
    → passed as props to ThemeEditor, SourceDataTab
```

---

## PART 14 — SECURITY CHECKLIST

After migration, verify:

- [ ] No `anthropic-dangerous-direct-browser-access` header anywhere in client code
- [ ] No API key in any client-side file or localStorage (Option A)
- [ ] `INDUSTRY_THEMES` only in `server/data/industryThemes.js`, not in any client bundle
- [ ] Build produces minified/mangled output (check `dist/assets/*.js` — should be unreadable)
- [ ] No source maps in production build (`sourcemap: false` in vite config)
- [ ] Server adds `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` headers
- [ ] Rate limiting on `/api/*` endpoints (use `express-rate-limit`)
- [ ] Input size limits enforced (reject `discoveryRows.length > 100`, etc.)
- [ ] `.env` is in `.gitignore`
- [ ] `dist/` is in `.gitignore` (build artefacts, not source)

---

## PART 15 — WHAT NOT TO CHANGE

The receiving Claude must preserve these exactly:

1. **All visual design** — every hex colour in the T object, every border-radius, every font size
2. **THEME_PALETTE** — 8 entries with exact colours for `bg`, `border`, `text`, `light` keys
3. **Wilson score confidence intervals** in `recountThemes`
4. **The four-tab navigation structure** — Data / TextMine / Charts / Statistics
5. **The sub-tab structure** — Data→(Data/Schema/Theme Model), TextMine→(Themes/Theme Clouds/Comments/Compare), Statistics→(Descriptives/Correlations/Group Tests/Regression)
6. **Lazy filter refresh** pattern — tabs only get updated data after being visited post-filter-change
7. **Schema preservation on type change** — themes survive schema edits unless zero open-ended fields remain
8. **All 18 industry theme libraries** — must be served identically from the server
9. **All 12 chart types** — exact same Plotly configurations
10. **The "Datanautix Ready" export format** — the CSV format with Prompt column
11. **All statistical test implementations** — do not replace with third-party libraries

---

## PART 16 — FIELD TYPE COMPATIBILITY (SURVEY BUILDER INTEGRATION)

Ana is designed to analyse data exported from survey tools. If a companion survey builder is generating the data that Ana will analyse, the survey builder must tag each question with one of Ana's 6 field types so exported data loads cleanly without requiring manual schema correction.

### The 6 Field Types and Their Survey Equivalents

| Ana Type | Survey Question Examples | Notes |
|----------|--------------------------|-------|
| **open-ended** | "Describe your experience", "Any other comments?", long free-text boxes | The field targeted for thematic analysis. Must be present for TextMine tab to unlock. |
| **categorical** | Multiple choice, dropdowns, yes/no, Likert label scales (Agree/Disagree), rating labels | Discrete text labels. Can be mapped to numeric in Ana's Schema tab (e.g. "Low/Med/High" → 1/2/3). |
| **numeric** | NPS (0–10), star ratings (1–5), age input, salary, any number input | Actual numbers that can be averaged, correlated, or regressed. |
| **date** | "When did you last visit?", submission timestamp, appointment date | Used in Time Series charts. Ana accepts most common date formats. |
| **id** | Respondent ID, submission reference, session token | Excluded from all analysis automatically. |
| **ignore** | Internal routing fields, metadata not meant for analysis | Hidden from all analysis panels. |

### Critical Distinction: categorical vs numeric

A 1–5 star rating stored as the **number** `3` → tag as `numeric` (can be averaged, used in regression).  
A 1–5 star rating stored as the **text** `"3 stars"` → tag as `categorical` (Ana can map it to numeric in the Schema tab, but it costs a step).

Where possible, the survey builder should export numeric scales as actual numbers, not label strings.

### Recommended Export Format

The cleanest handoff is a CSV where:
- Each column is one survey question/field
- The first row is the column header (field name or short label)
- If the survey builder can emit a **companion schema file** (JSON) alongside the CSV, Ana can skip auto-detection entirely:

```json
{
  "fields": [
    { "field": "respondent_id",   "type": "id" },
    { "field": "submitted_at",    "type": "date" },
    { "field": "segment",         "type": "categorical" },
    { "field": "nps_score",       "type": "numeric" },
    { "field": "feedback_text",   "type": "open-ended" },
    { "field": "routing_flag",    "type": "ignore" }
  ]
}
```

If a companion schema file is provided, the server-side migration should accept it as an optional second upload and use it to pre-populate the schema state, bypassing `buildSchema()` auto-detection.

### Ana's Auto-Detection Heuristics (fallback when no schema file)

If no schema file is provided, Ana infers field types from the data:

- **open-ended**: average string length > 30 chars OR high uniqueness ratio with long values
- **categorical**: few distinct values relative to total row count
- **numeric**: ≥80% of non-null values parse as valid numbers
- **date**: ≥80% of non-null values parse as recognisable date strings (`isDateLike()`)
- **id**: very high uniqueness (near 100% distinct) but values are short/numeric
- **ignore**: not auto-assigned — only set manually by the user

Users can always override any auto-detected type in Ana's Schema tab.

---

*End of specification. Total: ~4,900 lines of application code being migrated. Estimated migration effort: 1–2 Claude sessions of focused work with the HTML file as reference.*
