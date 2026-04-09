-- Phase 6: User management, cascade verification, archive infrastructure
-- Run in Supabase SQL Editor

-- ============================================================
-- 1. Verify and fix CASCADE rules on dataset child tables
-- ============================================================

-- Check current foreign key constraints
SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table, rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND (tc.table_name LIKE 'dataset%' OR ccu.table_name = 'datasets')
ORDER BY tc.table_name;

-- If dataset_rows or dataset_state don't have ON DELETE CASCADE, add it:
-- (These are safe to run even if CASCADE already exists — they'll just error harmlessly)

-- dataset_rows: ensure CASCADE
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
    WHERE tc.table_name = 'dataset_rows' AND rc.delete_rule != 'CASCADE'
  ) THEN
    -- Drop and recreate the constraint with CASCADE
    EXECUTE (
      SELECT 'ALTER TABLE dataset_rows DROP CONSTRAINT ' || tc.constraint_name || '; ALTER TABLE dataset_rows ADD CONSTRAINT ' || tc.constraint_name || ' FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE;'
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'dataset_rows' AND tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = 'dataset_id'
      LIMIT 1
    );
    RAISE NOTICE 'Fixed dataset_rows CASCADE';
  ELSE
    RAISE NOTICE 'dataset_rows CASCADE OK';
  END IF;
END $$;

-- dataset_state: ensure CASCADE
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
    WHERE tc.table_name = 'dataset_state' AND rc.delete_rule != 'CASCADE'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE dataset_state DROP CONSTRAINT ' || tc.constraint_name || '; ALTER TABLE dataset_state ADD CONSTRAINT ' || tc.constraint_name || ' FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE;'
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'dataset_state' AND tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = 'dataset_id'
      LIMIT 1
    );
    RAISE NOTICE 'Fixed dataset_state CASCADE';
  ELSE
    RAISE NOTICE 'dataset_state CASCADE OK';
  END IF;
END $$;

-- ============================================================
-- 2. Archive infrastructure for datasets
-- ============================================================

-- Add archive columns to datasets table
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS archived_by uuid;

-- Archive tables — same structure as originals, no foreign key constraints
CREATE TABLE IF NOT EXISTS archived_dataset_rows (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_id  uuid NOT NULL,
  batch_index int NOT NULL DEFAULT 0,
  rows        jsonb NOT NULL DEFAULT '[]',
  row_count   int DEFAULT 0,
  source_ref  text,
  created_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS archived_dataset_rows_flat (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_id  uuid NOT NULL,
  row_index   int NOT NULL DEFAULT 0,
  data        jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adr_dataset ON archived_dataset_rows(dataset_id);
CREATE INDEX IF NOT EXISTS idx_adrf_dataset ON archived_dataset_rows_flat(dataset_id);

-- Function to archive a dataset (move rows to archive tables, keep dataset record)
CREATE OR REPLACE FUNCTION archive_dataset(p_dataset_id uuid, p_user_id uuid DEFAULT NULL)
RETURNS void AS $$
BEGIN
  -- Copy rows to archive tables
  INSERT INTO archived_dataset_rows (dataset_id, batch_index, rows, row_count, source_ref, created_at)
  SELECT dataset_id, batch_index, rows, row_count, source_ref, created_at
  FROM dataset_rows WHERE dataset_id = p_dataset_id;

  INSERT INTO archived_dataset_rows_flat (dataset_id, row_index, data, created_at)
  SELECT dataset_id, row_index, data, created_at
  FROM dataset_rows_flat WHERE dataset_id = p_dataset_id;

  -- Delete from primary tables
  DELETE FROM dataset_rows_flat WHERE dataset_id = p_dataset_id;
  DELETE FROM dataset_rows WHERE dataset_id = p_dataset_id;

  -- Mark dataset as archived
  UPDATE datasets SET
    status = 'archived',
    archived_at = now(),
    archived_by = p_user_id,
    updated_at = now()
  WHERE id = p_dataset_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to restore a dataset from archive
CREATE OR REPLACE FUNCTION restore_dataset(p_dataset_id uuid)
RETURNS void AS $$
BEGIN
  -- Copy rows back from archive
  INSERT INTO dataset_rows (dataset_id, batch_index, rows, row_count, source_ref, created_at)
  SELECT dataset_id, batch_index, rows, row_count, source_ref, created_at
  FROM archived_dataset_rows WHERE dataset_id = p_dataset_id;

  INSERT INTO dataset_rows_flat (dataset_id, row_index, data, created_at)
  SELECT dataset_id, row_index, data, created_at
  FROM archived_dataset_rows_flat WHERE dataset_id = p_dataset_id;

  -- Clean up archive
  DELETE FROM archived_dataset_rows_flat WHERE dataset_id = p_dataset_id;
  DELETE FROM archived_dataset_rows WHERE dataset_id = p_dataset_id;

  -- Restore dataset status
  UPDATE datasets SET
    status = 'active',
    archived_at = NULL,
    archived_by = NULL,
    updated_at = now()
  WHERE id = p_dataset_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 3. Verify
-- ============================================================
SELECT 'archive_dataset' AS func, 'ready' AS status
UNION ALL SELECT 'restore_dataset', 'ready'
UNION ALL SELECT 'archived_dataset_rows', (SELECT count(*)::text FROM archived_dataset_rows)
UNION ALL SELECT 'archived_dataset_rows_flat', (SELECT count(*)::text FROM archived_dataset_rows_flat);
