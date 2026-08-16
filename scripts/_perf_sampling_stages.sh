#!/usr/bin/env bash
# scripts/_perf_sampling_stages.sh — TEST-ONLY. Hash vs stratified-block sampling
# at a given dataset size, measured COLD.
#
#   bash scripts/_perf_sampling_stages.sh <label>
#
# WHY COLD MATTERS. shared_buffers on the test instance is 256 MB against a
# >2 GB table, so whether a read hits depends entirely on what was touched last.
# Re-running either sampler warms its own 50K rows into cache and both then look
# identical — which is exactly how a 55x claim can evaporate on a second run.
# The scattered-read penalty hash order pays is ONLY visible on a cold cache, so
# every measurement here is preceded by an eviction scan that churns well past
# shared_buffers.
#
# Reported per sampler: `read` (blocks actually pulled from disk — the number the
# whole argument is about), `hit`, and wall time. Order is alternated so neither
# sampler systematically benefits from the other's warming.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
DB=$(grep '^TEST_DB_URL=' .env.local | cut -d= -f2- | tr -d '"')
DST='dddddddd-0000-4000-8000-00000000cafe'
LABEL="${1:-unlabelled}"

rows=$(psql "$DB" -t -A -c "SELECT count(*) FROM dataset_rows_flat WHERE dataset_id='$DST'")
echo ""
echo "=============================================================="
echo " $LABEL — scale fixture has $rows rows"
echo "=============================================================="

# Churn shared_buffers (256 MB) with rows from OTHER datasets so the fixture's
# pages are evicted. Reading ~400 MB is comfortably more than enough.
evict() {
  # Must churn well past shared_buffers (256 MB) or the previous sampler's pages
  # survive and the next reading is warm — seen at 200k, where a second hash run
  # reported read=10. ~350K rows of other datasets is >2x shared_buffers.
  psql "$DB" -q -t -A -c "
    SELECT count(*) FROM (
      SELECT f.data FROM dataset_rows_flat f
       WHERE f.dataset_id <> '$DST' LIMIT 350000
    ) t;" > /dev/null
}

# $1 = label, $2 = SQL expression returning the sampler's jsonb. Prints
# "read ms" for one cold run.
one() {
  evict
  local out
  out=$(psql "$DB" -q -X -c "
    EXPLAIN (ANALYZE, BUFFERS, COSTS OFF, TIMING OFF)
    SELECT jsonb_array_length(($2) -> 'rows');" 2>&1)
  local read ms
  read=$(echo "$out" | grep -oE 'read=[0-9]+' | head -1 | grep -oE '[0-9]+' || echo 0)
  ms=$(echo "$out"   | grep -oE 'Execution Time: [0-9.]+' | grep -oE '[0-9.]+' || echo 0)
  echo "$read $ms"
}

# Five cold runs each, ALTERNATING, medians reported. A single reading is noise:
# `read` counts blocks pulled into shared_buffers, but they may come from the OS
# page cache (fast) or the disk (slow), and at 200k the same query varied
# 1,914ms vs 320ms across two runs.
ROUNDS=5
HASH="sample_dataset_rows('$DST', -1, -1, 5000)"
BLOCKS="sample_dataset_rows_blocks('$DST', -1, 5000)"

h_ms=(); h_rd=(); b_ms=(); b_rd=()
for r in $(seq 1 $ROUNDS); do
  printf '  round %d/%d\r' "$r" "$ROUNDS"
  x=($(one hash "$HASH"));   h_rd+=(${x[0]}); h_ms+=(${x[1]})
  y=($(one blocks "$BLOCKS")); b_rd+=(${y[0]}); b_ms+=(${y[1]})
done

med() { printf '%s\n' "$@" | sort -n | awk '{a[NR]=$1} END{print (NR%2)? a[(NR+1)/2] : (a[NR/2]+a[NR/2+1])/2}'; }

echo ""
echo "-- one 5,000-row page, cache evicted before EVERY run, $ROUNDS rounds --"
printf '  %-8s median %8.1f ms   median read %s blocks\n' "hash"   "$(med ${h_ms[@]})" "$(med ${h_rd[@]})"
printf '  %-8s median %8.1f ms   median read %s blocks\n' "blocks" "$(med ${b_ms[@]})" "$(med ${b_rd[@]})"
echo "  hash   all: ${h_ms[@]}"
echo "  blocks all: ${b_ms[@]}"

# ── The real workload: the whole 50K sample, not one page ───────────────────
# Per-page costs compound over 10 pages, and the block sampler re-evaluates
# dataset_sample_blocks on every page while hash does not — a single page hides
# that. NOTE the two samplers have DIFFERENT cursor shapes: hash needs the
# (last_hash, last_id) PAIR carried forward, blocks needs one row_index. Sharing
# one format string here would silently mis-page the hash walk and flatter it.
echo ""
echo "-- FULL 50,000-row walk (10 pages), cache evicted at the start --"
now_ms() { python3 -c 'import time;print(int(time.time()*1000))'; }

walk_hash() {
  evict
  local t0 h=-1 id=-1 out n total=0 pages=0
  t0=$(now_ms)
  for i in $(seq 1 15); do
    out=$(psql "$DB" -q -t -A -c "
      WITH r AS (SELECT sample_dataset_rows('$DST', $h, $id, 5000) AS j)
      SELECT COALESCE(jsonb_array_length(j->'rows'),0) || ' ' ||
             COALESCE(j->>'last_hash','') || ' ' || COALESCE(j->>'last_id','') FROM r;")
    n=$(echo "$out" | cut -d' ' -f1); h=$(echo "$out" | cut -d' ' -f2); id=$(echo "$out" | cut -d' ' -f3)
    total=$((total+n)); pages=$((pages+1))
    if [ "$n" = "0" ] || [ -z "$h" ] || [ "$total" -ge 50000 ]; then break; fi
  done
  echo "$total $pages $(( $(now_ms) - t0 ))"
}

walk_blocks() {
  evict
  local t0 cur=-1 out n nxt total=0 pages=0
  t0=$(now_ms)
  for i in $(seq 1 15); do
    out=$(psql "$DB" -q -t -A -c "
      WITH r AS (SELECT sample_dataset_rows_blocks('$DST', $cur, 5000) AS j)
      SELECT COALESCE(jsonb_array_length(j->'rows'),0) || ' ' ||
             COALESCE(j->>'last_row_index','') FROM r;")
    n=$(echo "$out" | cut -d' ' -f1); nxt=$(echo "$out" | cut -d' ' -f2)
    total=$((total+n)); pages=$((pages+1))
    if [ "$n" = "0" ] || [ -z "$nxt" ] || [ "$total" -ge 50000 ]; then break; fi
    cur=$nxt
  done
  echo "$total $pages $(( $(now_ms) - t0 ))"
}

hw=($(walk_hash)); bw=($(walk_blocks))
printf '  %-8s %6s rows over %2s pages in %6s ms\n' "hash"   "${hw[0]}" "${hw[1]}" "${hw[2]}"
printf '  %-8s %6s rows over %2s pages in %6s ms\n' "blocks" "${bw[0]}" "${bw[1]}" "${bw[2]}"
