#!/usr/bin/env bash
# scripts/_seed_scale_test.sh — TEST-ONLY. Builds a large synthetic dataset by
# cycling the real 128,619-row Outback rows, so field names, row width, text
# content and theme-keyword density are all realistic (a narrower synthetic row
# would understate the scattered-read penalty this exists to measure).
#
#   bash scripts/_seed_scale_test.sh <target_rows>      # add rows up to target
#   bash scripts/_seed_scale_test.sh drop               # remove it + VACUUM
#
# ⚠️ Costs ~4.4 KB/row all-in (heap 2.03 + indexes 1.73 + toast 0.66). DELETE IT
# when done — the previous 1M perf dataset had to be cleaned up for the same
# reason (drf 1.43M -> 398K, 2026-07-14).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
DB=$(grep '^TEST_DB_URL=' .env.local | cut -d= -f2-)
SRC='a1b2c3d4-0000-4000-8000-000000000200'
DST='dddddddd-0000-4000-8000-00000000cafe'

if [ "${1:-}" = "drop" ]; then
  echo "dropping the scale-test dataset…"
  # Batched delete: a single DELETE of ~1M rows blows the statement timeout
  # (the same 57014 the Trump re-ingest hit with --recreate).
  while true; do
    n=$(psql "$DB" -t -A -c "WITH d AS (SELECT id FROM dataset_rows_flat WHERE dataset_id='$DST' LIMIT 50000) DELETE FROM dataset_rows_flat f USING d WHERE f.id=d.id RETURNING 1" | wc -l | tr -d ' ')
    echo "  deleted $n"
    [ "$n" = "0" ] && break
  done
  psql "$DB" -c "DELETE FROM dataset_state WHERE dataset_id='$DST'; DELETE FROM datasets WHERE id='$DST';"
  psql "$DB" -c "VACUUM ANALYZE dataset_rows_flat;"
  psql "$DB" -t -A -c "SELECT 'db now ' || pg_size_pretty(pg_database_size(current_database()));"
  exit 0
fi

TARGET="${1:?usage: _seed_scale_test.sh <target_rows>|drop}"

# Dataset + state (theme model copied from the source so theme-counts works).
psql "$DB" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO datasets (id, org_id, name, source, status, visibility, row_count, created_by)
SELECT '$DST', org_id, '[SCALE TEST] 1M', source, status, visibility, 0, created_by
FROM datasets WHERE id='$SRC'
ON CONFLICT (id) DO NOTHING;

INSERT INTO dataset_state (dataset_id, theme_model, schema_config)
SELECT '$DST', theme_model, schema_config FROM dataset_state WHERE dataset_id='$SRC'
ON CONFLICT (dataset_id) DO UPDATE SET theme_model=EXCLUDED.theme_model, schema_config=EXCLUDED.schema_config;
SQL

# Append in 100K batches until we hit the target, cycling the source rows.
while true; do
  HAVE=$(psql "$DB" -t -A -c "SELECT count(*) FROM dataset_rows_flat WHERE dataset_id='$DST'")
  echo "  have $HAVE / $TARGET"
  [ "$HAVE" -ge "$TARGET" ] && break
  psql "$DB" -v ON_ERROR_STOP=1 -q -c "
    INSERT INTO dataset_rows_flat (dataset_id, row_index, data, substantive, substantive_v)
    SELECT '$DST', $HAVE + (row_number() OVER ())::int - 1, s.data, s.substantive, s.substantive_v
    FROM (SELECT data, substantive, substantive_v FROM dataset_rows_flat
          WHERE dataset_id='$SRC' ORDER BY row_index LIMIT 100000) s;"
done

psql "$DB" -c "UPDATE datasets SET row_count=(SELECT count(*) FROM dataset_rows_flat WHERE dataset_id='$DST') WHERE id='$DST';"
psql "$DB" -c "ANALYZE dataset_rows_flat;"
psql "$DB" -t -A -F' | ' -c "
SELECT (SELECT row_count FROM datasets WHERE id='$DST') || ' rows',
       pg_size_pretty(pg_database_size(current_database())) AS db_total;"
