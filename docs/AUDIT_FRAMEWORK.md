# Question Bank Audit Framework

## Overview

This document provides a reusable, scalable methodology for periodically reviewing and improving the Sentimetrx question banks across all 18 industries. The framework ensures that our survey instruments remain aligned with validated academic and industry benchmarks, and that question coverage remains comprehensive and current.

---

## Audit Schedule

- **Q1 (January)**: Comprehensive audit of all 18 industries against published benchmarks
- **Q2 (April)**: Focus audit on top 6 most-used industries; incorporate newly published validation studies
- **Q3 (July)**: Update based on annual reports from J.D. Power, AFP, NSSE, and other benchmarking bodies
- **Q4 (October)**: Full strategic review; prepare question bank release notes for next year

---

## Benchmark Registry

The following table maps each industry to its primary public domain validated instruments:

| Industry | Primary Benchmark | Secondary Sources | Source URL | Public Access |
|---|---|---|---|---|
| Healthcare | HCAHPS (29 items) | CAHPS family, AHRQ tools | hcahpsonline.org | ✅ Full free |
| Hospitality | LODGSERV (26 items) | SERVQUAL, Cornell Hotel Index | Academic journals | ✅ Free PDFs |
| Casual Dining | DINESERV (29 items) | SERVQUAL, Stevens/Knutson | Academic journals | ✅ Free PDFs |
| Fine Dining | DINESERV (29 items) | Upscale service quality models | Academic journals | ✅ Free PDFs |
| Fast Food | DINESERV (29 items) | QSR benchmarks, Forrester | QSR Magazine archives | ✅ Summaries free |
| Travel & Tourism | OECD Tourism Satisfaction | TripAdvisor insights, Booking.com studies | OECD.org, industry reports | ✅ Summaries free |
| Nonprofit | AFP FEP (7 dims) | Bloomerang/Neon donor templates | afpglobal.org | ✅ Reports free |
| SaaS / Software | SUS (10 items, public domain) | UMUX, NPS industry benchmarks | MeasuringU.com | ✅ Fully free |
| Retail / E-Commerce | ACSI (3-dim model) | Forrester CX index, Retail Dive | theacsi.org, Forrester | ✅ Benchmarks free |
| Financial Services | J.D. Power Investor (7 dims) | FINRA NFCS, Vanguard surveys | jdpower.com, finrafoundation.org | ✅ Press releases free |
| Education (K-12) | EDSCLS (NCES) | NHES, school climate surveys | nces.ed.gov | ✅ Fully free |
| Higher Education | NSSE (10 indicators) | Gallup-Purdue Index | nsse.indiana.edu | ✅ Reports free |
| HR / Employee | Gallup Q12 themes | SHRM annual survey, Mercer | gallup.com, shrm.org | ⚠️ Q12 licensed; themes public |
| Sports | Deloitte Fan Survey | Qualtrics XM benchmarks | deloitte.com | ✅ Free PDFs |
| Political | ANES (American National Election Study) | Pew Political Typology | electionstudies.org | ✅ Full + microdata free |
| Media / Entertainment | VALS (8 segments) | Nielsen methodology | strategicbusinessinsights.com | ✅ Survey tool free |
| Performing Arts | WolfBrown Friction Audit (12 dims) | TRG Arts benchmarks | wolfbrown.com | ✅ Free to join |
| Automotive Repair | J.D. Power CSI (5 dims) | ASI (7 dims), Technicians Today | jdpower.com | ✅ Press releases free |

---

## Scoring Rubric

Each industry is scored on **comprehensiveness** using a 0–4 scale per dimension category:

### Scoring Criteria

**0 — Missing**: No questions in this category

**1 — Minimal**: 1–2 questions; generic or non-validated; limited segmentation value

**2 — Basic**: 3–4 questions; some alignment with benchmark, but gaps remain; moderate segmentation

**3 — Comprehensive**: 5–7 questions; strong alignment with benchmark dimensions; good segmentation

**4 — Advanced**: 8+ questions; full alignment with benchmark; industry-specific constructs; excellent segmentation

### Dimensions Assessed Per Industry

1. **Psychographics**: Segmentation and attitude questions (e.g., engagement level, motivation, values)
2. **Demographics**: Respondent classification (e.g., age, role, usage patterns)
3. **Clarifiers**: Topic-specific follow-up triggers (e.g., visit type, pain points)
4. **Open-Ended Probes**: Targeted, industry-specific open questions (not generic)
5. **Categorical/Behavioral**: Specific action-oriented questions (e.g., booking method, device preference)

### Overall Comprehensiveness Score

**Industry Comprehensiveness = (Psycho + Demo + Clarif + OpenEnd + Behavioral) / 5**

Target: **≥ 3.0** (comprehensive alignment across all dimensions)

---

## Audit Process (Step-by-Step)

### Step 1: Baseline Snapshot
- Pull current question bank from `lib/industryDefaults.ts` for all 18 industries
- Count questions per category: psychographics, demographics, clarifiers, open-ended, categorical
- Record baseline scores

### Step 2: Benchmark Literature Review
- For each industry, review its primary benchmark instrument (see registry above)
- For secondary sources, scan recent academic journals or industry reports
- Document key dimensions, question phrasings, and validated constructs

### Step 3: Gap Analysis
- For each industry, create a gap analysis table:
  - **Dimension** (e.g., "Payment methods")
  - **Benchmark coverage** (e.g., "ACSI includes perceived value; TripAdvisor emphasizes booking ease")
  - **Current Sentimetrx coverage** (e.g., "3 psychographics, no booking questions")
  - **Gap** (e.g., "Missing: booking channel, checkout friction, payment security trust")
  - **Recommendation** (e.g., "Add 3 questions: booking_channel, checkout_ease, payment_security")

### Step 4: Question Addition/Refinement
- Draft new questions for highest-gap dimensions
- Use benchmark phrasing where possible (public domain sources only)
- Maintain consistency in naming convention: `{industry_prefix}_{descriptor}`
- Add 2–4 new questions per industry per audit cycle to reach 6–8 psychographics total

### Step 5: Validation Review
- Cross-reference new questions with existing clarifiers to avoid duplication
- Ensure new questions remain industry-specific (not generic)
- Check that all new options are mutually exclusive and exhaustive

### Step 6: Documentation
- Create or update `docs/AUDIT_{YYYY}_Q{N}.md` with:
  - Per-industry scoring before/after
  - Gap analysis summary
  - List of added questions with sources
  - Known remaining gaps (for next cycle)
- Update this framework with any new benchmarks discovered

---

## Gap Analysis Template

Use this table for each audit cycle:

```
## Industry: Healthcare
**Benchmark**: HCAHPS (29 items, 5 dimensions)
**Baseline Score**: 2.1 (4 psychographics, 2 demographics, 1 clarifier, limited open-ends)
**Target Score**: 3.2+

| Dimension | Benchmark Coverage | Current Gaps | Action |
|---|---|---|---|
| Psychographics | Insurance type, visit frequency, digital adoption, care setting | Missing: portal use, chronic condition awareness | Add 4 new Qs |
| Clarifiers | Discharge planning, medication communication, care transitions | Only generic follow-ups | Add 2 clarifier triggers |
| Open-Ended | Specific pain points re: transitions, coordination | Generic q3/q4 | Refine to care-coordination focus |
| Result | Updated score: 3.4 | All primary gaps closed | 6 psychographics + 3 clarifiers |
```

---

## PR and Merge Process

1. **Branch**: Create feature branch `audit/{YYYY}-q{N}/{industry-name}` or `audit/{YYYY}-q{N}/all-industries`
2. **Changes**: Update `lib/industryDefaults.ts` with new questions; add clarifier keys
3. **Documentation**: Include the audit report (e.g., `docs/AUDIT_2026_Q1.md`) in the same PR
4. **Testing**:
   - Run `npm run build` to verify TypeScript compilation
   - For SaaS/tech questions: verify SUS alignment with 10-item instrument
   - For healthcare: spot-check HCAHPS alignment
   - For HR: confirm Gallup Q12 theme coverage
5. **Review**: 
   - Data analyst reviews gap analysis accuracy
   - Product lead reviews new question relevance
   - Domain expert (e.g., healthcare PM) reviews industry-specific changes
6. **Merge**: Squash or rebase onto main; include audit report URL in release notes

---

## Known Gaps and Future Cycles

### Q1 2026 Additions (Completed)
- **All 18 industries**: +4 psychographics per industry (6–8 total achieved)
- **Healthcare**: +2 clarifiers (discharge, medication communication)
- **Hospitality**: +1 clarifier (check-in/check-out)
- **Dining (3 variants)**: +clarifier for dietary/occasion
- **Result**: Overall avg comprehensiveness improved from 2.1 → 3.2

### Q2 2026 (Planned)
- Deep dive on top 6 industries by usage volume
- Incorporate latest Deloitte Fan Survey, AFP annual report, NSSE results
- Add behavioral / action-oriented questions (e.g., repeat purchase likelihood, advocacy signals)

### Q3 2026 (Planned)
- Update J.D. Power benchmarks for Financial Services and Automotive Repair
- Refresh Political benchmark based on Pew's latest typology
- Add longitudinal tracking indicators (lifecycle stage, tenure cohorts)

### Q4 2026 (Planned)
- Full strategic review of all 18 industries
- Prepare Q1 2027 question bank release
- Evaluate new instruments (e.g., emerging ESG metrics for nonprofits, DEI benchmarks for HR)

---

## Tools and References

- **HCAHPS**: https://www.hcahpsonline.org/ (full instrument + scoring guide)
- **SUS**: https://www.measuringu.com/sus.php (public domain, 10 items)
- **ACSI**: https://www.theacsi.org/ (benchmarks + methodology)
- **Gallup Q12 themes**: https://www.gallup.com/workplace/356619/employee-engagement.aspx (themes free; Q12 licensed)
- **ANES**: https://electionstudies.org/ (full microdata + instruments)
- **NSSE**: https://nsse.indiana.edu/ (engagement indicators + institutional profiles)
- **WolfBrown**: https://www.wolfbrown.com/ (friction audit resources + case studies)
- **J.D. Power**: https://www.jdpower.com/ (press releases + methodology summaries)

---

## Contact & Stewardship

For questions on this framework or to propose new benchmarks:
- Audit owner: [Data/Research team]
- Review cycle: Quarterly (January, April, July, October)
- Last updated: 2026-01-15
- Next review: 2026-04-15
