# 2026-W30 devlog (Jul 20 – Jul 26)

Brief WHY entries for meaningful commits/ops this week. The Monday governance routine reads this.

## Ops: NEPA/CARA comment tracking — final tally; daily refresh job self-expired as designed (Jul 15–22, docs-only)

WHY: Owner asked whether new comments had landed since the last scrape. Verified live against CARA (all 40 listing pages): the Blue Mountains corpus grew **926 → 989 submitted / 732 → 792 released** between 7/10 and 7/15, all captured by the daily 07:30 launchd refresh job (which also re-ran the analysis and republished the shared-link dashboard each morning); zero new letters beyond what the job had. The job then **self-disabled on 7/18** per its built-in END date (2026-07-17), so the live dashboard is frozen at 7/17 data while the comment window runs to 9/30 — resuming = extend `END` in `~/.nepa-blues/refresh.sh` and reload the plist (owner decision, ~$0.50/run). ~197 letters remain withheld pending FS PII review and would be picked up on resume.

Spec cure in the same commit: the NEPA demo suite (both deck routes, the `blue-mountains` agent + DEIS ingest, the generate-response review demo, and the committed `_nepa_*` analysis pipeline) had zero spec coverage since 7/10 — added a consolidated entry to FEATURES.md.
