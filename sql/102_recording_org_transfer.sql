-- sql/102_recording_org_transfer.sql
-- Cross-org transfer for a Town Hall recording (docs/RECORDINGS.md §4.x, #3c).
--
-- A recording is a graph, not one row: the recording + its files, transcript,
-- extractions, and derived dataset all carry org_id, and the report/PDF/export
-- surfaces pair recording_id WITH org_id. A shallow "update recordings.org_id"
-- would orphan the children (they'd keep the old org_id) and the recording
-- would read empty in the new org. So the DB half of the move must update every
-- org_id atomically — hence this RPC (one transaction) instead of N client-side
-- updates. Storage objects are relocated separately in the route (Postgres and
-- Storage can't share a transaction); this function also rewrites the embedded
-- <org_id>/ prefix in the stored path columns to match the moved objects.
--
-- 1) org_transfers audit log gains the 'recording' resource type.
-- 2) transfer_recording_org(): the atomic graph move, paired with p_from_org so
--    a stale/forged source org can't move another tenant's recording.

BEGIN;

ALTER TABLE org_transfers
  DROP CONSTRAINT IF EXISTS org_transfers_resource_type_check;
ALTER TABLE org_transfers
  ADD CONSTRAINT org_transfers_resource_type_check
  CHECK (resource_type IN ('bot', 'study', 'dataset', 'townhall_session', 'recording'));

CREATE OR REPLACE FUNCTION transfer_recording_org(
  p_recording_id uuid,
  p_from_org     uuid,
  p_to_org       uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dataset_id uuid;
BEGIN
  -- Lock + verify the recording is actually in the claimed source org. Pairing
  -- on org_id here is the cross-tenant guard: a wrong p_from_org finds nothing.
  SELECT dataset_id INTO v_dataset_id
  FROM recordings
  WHERE id = p_recording_id AND org_id = p_from_org
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'recording % not found in org %', p_recording_id, p_from_org;
  END IF;

  -- Children (each paired with from_org). recording_files also carries the
  -- <org_id>/<recording_id>/... storage paths → rewrite the org prefix so the
  -- columns match where the route just moved the objects.
  UPDATE recording_files
     SET org_id = p_to_org,
         storage_path = replace(storage_path, p_from_org::text || '/', p_to_org::text || '/'),
         audio_storage_path = CASE
           WHEN audio_storage_path IS NULL THEN NULL
           ELSE replace(audio_storage_path, p_from_org::text || '/', p_to_org::text || '/')
         END
   WHERE recording_id = p_recording_id AND org_id = p_from_org;

  UPDATE recording_transcripts SET org_id = p_to_org
   WHERE recording_id = p_recording_id AND org_id = p_from_org;

  UPDATE recording_extractions SET org_id = p_to_org
   WHERE recording_id = p_recording_id AND org_id = p_from_org;

  -- Derived dataset (1:1). dataset_rows_flat has no org_id — it's keyed by
  -- dataset_id, so it follows the dataset automatically.
  IF v_dataset_id IS NOT NULL THEN
    UPDATE datasets SET org_id = p_to_org
     WHERE id = v_dataset_id AND org_id = p_from_org;
  END IF;

  UPDATE recordings SET org_id = p_to_org
   WHERE id = p_recording_id AND org_id = p_from_org;
END;
$$;

-- SECURITY DEFINER + public schema = exec-granted to PUBLIC by default, which
-- would let any authenticated tenant move recordings across orgs via PostgREST
-- /rpc, bypassing the route's platform-admin gate. Lock it to service_role.
REVOKE ALL ON FUNCTION transfer_recording_org(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION transfer_recording_org(uuid, uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION transfer_recording_org(uuid, uuid, uuid) TO service_role;

COMMIT;
