# 2026-W30 devlog (Jul 20 – Jul 26)

Brief WHY entries for meaningful commits/ops this week. The Monday governance routine reads this.

## Ops: NEPA/CARA comment tracking — final tally; daily refresh job self-expired as designed (Jul 15–22, docs-only)

WHY: Owner asked whether new comments had landed since the last scrape. Verified live against CARA (all 40 listing pages): the Blue Mountains corpus grew **926 → 989 submitted / 732 → 792 released** between 7/10 and 7/15, all captured by the daily 07:30 launchd refresh job (which also re-ran the analysis and republished the shared-link dashboard each morning); zero new letters beyond what the job had. The job then **self-disabled on 7/18** per its built-in END date (2026-07-17), so the live dashboard is frozen at 7/17 data while the comment window runs to 9/30 — resuming = extend `END` in `~/.nepa-blues/refresh.sh` and reload the plist (owner decision, ~$0.50/run). ~197 letters remain withheld pending FS PII review and would be picked up on resume.

Spec cure in the same commit: the NEPA demo suite (both deck routes, the `blue-mountains` agent + DEIS ingest, the generate-response review demo, and the committed `_nepa_*` analysis pipeline) had zero spec coverage since 7/10 — added a consolidated entry to FEATURES.md.

## Deck: "Four Advanced Research Capabilities" — reusable client-agnostic prospect overview (Jul 24)

WHY: Owner needed a high-level first-meeting capability deck for any prospect that frames the four advanced-research capabilities and drills into each core product. New `lib/pptx/advancedResearchDeck.ts` builder + admin-gated `/api/advanced-research-deck` route (optional `?client=<name>` injected on cover + footer only), registered in `/admin/decks` under Client & Prospect. 10 slides: cover → four-capability map (Conversational Surveys · Town Hall · PulseIQ collection modes, all feeding Analytics as the shared engine) → drill-down per product (why conversational beats traditional, live theme extraction, virtual focus-group scale, text analytics · charting · statistics · predictive modeling) → one-platform through-line → close. Fixed content, no fabricated data — only the house's established/attributed figures (40–50% unusable open-ends; 3–5× more usable text, labeled illustrative). Pixel-QC'd all 10 slides.

## Help agent (Sherpa): icon 🛟 → 🧭 compass (Jul 24)

WHY: Owner — a compass is a better metaphor for Sherpa's guide-you-there / "find your way around" role than a lifesaver, and stays on the Datanautix nautical brand. Swept the whole class, not just the button: the `HelpWidget.tsx` launcher + header + greeting, Sherpa's system prompt (`lib/helpAgent.ts`) and Ask Ana's hand-off text (`app/api/ask-ana/route.ts`) that both tell users to "click the lifesaver 🛟", the three help-KB articles (what-is-sentimetrx, getting-started, ask-ana) Sherpa reads from, and the spec/comment refs (HELP_AGENT.md decision block + checklist, TESTING.md, DATABASE.md, route comments, test header). One 🛟 kept intentionally in the HELP_AGENT.md history note. tsc + 12 helpAgent tests green. **Propagation:** the button emoji ships with the push (frontend); Sherpa's *spoken* "compass" wording only reaches prod after re-seeding the agent prompt (`seed-help-agent.mts --prod`) + re-ingesting the 3 edited KB articles — folds into the already-pending on-push re-seed.
