# 2026-W25 — Dev log (Week of Jun 15 to Jun 21)

## 2026-06-16 — Surveys: AI clarifier re-asked detail the respondent already gave on an earlier question

**Why**: A tester rated the experience "good", was asked "what could be done better" and answered "the pacing was slow throughout the meal"; later on the "good, bad and the ugly" open-end they said "Just the slow pacing I mentioned earlier" and the clarifier asked them to expand on it — detail they'd already provided. Root cause was not missing data: the client sent earlier answers as a bare `priorAnswers` map keyed `q1`/`q3` with **no question text**, so the model couldn't tell what each answer was responding to, and an over-eager "always follow up on short answers" rule fired on the back-reference.

**What changed**:
- `components/survey/useSurveyEngine.ts` — record each question's prompt text as it's asked (`questionsAsked` map, captured at likert storage + in `handleOpenEnded`); `buildClarify` now assembles an ordered `priorQA` list of `{ question, answer }` for every earlier answered slot and POSTs that instead of the bare-answer map.
- `app/api/clarify/route.ts` — accepts `priorQA: Array<{question, answer}>`; renders it as labeled `Q: "…" / A: "…"` prior context framed as "already captured — do NOT ask them to repeat or expand on any of it"; added an explicit SKIP rule for answers that only back-reference earlier feedback ("just the slow pacing I mentioned earlier", "same issue as before").
- `app/admin/testing/TestingClient.tsx` — two AI-Tester call sites updated to the new `priorQA: []` shape.

**Verify**: typecheck clean; full suite 864 pass. SURVEYS.md clarifier section updated (priorQA input + back-reference SKIP). Local, not pushed.
