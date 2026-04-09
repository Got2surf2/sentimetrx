# Psychographic Profiling — Data Dictionary & Integration Guide

**File:** `psychographic_profiling_mobile_v4.json`  
**Version:** 4.0  
**Last updated:** 2025  
**Purpose:** Mobile-optimised psychographic profiling questions across 18 industries, designed for use in survey flows, onboarding sequences, audience segmentation tools, and CRM enrichment pipelines.

---

## 1. File Structure Overview

The file is a single JSON object with one root key containing an array of industry objects. Each industry object contains a flat array of question objects. There is no pagination, versioning, or nesting beyond three levels.

```
root object
└── psychographic_profiling  (Array)
    └── industry object  (Object, one per industry)
        ├── industry  (String)
        └── questions  (Array)
            └── question object  (Object)
                ├── prompt  (String)
                └── responses  (Array of Strings)
```

---

## 2. Schema Definition

### 2.1 Root Object

| Field | Type | Required | Description |
|---|---|---|---|
| `psychographic_profiling` | `Array<IndustryObject>` | Yes | Top-level array. Contains one entry per industry. |

### 2.2 IndustryObject

| Field | Type | Required | Description |
|---|---|---|---|
| `industry` | `String` | Yes | Human-readable industry label. Used as the primary grouping and display key. See Section 4 for the full list of valid values. |
| `questions` | `Array<QuestionObject>` | Yes | Ordered array of question objects for this industry. Order reflects recommended presentation sequence — do not shuffle without review (see Section 6.2). |

### 2.3 QuestionObject

| Field | Type | Required | Description |
|---|---|---|---|
| `prompt` | `String` | Yes | The question text shown to the respondent. Mobile-optimised: all prompts are under 65 characters. Written in second person. No trailing question mark on some prompts by design (conversational tone). |
| `responses` | `Array<String>` | Yes | Exactly 4 response options. Always mutually exclusive. Each response begins with one or more emoji followed by a space, then the response label. See Section 3 for the response format specification. |

### 2.4 TypeScript Interface

```typescript
interface PsychographicLibrary {
  psychographic_profiling: Industry[];
}

interface Industry {
  industry: string;
  questions: Question[];
}

interface Question {
  prompt: string;
  responses: string[];  // Always length 4
}
```

### 2.5 JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["psychographic_profiling"],
  "properties": {
    "psychographic_profiling": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["industry", "questions"],
        "properties": {
          "industry": {
            "type": "string",
            "minLength": 1
          },
          "questions": {
            "type": "array",
            "minItems": 1,
            "items": {
              "type": "object",
              "required": ["prompt", "responses"],
              "properties": {
                "prompt": {
                  "type": "string",
                  "minLength": 1
                },
                "responses": {
                  "type": "array",
                  "minItems": 4,
                  "maxItems": 4,
                  "items": { "type": "string", "minLength": 1 }
                }
              },
              "additionalProperties": false
            }
          }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}
```

---

## 3. Response Format Specification

Every response string follows a consistent two-part format:

```
{emoji_prefix}  {label_text}
```

The emoji prefix and label text are always separated by a single space.

### 3.1 Response Patterns

Four distinct patterns are used depending on the question type. Your system should be able to identify the pattern from the emoji prefix alone.

**Pattern A — Categorical (distinct options with no implied order)**

Used for: opinion, preference, behaviour-style questions.  
Format: single descriptive emoji + label + optional em-dash clarification.

```
"🔧 A useful tool — leverage is part of building wealth"
"🚫 Something to minimise and eliminate as fast as possible"
```

**Pattern B — Ordinal scale (intensity, frequency, or importance)**

Used for: "how often", "how much", "how important" questions.  
Format: coloured circle emoji sequence (🔴🟡🟠🟢) where 🔴 = lowest/least and 🟢 = highest/most.

```
"🔴 Rarely or never"
"🟡 1–3 times"
"🟠 4–9 times"
"🟢 10+ times"
```

**Pattern C — Star rating (importance or priority levels)**

Used for: "how important is X" questions.  
Format: repeating ⭐ (1–3 stars = low to high) or 🚫 for the "not at all" option.

```
"⭐⭐⭐ Very — prestige opens doors"
"⭐⭐ Moderate — outcomes matter more"
"⭐ Minimal — I focus on programme quality"
"🚫 Not important — prestige is overrated"
```

**Pattern D — Sentiment/trust scale**

Used for: trust, confidence, institutional attitude questions.  
Format: coloured circle emoji (💚🟡🟠🔴) where 💚 = positive/high trust and 🔴 = negative/low trust.

```
"💚 High — most institutions act in good faith"
"🟡 Selective — I trust on a case-by-case basis"
"🟠 Low — I'm skeptical of most"
"🔴 Very low — I believe most are broken"
```

### 3.2 Parsing Responses

To strip the emoji prefix and return only the label text, split on the first space that follows the final emoji character in the prefix cluster. A reliable approach is to find the index of the first alphabetic character (A–Z, a–z) after position 0 and slice from there.

```javascript
// JavaScript — extract label from response string
function extractLabel(response) {
  const match = response.match(/[A-Za-z]/);
  return match ? response.slice(match.index).trim() : response;
}

// Examples:
extractLabel("🔴 Rarely or never")         // → "Rarely or never"
extractLabel("⭐⭐⭐ Very — prestige opens") // → "Very — prestige opens"
extractLabel("💚 High — most act in good") // → "High — most act in good"
```

```python
# Python — extract label from response string
import re

def extract_label(response: str) -> str:
    match = re.search(r'[A-Za-z]', response)
    return response[match.start():].strip() if match else response
```

### 3.3 Extracting the Scale Type

```javascript
function getScaleType(responses) {
  const first = responses[0];
  if (first.startsWith('🔴')) return 'ordinal';
  if (first.startsWith('💚')) return 'sentiment';
  if (first.startsWith('⭐') || first.startsWith('🚫')) return 'star_rating';
  return 'categorical';
}
```

---

## 4. Industry Reference

The file contains 18 industries in the following order. The `industry` field value must be matched exactly (case-sensitive) when referencing or filtering.

| Index | `industry` value | Question count | Life stage anchor |
|---|---|---|---|
| 0 | `Healthcare` | 11 | Yes |
| 1 | `Hospitality (Hotel / Lodging)` | 10 | Yes |
| 2 | `Restaurants — Casual Dining` | 10 | Yes |
| 3 | `Restaurants — Fine Dining` | 10 | No |
| 4 | `Restaurants — Fast Food / Quick Service` | 10 | Yes |
| 5 | `Travel & Tourism` | 11 | Yes |
| 6 | `Politics & Advocacy` | 9 | No |
| 7 | `Entertainment — Media & Film` | 10 | No |
| 8 | `Entertainment — Performing Arts & Venues` | 9 | No |
| 9 | `SaaS / Software` | 11 | No |
| 10 | `Retail / E-commerce` | 11 | Yes |
| 11 | `Financial Services` | 11 | Yes |
| 12 | `Education (K-12)` | 10 | No |
| 13 | `Higher Education` | 10 | No |
| 14 | `HR / Employee Experience` | 10 | No |
| 15 | `Sports` | 10 | No |
| 16 | `Non-Profit / Charity` | 10 | No |
| 17 | `Automotive Repair` | 10 | No |

**Life stage anchor** — industries marked `Yes` have a standardised household/life stage question as their first question (index 0). This question is identical across all anchored industries and should be treated as a shared cross-industry segmentation variable (see Section 6.3).

---

## 5. Key Design Decisions Your System Should Know

### 5.1 Fixed response count of 4

Every question has exactly 4 responses. This is intentional: 4 options prevent fence-sitting (no midpoint), fit cleanly on a mobile screen without scrolling, and map well to a 2-bit encoding if your system stores selections compactly. Do not add or remove responses without re-validating MECE coverage for that question.

### 5.2 MECE design

Response sets are designed to be **mutually exclusive and collectively exhaustive** for the target population. A respondent should always be able to identify with exactly one option. If your system allows multi-select, flag this as a deviation from the intended design — it will produce ambiguous segmentation outputs.

### 5.3 No unique IDs in source file

The source file does not include question or response IDs. When importing into your library, your system must generate and persist stable IDs. The recommended approach is to derive IDs deterministically from content hashes so they survive re-imports (see Section 6.1).

### 5.4 Question ordering is deliberate

Within each industry, questions follow a logical funnel:
- **Segmentation anchors first** (life stage, role, insurance type, company size, vehicle type) — these are filtering variables that contextualise everything that follows
- **Behavioural and attitudinal questions mid-set** — frequency, channel, preference
- **Values and identity questions last** — these are higher-cost cognitive questions placed after rapport is established

Randomising question order will degrade data quality for downstream segmentation.

### 5.5 Mobile-first constraints

All prompts are under 65 characters. All response labels are under 55 characters. Do not truncate further. If your UI requires shorter strings, extract the portion before the em-dash (`—`) as the short label and use the full string as the tooltip or expanded view.

```javascript
function shortLabel(response) {
  const label = extractLabel(response);
  const dashIndex = label.indexOf(' — ');
  return dashIndex > -1 ? label.slice(0, dashIndex) : label;
}

// "🔍 Proactive — regular checkups" → "Proactive"
// "🚫 Currently uninsured"          → "Currently uninsured"
```

---

## 6. Integration Guide

### 6.1 Generating Stable Question IDs

Since the source file has no IDs, generate a deterministic hash on import. Derive the ID from the combination of `industry` + `prompt` so it remains stable across re-imports as long as those two fields don't change.

```javascript
const crypto = require('crypto');

function generateQuestionId(industry, prompt) {
  return crypto
    .createHash('sha256')
    .update(`${industry}||${prompt}`)
    .digest('hex')
    .slice(0, 12);
}

// Generates a 12-char hex ID stable across re-imports
// e.g. "3a7f2c910d44"
```

```python
import hashlib

def generate_question_id(industry: str, prompt: str) -> str:
    content = f"{industry}||{prompt}"
    return hashlib.sha256(content.encode()).hexdigest()[:12]
```

Generate response IDs the same way, appending the response index:

```javascript
function generateResponseId(industry, prompt, responseIndex) {
  return crypto
    .createHash('sha256')
    .update(`${industry}||${prompt}||${responseIndex}`)
    .digest('hex')
    .slice(0, 12);
}
```

### 6.2 Recommended Import Schema

When loading into your library, expand each question into a flat record with the following fields:

| Field | Type | Source | Notes |
|---|---|---|---|
| `question_id` | `String` | Generated | 12-char SHA-256 hash of `industry + prompt` |
| `industry` | `String` | `industry` field | Exact value from file — see Section 4 |
| `question_index` | `Integer` | Array position | Zero-based position within the industry's question array |
| `prompt` | `String` | `prompt` field | Full prompt text including emoji if present |
| `prompt_short` | `String` | Derived | `prompt` truncated at em-dash, 40 chars max |
| `scale_type` | `String` | Derived | `ordinal` / `sentiment` / `star_rating` / `categorical` |
| `is_anchor` | `Boolean` | Derived | `true` if `question_index == 0` and industry has life stage anchor |
| `response_count` | `Integer` | Computed | Always `4` in this version |
| `responses` | `Array<ResponseRecord>` | `responses` field | See response record schema below |
| `tags` | `Array<String>` | Manual / ML | Optional. For search and cross-industry grouping. |

**Response record schema:**

| Field | Type | Source |
|---|---|---|
| `response_id` | `String` | Generated — hash of `industry + prompt + index` |
| `index` | `Integer` | Zero-based position in `responses` array |
| `raw` | `String` | Full response string from file |
| `emoji` | `String` | Everything before first alphabetic character |
| `label` | `String` | Full text after emoji prefix |
| `label_short` | `String` | Text before em-dash, or full label if none |

### 6.3 Cross-Industry Shared Questions

The life stage question is identical across 10 B2C industries and should be stored once, then referenced by ID in each industry's question list. This prevents duplication in your library and allows cross-industry analysis of life stage distributions.

**The canonical life stage question:**

```
Prompt:    "What best describes your household right now?"
Responses: [
  "🧍 Single or couple, no children",
  "👨‍👩‍👧 Family with kids at home",
  "🎓 Empty nester — kids grown",
  "👴 Retired or semi-retired"
]
```

Industries that use it (all at `question_index: 0`):
`Healthcare`, `Hospitality (Hotel / Lodging)`, `Restaurants — Casual Dining`, `Restaurants — Fast Food / Quick Service`, `Travel & Tourism`, `Retail / E-commerce`, `Financial Services`

**Recommended handling:** Store this as a single canonical question record with a shared `question_id`. In each industry's question list, store a reference to the canonical ID rather than a duplicate record. Tag the canonical record with `"shared": true` and `"shared_type": "life_stage"`.

### 6.4 Deduplication on Re-import

When re-importing a new version of the file into an existing library:

1. Generate the `question_id` for each incoming question using the hash method in Section 6.1.
2. If a `question_id` already exists in your library, compare the `prompt` and `responses` arrays. If unchanged, skip. If changed, create a new version record and mark the old one as deprecated — do not delete, as historical responses may reference it.
3. If a `question_id` does not exist, insert as new.
4. After import, check for `question_id` values in your library that were not present in the incoming file. These are candidates for deprecation if they were sourced from this file.

### 6.5 Merging with Your Existing Question Library

If your library already contains questions for some of these industries:

**Step 1 — Tag existing questions with source.**  
Before merging, tag all existing questions with `"source": "legacy"`. Tag all incoming questions with `"source": "psychographic_v4"`.

**Step 2 — Identify overlaps by topic.**  
There is no automatic deduplication by topic — questions from different sources may ask the same thing in different ways. Review overlapping industries manually. Decide per industry whether to: (a) replace legacy questions, (b) append these questions after legacy ones, or (c) maintain parallel sets for A/B testing.

**Step 3 — Respect question ordering rules.**  
If appending, place anchor questions (life stage, role, segmentation) at the start of the combined set regardless of which source they come from. Use the `is_anchor` flag.

**Step 4 — Set display rules.**  
If your system supports conditional display (show question only if prior answer matches a condition), these questions are designed to stand alone — no conditional logic is baked in. Any branching logic is yours to define based on your segmentation needs.

### 6.6 Recommended Tags for Cross-Library Search

Apply the following tags on import to enable filtering across your full question library:

| Tag | Apply to |
|---|---|
| `life_stage` | The shared household question in all anchored industries |
| `frequency` | Questions using the 🔴🟡🟠🟢 ordinal scale |
| `trust` | Questions using the 💚🟡🟠🔴 sentiment scale |
| `ai_attitudes` | AI-related questions in SaaS, HR, K-12, Higher Education |
| `price_sensitivity` | Price/cost questions across dining, retail, travel, auto |
| `channel_preference` | Questions about how respondents access services (booking, ordering, watching) |
| `identity_values` | Questions on DEI, activism, identity, values in Politics, Sports, HR, Higher Education |
| `b2c` | All consumer-facing industries |
| `b2b` | `SaaS / Software`, `HR / Employee Experience` |
| `mixed` | Industries where both consumer and professional respondents are valid: `Healthcare`, `Education (K-12)`, `Higher Education`, `Non-Profit / Charity` |

---

## 7. Validation Rules

Run the following checks on any modified version of the file before deploying:

| Rule | Check |
|---|---|
| Response count | Every `responses` array has exactly 4 items |
| Prompt length | Every `prompt` is ≤ 65 characters |
| Response length | Every response string is ≤ 80 characters |
| Emoji prefix | Every response begins with at least one emoji character |
| No nulls | No field contains `null` or an empty string `""` |
| Industry uniqueness | No two objects in `psychographic_profiling` share the same `industry` value |
| Prompt uniqueness per industry | No two questions within the same industry share the same `prompt` |
| JSON validity | File parses without error against the schema in Section 2.5 |

**Validation script (Node.js):**

```javascript
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('psychographic_profiling_mobile_v4.json'));
const errors = [];

const industries = new Set();

data.psychographic_profiling.forEach((ind, i) => {
  if (industries.has(ind.industry))
    errors.push(`Duplicate industry at index ${i}: "${ind.industry}"`);
  industries.add(ind.industry);

  const prompts = new Set();
  ind.questions.forEach((q, j) => {
    const loc = `[${ind.industry}][${j}]`;
    if (!q.prompt || q.prompt.length === 0) errors.push(`${loc} Empty prompt`);
    if (q.prompt.length > 65) errors.push(`${loc} Prompt too long: ${q.prompt.length} chars`);
    if (prompts.has(q.prompt)) errors.push(`${loc} Duplicate prompt: "${q.prompt}"`);
    prompts.add(q.prompt);
    if (!Array.isArray(q.responses) || q.responses.length !== 4)
      errors.push(`${loc} Expected 4 responses, got ${q.responses?.length}`);
    (q.responses || []).forEach((r, k) => {
      if (!r || r.length === 0) errors.push(`${loc}[${k}] Empty response`);
      if (r.length > 80) errors.push(`${loc}[${k}] Response too long: ${r.length} chars`);
    });
  });
});

if (errors.length === 0) {
  console.log('✅ Validation passed');
} else {
  console.error('❌ Validation failed:');
  errors.forEach(e => console.error(' -', e));
  process.exit(1);
}
```

---

## 8. Extension Guidelines

When adding new questions to this library — whether new industries or additional questions within existing industries — follow these rules to maintain consistency.

### 8.1 Adding a new industry

- Add a new object to the `psychographic_profiling` array.
- Include a life stage anchor as the first question if the industry is B2C (copy the canonical question verbatim from Section 6.3).
- Include a role/segmentation anchor as the first question if B2B (e.g. company size, job function).
- Aim for 9–11 questions. Fewer than 8 produces weak segmentation. More than 12 increases abandonment on mobile.
- Use the same 4-response structure throughout.

### 8.2 Adding questions to an existing industry

- Insert new questions after any existing anchors (do not push anchors out of position 0).
- Do not exceed 12 questions per industry without a documented reason.
- Validate that the new question is not semantically redundant with an existing one in the same industry.
- Re-run the validation script after any edit.

### 8.3 Modifying existing questions

- Treat any change to `prompt` text as a breaking change — it will generate a new `question_id` on next import and orphan any historical response data tied to the old ID.
- Changing response text within a fixed question is also a breaking change for stored response values. Version the file (`v5`, `v6`) rather than editing in place.
- Minor formatting corrections (fixing a typo that doesn't change meaning) should be treated as non-breaking only if your system matches on `question_id` hash — in which case update the hash documentation.

---

## 9. Quick Reference

```
Root key:         psychographic_profiling   (Array)
Industry fields:  industry (String), questions (Array)
Question fields:  prompt (String), responses (Array<String>, always length 4)
Response format:  {emoji} {label} [— {detail}]
Scale types:      categorical | ordinal (🔴→🟢) | sentiment (💚→🔴) | star_rating (⭐→⭐⭐⭐)
Industries:       18 total — see Section 4
ID strategy:      SHA-256 hash of (industry + prompt), 12 hex chars
Shared question:  Life stage anchor — 10 B2C industries, always index 0
Validation:       4 responses per question, prompt ≤ 65 chars, response ≤ 80 chars
Ordering rule:    Anchors first, values/identity questions last — do not shuffle
```
