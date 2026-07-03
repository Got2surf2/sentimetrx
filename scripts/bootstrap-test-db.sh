#!/usr/bin/env bash
# Bootstrap a dedicated Supabase TEST project with the current prod schema, so
# the isolation/egress/auth-flow suites (and local dev) can stop running against
# the production database.
#
# WHY a schema DUMP, not the sql/ files: sql/ has numbered + unnumbered +
# one-off migrations with gaps, and supabase/migrations is empty — replaying them
# cleanly onto a fresh DB is unreliable. A schema-only dump of prod is the source
# of truth for the *current* shape.
#
# PREREQUISITE (owner, one-time): create the paid Supabase test project in the
# dashboard, then grab its Postgres connection string (Project Settings →
# Database → Connection string → URI) and its anon + service_role keys
# (Project Settings → API).
#
# Usage:
#   TEST_DB_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres' \
#     bash scripts/bootstrap-test-db.sh
#
# This is schema-only — NO data is copied, so no tenant data leaves prod.
#
# NOTE: FRESH databases only — the dump is not idempotent against an existing
# schema (CREATE SEQUENCE collides). For incremental parity after a single
# prod migration, apply the migration file directly instead:
#   psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -f sql/NNN_name.sql
set -euo pipefail

if [ -z "${TEST_DB_URL:-}" ]; then
  echo "ERROR: set TEST_DB_URL to the test project's Postgres connection string." >&2
  echo "  (Supabase dashboard → Project Settings → Database → Connection string → URI)" >&2
  exit 1
fi

DUMP_FILE="$(mktemp -t sentimetrx-schema.XXXXXX.sql)"
trap 'rm -f "$DUMP_FILE"' EXIT

echo "==> Dumping PROD schema (schema-only, no data) via the linked Supabase CLI…"
supabase db dump --linked --schema public -f "$DUMP_FILE"
echo "    wrote $(wc -l < "$DUMP_FILE") lines to a temp file"

echo "==> Applying schema to the TEST project…"
psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -f "$DUMP_FILE"

echo ""
echo "✅ Test project schema is in place. Next (owner):"
echo "   1. Point the CI isolation job at the test project — set these three"
echo "      GitHub secrets to the TEST project's values (they currently hold PROD):"
echo "        gh secret set SUPABASE_TEST_URL"
echo "        gh secret set SUPABASE_TEST_ANON_KEY"
echo "        gh secret set SUPABASE_TEST_SERVICE_ROLE_KEY"
echo "   2. (optional) For local isolation runs, put the same TEST values in"
echo "      .env.local under the same names before 'npm run test:rls'."
echo "   3. Re-run the schema dump after any prod migration so the test DB keeps"
echo "      parity: TEST_DB_URL=... bash scripts/bootstrap-test-db.sh"
