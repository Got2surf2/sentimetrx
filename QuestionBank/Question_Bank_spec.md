# Survey Library — Developer Handoff Spec
**Version 2.0 | Optimized for fresh session context loading**

---

## 1. What You Are Building Against

Three JSON files form the survey library. Two are active. One is deprecated.

| File | Status | Purpose |
|------|--------|---------|
| `survey_prompts_by_industry_v2.json` | **Active** | Master question library. 18 industries, 20–23 questions each. |
| `keyword_follow_on_library.json` | **Active** | Follow-on trigger engine. 104 open-ends, 343 keyword clusters. |
| `psychographic_profiling.json` | **Active** | Audience segmentation questions. Companion use only. |
| `survey_prompts_by_industry.json` | **Deprecated** | v1. Do not use for new deployments. |

The two active files operate together. Load both for any survey deployment. They are joined at two levels — see Section 6.

---

## 2. Survey Question Library Schema

### 2.1 Top-Level

```json
{
  "version": "2.0",
  "description": "string",
  "scale_types": { "scale_value": "definition" },
  "open_ended_trigger_types": { "trigger_value": "definition" },
  "survey_prompts_by_industry": [ /* Array of industry objects */ ]
}
```

### 2.2 Industry Object

```json
{
  "industry": "Healthcare",
  "research_arc": ["Screener & Role", "Behavioral Baseline", "Satisfaction & Attribute Ratings", "Competitive & Switching Dynamics", "Unmet Needs & Future Intent", "Open-Ends", "Demographics"],
  "questions": [ /* Array of question objects — render in array order */ ]
}
```

### 2.3 Question Object — Full Schema

```json
{
  "section": "string",         // Research arc section label. Always present.
  "prompt": "string",          // Question text. Render verbatim. JOIN KEY for follow-on lookup.
  "scale": "string",           // Controls UI component. See Section 3.
  "scale_detail": "string",    // CONDITIONAL. likert / matrix_likert / nps only. Anchor labels.
  "options": ["string"],       // CONDITIONAL. radio / checkbox only. Render in array order.
  "rows": ["string"],          // CONDITIONAL. matrix_likert only. One rating row per item.
  "trigger": "string"          // CONDITIONAL. open_ended only. Trigger category for follow-on engine.
}
```

**Field presence by scale type:**

| `scale` value | `scale_detail` | `options` | `rows` | `trigger` |
|---------------|:-:|:-:|:-:|:-:|
| `likert` | ✅ | ❌ | ❌ | ❌ |
| `radio` | ❌ | ✅ | ❌ | ❌ |
| `checkbox` | ❌ | ✅ | ❌ | ❌ |
| `matrix_likert` | ✅ | ❌ | ✅ | ❌ |
| `yes_no` | ❌ | ❌ | ❌ | ❌ |
| `nps` | ✅ | ❌ | ❌ | ❌ |
| `open_ended` | ❌ | ❌ | ❌ | ✅ |

---

## 3. Scale Type → UI Component Mapping

| `scale` | UI Component | Key Behaviour | Critical Rules |
|---------|-------------|---------------|----------------|
| `likert` | Radio group or 5-pt slider | Single select, 1–5 | Parse `scale_detail` for anchor labels. Render exactly 5 options. Never infer anchors. |
| `radio` | Radio button group | Single select, mutually exclusive | Render `options[]` in array order. |
| `checkbox` | Checkbox group | Multi-select | Render `options[]` in array order. If prompt says "Select up to N", enforce in UI. Store as array. |
| `matrix_likert` | Attribute rating grid | One 1–5 rating per row | `rows[]` = items to rate. Columns from `scale_detail`. Store each row as discrete data point keyed by row string. |
| `yes_no` | Binary toggle or radio | Yes / No only | No `options[]` field present. Render exactly two choices. Store as boolean or `"yes"/"no"`. |
| `nps` | 11-pt horizontal scale | Integer 0–10 | Always 0–10. Parse `scale_detail` for endpoint labels. Tag for NPS scoring: Promoters ≥ 9, Passives 7–8, Detractors ≤ 6. |
| `open_ended` | Free-text area | Unstructured | **Triggers keyword follow-on engine.** Look up matching block in `keyword_follow_on_library.json` by `prompt` string. Minimum 3-row text area. |

---

## 4. Keyword Follow-On Library Schema

### 4.1 Top-Level

```json
{
  "version": "1.0",
  "description": "string",
  "matching_rules": { /* See Section 5 */ },
  "follow_on_structure": { /* Architecture description */ },
  "industries": [ /* Array of industry follow-on objects */ ]
}
```

### 4.2 Industry Follow-On Object

```json
{
  "industry": "SaaS / Software",    // JOIN KEY — must match survey file exactly
  "open_ends": [ /* Array of open-end trigger blocks */ ]
}
```

### 4.3 Open-End Trigger Block

```json
{
  "prompt": "string",               // JOIN KEY — exact match to question prompt
  "trigger_type": "string",         // Platform pre-condition signal. See Section 4.5.
  "keyword_triggers": [
    {
      "priority": 1,                // Integer. Lower = higher priority. Starts at 1.
      "keywords": ["string"],       // ANY match fires this cluster.
      "follow_on": "string"         // Prompt to render as next question.
    }
  ],
  "default_follow_on": "string"     // Fires when zero keyword clusters match. Always present.
}
```

### 4.4 Concrete Example

```json
{
  "industry": "SaaS / Software",
  "open_ends": [
    {
      "prompt": "Where does your current primary vendor fall short of your expectations?",
      "trigger_type": "dissatisfaction_probe",
      "keyword_triggers": [
        {
          "priority": 1,
          "keywords": ["support", "customer success", "CSM", "response time", "ignored", "ghosted"],
          "follow_on": "Post-sale support is falling short. Does quality degrade after the contract is signed — and has that pattern repeated across multiple vendors?"
        },
        {
          "priority": 2,
          "keywords": ["integration", "doesn't connect", "siloed", "API", "workaround", "manual"],
          "follow_on": "Integration gaps are creating friction. Is this limiting ROI of the tool itself, or creating downstream data quality problems?"
        },
        {
          "priority": 3,
          "keywords": ["price", "expensive", "cost increased", "renewal", "not worth", "ROI"],
          "follow_on": "Price justification is a challenge. Can you articulate what ROI you're actually getting compared to what was promised at sale?"
        }
      ],
      "default_follow_on": "Is this shortfall a deal-breaker driving you toward replacement — or something you've accepted as the cost of staying?"
    }
  ]
}
```

### 4.5 Trigger Type → Platform Pre-Condition

| `trigger_type` | Platform Pre-Condition |
|----------------|----------------------|
| `low_satisfaction_followup` | Only invoke keyword engine if a preceding Likert/matrix question scored ≤ 2 AND this open-end is its direct follow-on. |
| `dissatisfaction_probe` | No additional pre-condition. Always invoke keyword engine. |
| `switching_probe` | No additional pre-condition. Always invoke. |
| `trust_probe` | No additional pre-condition. Always invoke. |
| `behavioral_shift_probe` | No additional pre-condition. Always invoke. |
| `competitive_tradeoff_probe` | No additional pre-condition. Always invoke. |
| `decision_driver_probe` | No additional pre-condition. Always invoke. |
| `churn_story_probe` | No additional pre-condition. Always invoke. |
| `pricing_sentiment_probe` | No additional pre-condition. Always invoke. |
| `advice_framing_probe` | No additional pre-condition. Always invoke. |
| `lapse_story_probe` | No additional pre-condition. Always invoke. |
| `aspirational_probe` | No additional pre-condition. Always invoke. |
| `distrust_probe` | No additional pre-condition. Always invoke. |
| `competitive_perception_probe` | No additional pre-condition. Always invoke. |
| `satisfaction_gap_probe` | No additional pre-condition. Always invoke. |
| `none` | No pre-condition. Always invoke based on response content only. |

---

## 5. Keyword Matching Rules

Implement all rules exactly. No exceptions.

| Rule | Value | Implementation |
|------|-------|----------------|
| `case_sensitive` | `false` | Lowercase both response text and all keyword strings before matching. |
| `partial_word_match` | `false` | Whole-word match only. Use `\b` word boundary regex. `"price"` must NOT match `"caprice"` or `"repriced"`. |
| `match_type` | `ANY` | Cluster fires if ANY single string in `keywords[]` matches the response. |
| `max_follow_ons_per_open_end` | `2` | Never deliver more than 2 follow-ons per open-end in a single pass. |
| `priority_resolution` | Lowest integer wins | Multiple clusters match → fire `priority: 1` as Follow-On #1. Next-lowest matching priority may fire as Follow-On #2. |
| `default_follow_on_behavior` | Fires on no match | If zero clusters match → fire `default_follow_on` as Follow-On #1. |
| `keyword_default_exclusion` | Mutually exclusive | If a keyword trigger fires in a pass → `default_follow_on` does NOT fire in that same pass. |
| `min_response_length` | 10 characters | Responses < 10 chars → skip keyword evaluation → fire `default_follow_on` or skip entirely. |

---

## 6. Cross-File Join Logic

**Two join levels. Both required. Never use array index as join key.**

### Level 1 — Industry Join

```
survey_prompts_by_industry_v2.json
  → survey_prompts_by_industry[n].industry

MUST EXACTLY MATCH (case-sensitive string)

keyword_follow_on_library.json
  → industries[n].industry
```

Load both matching industry objects into memory at survey start.

### Level 2 — Question Join

```
questions[n].prompt   (where scale === "open_ended")

MUST EXACTLY MATCH (exact string)

open_ends[n].prompt
```

Perform this join at render time when an `open_ended` question is encountered. Do not pre-join at load time — match on demand using the prompt string.

> ⚠️ **Critical:** The `prompt` string is the only join key. Arrays in the two files are not guaranteed to be in the same order across industries. String match only.

---

## 7. Follow-On Decision Flow

Execute this logic on every open-ended response submission:

```
RECEIVE response text

IF response.length < 10 characters:
  → fire default_follow_on (or skip)
  → STOP

SCAN keyword_triggers[] in priority order (1, 2, 3...):
  FOR each cluster:
    IF any keyword in cluster.keywords[] matches response (whole-word, case-insensitive):
      → fire cluster.follow_on as Follow-On #1
      → mark cluster as used
      → BREAK inner loop

IF no cluster matched:
  → fire default_follow_on as Follow-On #1
  → STOP

IF follow_on_count < 2:
  SCAN remaining clusters (excluding used cluster):
    IF a second distinct cluster matches:
      → fire as Follow-On #2
      → STOP

IF follow_on_count === 2:
  → STOP. Advance to next survey question.
```

---

## 8. AI Probing Handoff

When AI conversational probing is available:

```
Pass to AI engine:
  1. original open-end prompt text
  2. respondent's response text
  3. trigger_type of the open-end
  4. matched keyword cluster (if any) + its follow_on text
  5. industry name

AI uses follow_on as seed prompt — continues from there.
Do NOT have AI generate a follow-on from scratch without this context.

If AI confidence is low → fall back to keyword library deterministically.
If AI is unavailable → keyword library is fully self-contained. No AI context needed.
```

---

## 9. Research Arc — Section Sequence

Every industry follows this 7-section arc in order. Respect sequence for rendering, progress display, and page-break logic:

```
1. Screener & Role
2. Behavioral Baseline
3. Satisfaction & Attribute Ratings
4. Competitive & Switching Dynamics
5. Unmet Needs & Future Intent
6. Open-Ends
7. Demographics  (or Firmographics for B2B industries)
```

---

## 10. Coverage Reference

| Metric | Value |
|--------|-------|
| Industries | 18 |
| Questions per industry | 20–23 |
| Total questions | ~385 |
| Open-ends total | 104 |
| Keyword trigger clusters | 343 |
| Avg clusters per open-end | 3.3 |
| Default follow-ons | 104 (one per open-end) |
| Scale types | 7 |
| Trigger types | 16 |

---

## 11. Known Edge Cases

| Scenario | Handle As |
|----------|-----------|
| Response contains keywords from two clusters of equal priority | Priority integer is always unique per open-end — ties cannot occur by design. |
| Response matches a keyword but in a negated context ("never had a problem with support") | Current spec: still fires. Recommended: implement negation window check (see Limitations). |
| `open_ended` question has `trigger_type: "none"` | Always invoke keyword engine based on response content. No platform pre-condition. |
| Prompt text edited in one file but not the other | Level 2 join fails silently. Fire `default_follow_on` as safe fallback. Log a schema mismatch warning. |
| Response is exactly 10 characters | Meets threshold. Evaluate keyword triggers normally. |
| Matrix row rating stored | Key by exact row string from `rows[]`. Do not use array index. |
| NPS response stored | Store as integer 0–10. Apply scoring bands at analytics layer, not at collection layer. |

---

## 12. What Is NOT in Scope

These are explicitly outside the JSON library and must be built as platform-native modules:

- Brand awareness / aided recall batteries
- MaxDiff / best-worst scaling exercises
- Conjoint or trade-off analysis modules
- Sentiment scoring or NLP beyond keyword matching
- Negation detection
- Translation / multilingual keyword arrays
- Survey logic branching beyond follow-on depth (skip logic, piping, quotas)

---

*Survey Library Developer Handoff Spec v2.0 — load this file at the start of any new build session. Do not include prior conversation history.*
