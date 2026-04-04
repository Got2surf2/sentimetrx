# Coalition for the Homeless — Donor Insights Study
## Deployment Guide

---

## Overview

This is a **complete, production-ready Sentimetrx study** for Coalition for the Homeless donor research.

**Study Location:** `lib/coalitionStudyTemplate.ts`

**Duration:** ~7-10 minutes  
**Questions:** 19 total (17 categorical/Likert + 2 open-ended)  
**Focus:** Donor motivation, retention, growth, and legacy giving

---

## Study Flow

### 1. GREETING
> "Hi! Thank you for supporting the Coalition for the Homeless. Your feedback helps us serve our mission more effectively and engage donors in ways that matter most to you."

### 2. EXPERIENCE RATING (Built-in)
> "How would you rate your overall experience with the Coalition?"
- ⭐ 5-point satisfaction scale with emojis

### 3. CUSTOM QUESTIONS (17 questions in 6 sections)

#### **Section 1: Giving Profile & Mindset** (3Q)
- Problem perception (homelessness in Central FL)
- Civic responsibility views (who should solve)
- Giving pattern (structured vs. discretionary)

#### **Section 2: Motivation & Values** (3Q)
- Why they give (personal connection, impact, reputation, etc.)
- Impact importance (Likert scale 1-5)
- Donor capacity (modest, moderate, major, transformational)

#### **Section 3: Communication & Recognition** (3Q)
- Preferred communication methods (email, text, social, etc.) — multi-select
- Communication frequency (monthly, quarterly, annually, etc.)
- Recognition preference (thank you note, call, public mention, etc.)

#### **Section 4: Engagement & Involvement** (2Q)
- Volunteer interest (yes/no/maybe)
- Most compelling program aspect (services, training, housing, advocacy, etc.)

#### **Section 5: Retention & Growth** (2Q)
- What causes churn (lack of impact, poor communication, etc.) — multi-select
- What drives growth (impact evidence, personal request, matching grant, etc.) — multi-select

#### **Section 6: Legacy & Strategic Giving** (2Q)
- Bequest interest (yes/maybe/already in will/no)
- Preferred giving vehicle (operating budget, endowment, specific program, building, bequest, etc.)

#### **Section 7: Open-Ended Insights** (2Q)
- Misconceptions that limit generosity (open text)
- What distinguishes long-term supporters (open text)

### 4. PSYCHOGRAPHICS (Nonprofit Industry Bank)
Randomly shows 2 questions per session:
- Involvement type (donor, volunteer, both, event attendee, participant, board, staff)
- Tenure (< 1 year, 1-3 years, 3-5 years, 5+ years)

### 5. DEMOGRAPHICS (Optional)
- ZIP code (optional, for geographic context)

---

## Deployment Steps

### **Option A: Via UI (Study Creator)**

1. **Log into Sentimetrx** → Navigate to **Studies** → **Create New Study**
2. **Import Configuration:**
   ```javascript
   import { coalitionDonorStudyConfig } from '@/lib/coalitionStudyTemplate'
   ```
3. **Copy config into Study Creator:**
   - Copy `coalitionDonorStudyConfig` object
   - Paste into the appropriate fields in the UI
   - Verify all 19 questions appear
4. **Customize if needed:**
   - Adjust theme colors (currently Coalition teal #0F7173)
   - Change greeting text if desired
   - Enable/disable demographics fields
5. **Save & Launch**

### **Option B: Programmatic (Recommended for Speed)**

```typescript
// In your study creation route or admin panel:
import { coalitionDonorStudyConfig, coalitionStudyMetadata } from '@/lib/coalitionStudyTemplate'
import { createClient } from '@/lib/supabase/server'

const supabase = createClient()

// Insert Study record
const { data: study, error } = await supabase
  .from('studies')
  .insert({
    id: uuidv4(),
    guid: uuidv4(),
    name: coalitionStudyMetadata.name,
    description: coalitionStudyMetadata.description,
    bot_name: coalitionStudyMetadata.botName,
    bot_emoji: coalitionStudyMetadata.botEmoji,
    status: 'draft', // Change to 'active' when ready
    visibility: 'private',
    org_id: '[YOUR_ORG_ID]',
    config: coalitionDonorStudyConfig,
    created_by: '[USER_ID]',
  })
  .select()
  .single()

if (error) throw error
return study
```

### **Option C: Seed Script**

```typescript
// Create a seeding script at scripts/seed-coalition-study.ts
import { coalitionDonorStudyConfig, coalitionStudyMetadata } from '@/lib/coalitionStudyTemplate'

export async function seedCoalitionStudy(supabase: SupabaseClient, orgId: string, userId: string) {
  return supabase.from('studies').insert({
    id: uuidv4(),
    guid: uuidv4(),
    name: coalitionStudyMetadata.name,
    description: coalitionStudyMetadata.description,
    bot_name: coalitionStudyMetadata.botName,
    bot_emoji: coalitionStudyMetadata.botEmoji,
    status: 'draft',
    visibility: 'private',
    org_id: orgId,
    config: coalitionDonorStudyConfig,
    created_by: userId,
  }).single()
}
```

Then run:
```bash
npx tsx scripts/seed-coalition-study.ts
```

---

## Survey Question Reference

| # | Question | Type | Section | Key Insight |
|----|----------|------|---------|-------------|
| 1 | Problem perception | Radio | Profile | Civic mindset |
| 2 | Responsibility views | Radio | Profile | Who should solve |
| 3 | Giving pattern | Radio | Profile | Structured vs. discretionary |
| 4 | **Why you give** | Radio | Motivation | Primary driver |
| 5 | Impact importance | Likert | Motivation | Evidence needed |
| 6 | Donor capacity | Radio | Motivation | Giving level |
| 7 | Communication methods | Checkbox | Engagement | Multi-select prefs |
| 8 | Communication frequency | Radio | Engagement | How often to contact |
| 9 | Recognition preference | Radio | Engagement | How to thank them |
| 10 | Volunteer interest | Radio | Engagement | Beyond money |
| 11 | **Compelling programs** | Radio | Engagement | Mission resonance |
| 12 | **Churn reasons** | Checkbox | Retention | Risk factors |
| 13 | **Growth triggers** | Checkbox | Retention | Expansion levers |
| 14 | Bequest interest | Radio | Legacy | Planned giving |
| 15 | Giving vehicle | Radio | Legacy | How to give |
| 16 | **Misconceptions** | Open | Insights | Barriers to generosity |
| 17 | **Multi-year factors** | Open | Insights | Loyalty drivers |
| +2 | Psychographics | Radio | Profile | Involvement + tenure |
| +1 | Demographics | Text | Profile | ZIP code |

---

## Data Analysis Framework

After survey responses are collected, analyze by section:

### **Giving Profile & Mindset** (Q1–Q3)
- Segment by problem perception (who sees homelessness as critical)
- Cross-tab civic responsibility views with giving patterns
- Identify ideal donor personas

### **Motivation & Values** (Q4–Q6)
- **Key metric:** % who cite "evidence of impact" as primary reason
- **Key metric:** % who rate impact importance as 4–5 (very/extremely)
- Identify under-tapped motivations in current messaging
- Match donor capacity to appropriate stewardship levels

### **Communication & Recognition** (Q7–Q9)
- **Action:** Build email/text/social contact lists by preference
- **Action:** Assign recognition strategy by donor type
- **Insight:** Identify over-communicated donors (prefer minimal contact)

### **Engagement & Involvement** (Q10–Q11)
- **Insight:** % interested in volunteering (deepen relationships beyond donations)
- **Insight:** Which program aspects resonate most (tailor messaging)
- **Cross-tab:** Do program interests differ by donor capacity?

### **Retention & Growth** (Q12–Q13)
- **Critical:** Top churn reasons (address in operations/communication)
- **Critical:** Top growth triggers (feature in future campaigns)
- **Action:** Create retention roadmap targeting top churn factors

### **Legacy & Strategic Giving** (Q14–Q15)
- **Insight:** % open to bequests (identify planned giving prospects)
- **Insight:** Preferred vehicles by donor capacity (endowment appeals to major donors, etc.)
- **Action:** Launch legacy giving campaign targeting bequest-interested donors

### **Open-Ended Insights** (Q16–Q17)
- **Manual review:** Themes in misconceptions (update donor collateral)
- **Manual review:** Common factors in multi-year supporter stories (inform stewardship)
- **Theme analysis:** Use AI summary to identify top 3–5 patterns

---

## Customization Options

### **Theme Colors**
Change the `theme` object in `coalitionStudyTemplate.ts`:
```typescript
theme: {
  primaryColor: '#0F7173',      // Main brand color (currently Coalition teal)
  headerGradient: '...',        // Gradient for survey header
  backgroundColor: '#f8f9fa',   // Survey background
  accentColor: '#E8B84B',       // Highlight color
  botAvatarGradient: '...',     // Bot avatar styling
}
```

### **Greeting Message**
Edit the `greeting` field at the top:
```typescript
greeting: "Custom message here"
```

### **Question Order**
Reorder questions in the `questions` array. The UI allows drag-reordering too.

### **Add/Remove Psychographics**
Modify `psychographicBank` array or change `psychoCount`:
```typescript
psychoCount: 3  // Show 3 random psycho questions instead of 2
```

### **Enable/Disable Demographics**
Update `demoFields`:
```typescript
demoFields: [
  { key: 'zip', label: 'ZIP Code', type: 'text', enabled: true },
  { key: 'income', label: 'Household Income', type: 'select', enabled: true }, // Add income level
]
```

---

## Stakeholder Attribution

This study incorporates strategic questions from:

| Stakeholder | Role | Contribution |
|---|---|---|
| **Brad Butterstein** | CEO, Coalition | Why donors stop giving / growth triggers |
| **Craig Fairey** | SVP, Wells Fargo | Motivation, communication, recognition, engagement |
| **Liza Coburn** | SVP, TRUIST | Impact importance, donor segmentation, misconceptions |
| **Jim Schreiber** | Attorney | Legacy giving, planned gifts, bequest vehicles |

---

## Testing Before Launch

1. **QA Checklist:**
   - [ ] All 19 custom questions appear in correct order
   - [ ] Experience rating displays 5-point scale with emojis
   - [ ] Psychographics load (random 2 per session)
   - [ ] Open-ended questions accept text input
   - [ ] Multi-select (Q7, Q12, Q13) allow multiple selections
   - [ ] Radio questions allow single selection
   - [ ] Theme colors render correctly
   - [ ] Bot name/emoji display as "Coalition Insights Bot" + 🤝

2. **Test Response:**
   - Complete survey as test donor
   - Verify all responses save correctly
   - Check CSV export includes all columns

3. **Send Test Link:**
   - Share with 2–3 Coalition staff for feedback
   - Verify mobile rendering
   - Confirm estimated completion time (~8 min)

---

## Launch Readiness

**Status: ✅ READY TO DEPLOY**

```
✓ 19 questions fully defined
✓ Compiled without TypeScript errors
✓ Question mapping documented
✓ Stakeholder attribution complete
✓ Theme colors set to Coalition brand
✓ Psychographics integrated
✓ Export labels clear for analysis
✓ Demographics optional (no required fields after rating)
```

**Next Steps:**
1. Deploy study via Option A, B, or C above
2. Generate survey link
3. Share with Coalition donor database
4. Collect 50–100 responses for initial insights
5. Analyze by section (see "Data Analysis Framework" above)
6. Present findings to Board + stakeholders

---

## Files

- **Study Config:** `lib/coalitionStudyTemplate.ts`
- **This Guide:** `COALITION_STUDY_DEPLOYMENT.md`
- **Question Mapping:** See top of `lib/coalitionStudyTemplate.ts` for original stakeholder questions

---

## Contact

For questions or customization needs, contact the Sentimetrx team.

**Study Created:** April 2026  
**Version:** 1.0  
**Last Updated:** 2026-04-03
