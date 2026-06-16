# 2026-W25 — Dev log (Week of Jun 15 to Jun 21)

## 2026-06-16 — Surveys: AI clarifier re-asked detail the respondent already gave on an earlier question

**Why**: A tester rated the experience "good", was asked "what could be done better" and answered "the pacing was slow throughout the meal"; later on the "good, bad and the ugly" open-end they said "Just the slow pacing I mentioned earlier" and the clarifier asked them to expand on it — detail they'd already provided. Root cause was not missing data: the client sent earlier answers as a bare `priorAnswers` map keyed `q1`/`q3` with **no question text**, so the model couldn't tell what each answer was responding to, and an over-eager "always follow up on short answers" rule fired on the back-reference.

**What changed**:
- `components/survey/useSurveyEngine.ts` — record each question's prompt text as it's asked (`questionsAsked` map, captured at likert storage + in `handleOpenEnded`); `buildClarify` now assembles an ordered `priorQA` list of `{ question, answer }` for every earlier answered slot and POSTs that instead of the bare-answer map.
- `app/api/clarify/route.ts` — accepts `priorQA: Array<{question, answer}>`; renders it as labeled `Q: "…" / A: "…"` prior context framed as "already captured — do NOT ask them to repeat or expand on any of it"; added an explicit SKIP rule for answers that only back-reference earlier feedback ("just the slow pacing I mentioned earlier", "same issue as before").
- `app/admin/testing/TestingClient.tsx` — two AI-Tester call sites updated to the new `priorQA: []` shape.

**Verify**: typecheck clean; full suite 864 pass. SURVEYS.md clarifier section updated (priorQA input + back-reference SKIP). Local, not pushed.

## 2026-06-16 — Town Hall: Meeting Notes (presentation half) now in the PDF report and public share link

**Why**: The in-app report and the deck already showed both halves of a meeting (the neutral presentation summary AND the Q&A), but the two surfaces that get forwarded after a meeting — the downloadable PDF and the public `/th` share link — were Q&A-only. With today's pilot on the line, a principal who opens the shared link or the emailed PDF should see the presentation overview too, not just the questions. The data already exists (`proceedings_summary`, generated at analyze time); it just wasn't being rendered on those two surfaces. No new AI calls.

**What changed**:
- `lib/recordings/reportHtml.ts` — new `proceedingsSection` (overview + per-item card: title, slide refs, presenter, what-was-presented, key-figure chips) rendered above the Overview, mirroring the in-app Presentation tab; eyebrow → "Meeting Summary" and exec heading → "Q&A Overview" when notes present; full fallback to the prior Q&A-only layout when `proceedings` is null.
- `lib/recordings/reportPdf.ts` — threads `rec.proceedings_summary` into the renderer (covers both the PDF download and the emailed attachment).
- `app/api/recordings/[id]/report/pdf/route.ts` + `report/send/route.ts` — added `proceedings_summary` to the selects.
- `app/th/[token]/page.tsx` — same Meeting Notes section + conditional eyebrow/heading on the public page (`proceedings_summary` is the neutral summary, safe to share).

**Verify**: typecheck clean; full suite 864 pass; render checks confirmed the section appears (overview, items, "$4.2M" figure chip, "Slides 3, 4", "Meeting Summary"/"Q&A Overview") and falls back correctly with no proceedings. RECORDINGS.md §4.5 + §4.6 updated. Local, not pushed.
