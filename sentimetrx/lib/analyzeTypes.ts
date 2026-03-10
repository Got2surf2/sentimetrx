// ============================================================
// SENTIMETRX -- Analyze Module Types
// lib/analyzeTypes.ts
// ============================================================

// Ana's 6 field types (from ana_spec Part 16)
export type AnaFieldType =
  | 'open-ended'
  | 'categorical'
  | 'numeric'
  | 'date'
  | 'id'
  | 'ignore'

// Single field configuration stored in schema_config
export interface SchemaFieldConfig {
  field:      string
  type:       AnaFieldType
  label?:     string                        // display label override
  remapping?: Record<string, number>        // e.g. { "Low": 1, "Med": 2, "High": 3 }
  hidden?:    boolean
}

// Full schema_config JSONB shape
export interface SchemaConfig {
  fields:           SchemaFieldConfig[]
  primaryTextField?: string                 // open-ended field targeted for TextMine
  autoDetected:     boolean                 // false once user confirms schema
  version:          number
}

// Single theme in the theme model
export interface AnaTheme {
  id:          string
  label:       string
  keywords:    string[]
  color:       string                       // hex from THEME_PALETTE
  description?: string
}

// Full theme_model JSONB shape
export interface ThemeModel {
  themes:      AnaTheme[]
  industry?:   string
  aiGenerated: boolean
  version:     number
}

// Saved chart config (opaque to Phase 1 -- Phase 2 fills this out)
export interface SavedChart {
  id:        string
  title:     string
  chartType: string
  config:    Record<string, unknown>
  createdAt: string
}

// Saved stat result (opaque to Phase 1 -- Phase 2 fills this out)
export interface SavedStat {
  id:       string
  title:    string
  testType: string
  inputs:   Record<string, unknown>
  results:  Record<string, unknown>
  createdAt: string
}

// Full dataset_state record
export interface DatasetState {
  id:            string
  dataset_id:    string
  schema_config: SchemaConfig
  theme_model:   ThemeModel
  saved_charts:  SavedChart[]
  saved_stats:   SavedStat[]
  filter_state:  Record<string, unknown>
  updated_at:    string
  updated_by:    string | null
}

// Dataset metadata record
export interface Dataset {
  id:             string
  name:           string
  description:    string | null
  source:         'upload' | 'study'
  study_id:       string | null
  org_id:         string
  client_id:      string | null
  created_by:     string
  visibility:     'private' | 'public'
  status:         'active' | 'archived'
  row_count:      number
  last_synced_at: string | null
  created_at:     string
  updated_at:     string
}

// Dataset with joined state (returned by GET /api/datasets/[id])
export interface DatasetWithState extends Dataset {
  state: DatasetState | null
}

// Raw batch record from dataset_rows table
export interface DatasetRowBatch {
  id:          string
  dataset_id:  string
  rows:        Record<string, unknown>[]
  row_count:   number
  batch_index: number
  source_ref:  string | null
  created_at:  string
}

// Org features flag (added to organizations table)
export interface OrgFeatures {
  analyze?: boolean
  // future paid features added here
}

// Filter state for the dataset list page
export interface DatasetListFilters {
  source:     'all' | 'upload' | 'study'
  visibility: 'all' | 'private' | 'public'
  status:     'all' | 'active' | 'archived'
}

// Default empty schema config
export function emptySchemaConfig(): SchemaConfig {
  return { fields: [], autoDetected: true, version: 1 }
}

// Default empty theme model
export function emptyThemeModel(): ThemeModel {
  return { themes: [], aiGenerated: false, version: 1 }
}

// Default empty dataset state (for POST /api/datasets)
export function emptyDatasetState(datasetId: string): Omit<DatasetState, 'id' | 'updated_at' | 'updated_by'> {
  return {
    dataset_id:    datasetId,
    schema_config: emptySchemaConfig(),
    theme_model:   emptyThemeModel(),
    saved_charts:  [],
    saved_stats:   [],
    filter_state:  {},
  }
}
