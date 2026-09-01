# 2026-W36 devlog

---

## 2026-09-01 — Fix the parseCSV interior-quote-dropping bug (W36 audit item #1)

**Why**: the W36 governance audit's top progression item, live in production
since the ANES load: the upload parser in `UploadClient.tsx` toggled `inQ` on
every `"` and never emitted one, so interior quote marks were silently dropped —
2,796 of 125,897 prod ANES rows had verbatim text mangled. It also split on
newlines BEFORE parsing fields, so a quoted field containing a line break broke
its row apart entirely (a second defect of the same class, found while fixing
the first).

**What**: extracted all upload parsing into `lib/csv.ts` — a single-pass RFC4180
parser (`parseCSVRecords`) that treats `""` as a literal quote and separators
inside quotes as data, plus `parseCSV`, `parseTSV`, `isSurveyMonkeyCSV`, and
`parseSurveyMonkeyCSV` ported onto it. `UploadClient.tsx` now imports from
`lib/csv`. Moving the code into `lib/` also puts it inside the vitest coverage
surface (`lib/**` + `app/api/**`) — part of the W36 plan to raise actual
coverage with tests that matter.

**Verification**: 24 unit tests in `tests/unit/csv.test.ts` (escaped quotes,
embedded newlines/commas, CRLF, BOM, blank lines, SurveyMonkey header merging);
full suite 1,840 green; and the real browser flow against the TEST project — a
CSV with `""` escapes and an embedded newline uploaded via `/analyze/new`,
stored rows read back byte-identical (quotes and newline intact, 3 rows not 4).
The old dead "Check 4" (`dataLike`, computed but never used) in
`isSurveyMonkeyCSV` was dropped in the port.

**Not done here**: re-running the ANES loader to repair the 2,796 mangled prod
rows (the server-side loader already parses correctly; repair is a separate,
owner-timed operation). The campaigns respondent uploader
(`CampaignDetailClient.tsx`) handles `""` correctly but still line-splits first;
the content-guard admin harness uses a naive `split(',')` — both noted, left
untouched.
