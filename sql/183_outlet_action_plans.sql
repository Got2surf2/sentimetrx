-- sql/183_outlet_action_plans.sql
-- Cache for the Outlet Report's LLM-narrated "3 things to work on next" action
-- plan (Advanced Analytics ▸ Outlet Deep-Dive). Generating the plan is one
-- Claude call per outlet, so we cache it rather than regenerate on every view.
--
-- Stored as a per-dataset jsonb MAP keyed by outlet place_id:
--   { "<place_id>": { "basis": "<sig>", "plan": {...}, "generatedAt": "<iso>" } }
-- where `basis` is a signature of the plan's inputs (review count + the theme
-- table's per-theme READ verdicts). A view regenerates only when the basis
-- changes (the outlet gained reviews or a theme flipped verdict).
--
-- Lives on dataset_state (already RLS'd + org-scoped via dataset_id) so no new
-- table / policy is needed. Writes use an atomic top-level `||` merge keyed by
-- place_id, so concurrent generation for DIFFERENT outlets can't lost-update.

BEGIN;

ALTER TABLE "public"."dataset_state"
  ADD COLUMN IF NOT EXISTS "outlet_action_plans" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL;

COMMENT ON COLUMN "public"."dataset_state"."outlet_action_plans" IS
  'Cache of per-outlet LLM action plans for the Outlet Report, keyed by place_id: {place_id: {basis, plan, generatedAt}}. Regenerated when basis (review count + theme READ verdicts) changes.';

-- Atomic per-outlet merge (mirrors merge_dataset_analytics) — write one
-- place_id key without a racy read-modify-write of the whole map.
CREATE OR REPLACE FUNCTION "public"."merge_outlet_action_plan"("p_dataset_id" "uuid", "p_patch" "jsonb") RETURNS "void"
    LANGUAGE "sql"
    AS $$
  UPDATE dataset_state
  SET outlet_action_plans = COALESCE(outlet_action_plans, '{}'::jsonb) || p_patch
  WHERE dataset_id = p_dataset_id;
$$;

ALTER FUNCTION "public"."merge_outlet_action_plan"("p_dataset_id" "uuid", "p_patch" "jsonb") OWNER TO "postgres";

COMMENT ON FUNCTION "public"."merge_outlet_action_plan"("p_dataset_id" "uuid", "p_patch" "jsonb") IS
  'Atomically shallow-merges a per-outlet action-plan patch into dataset_state.outlet_action_plans (top-level place_id keys), preserving other outlets'' cached plans.';

COMMIT;
