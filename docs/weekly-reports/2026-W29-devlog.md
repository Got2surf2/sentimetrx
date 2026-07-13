# 2026-W29 devlog (Jul 13 – Jul 19)

Brief WHY entries for meaningful commits/ops this week. The Monday governance routine reads this.

## Ops: prod "pathetically slow" diagnosed → 785K [SCALE TEST] deleted from prod (Jul 13, no code)

WHY: Owner at ~1am ET: schema hangs, menu switches slow, System Health takes forever — "did breadcrumbs break it?" Diagnosis (all read-only): breadcrumbs innocent (pure link chrome). The DB was I/O bound: `dataset_rows_flat` was **3.56GB = 97% of the whole database** (785,638 of 1,057,110 rows = the [SCALE TEST] dataset) on a ~1GB Micro instance (shared_buffers 256MB) → cache hit ratio 84.6% (healthy ≥99%), so every page's auth/org lookups paid disk I/O; 7/12's heavy day (sql/165 index build scanning the full heap + pre-index classify PK walks + vacuum) additionally drained the Supabase burst-I/O budget. Owner approved the queued deletion: 785,638 rows removed in 16×50K `id IN` batches on idx_drf_id_keyset (mirroring the app's delete path; review_sources/collections/entities confirmed 0 first), then dataset_state + datasets row; ANALYZE run, autovacuum picked up the dead tuples. Table now 273,795 live rows; settings-page queries measured 0.05ms post-delete. Side finding: the nightly org-snapshot cron had been hitting Vercel's 300s timeout paging the bloated table — should self-resolve.

Residual "schema does not come up" after the delete = **stale browser tab**: the owner's tab predated the 23:21 deploy (which changed ~60 pages' chunks); server 200'd every click while the browser never painted. Hard refresh fixed it. Lesson for support: after a deploy, a tab left open overnight can navigate into missing-chunk territory — hard refresh first before diagnosing.

NEW TODO (owner-reported): Filters modal's filterable-value list is sample-derived and misses values on high-cardinality fields (location) — fix is an exact distinct-values pass for filterable fields. Interim workaround already shipped: Schema tab → "↻ Refresh from data". Tracked in the open-work queue.
