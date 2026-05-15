---
name: spec-drift
description: "Report which spec docs likely drifted from code since a given git ref (default 7 days)"
argument-hint: "[<ref>|--since '<period>']"
---

# Spec drift check

Runs `scripts/spec-drift.ts` to compare git history against `scripts/specMap.ts` (the map of which file paths each spec doc covers) and report which specs likely need a sweep.

## Instructions

1. Run the report and capture the output:

```bash
npm run spec-drift -- $ARGUMENTS
```

If `$ARGUMENTS` is empty, the script defaults to "since 7 days ago". Otherwise pass through as-is — supported forms include a bare git ref (`HEAD~10`, `2026-05-08`, a sha) or `--since "<period>"`.

2. Read the rendered markdown report and present it to the user verbatim (it's already formatted for the chat).

3. **If the report shows drift** (any module spec under "⚠️ Drift"), offer two follow-ups:
   - **"Sweep now"** — pick the first drifted spec, read it in full, read the changed code paths the report lists, and propose targeted edits to the spec. Stop after one spec; let the user pick the next.
   - **"Defer"** — append a short note to `docs/weekly-reports/<current-week>-devlog.md` recording the drift for later attention.

4. **If the report shows no drift**, just confirm and stop. No further action needed.

## Notes for refinement

- The mapping lives in `scripts/specMap.ts`. If the report misses something (e.g., a new module dir not mapped to any spec) or over-counts (e.g., a glob that's too broad), edit `specMap.ts` directly. The map is the durable knob — the script is dumb.
- This command intentionally does not auto-edit specs; spec content is a writing exercise, not a transformation. The script identifies *where* attention is needed; a human (or this command's "sweep now" flow) does the actual writing.
- For the weekly automated pass, a scheduled routine runs this same script on Sunday and appends the report to the upcoming week's devlog.

$ARGUMENTS
