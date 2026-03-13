// lib/analyzeTypes.ts
// All TypeScript interfaces for the Analyze module (Phase 1+)

export type AnaFieldType = 'open-ended' | 'categorical' | 'numeric' | 'date' | 'id' | 'ignore'

// Sub-type matching Ana's UNIFIED_TYPES sqt values
export type AnaFieldSqt =
  | 'open-text'
  | 'single-select'
  | 'multi-select'
  | 'likert'
  | 'rating'
  | 'nps'
  | 'numeric-input'
  | null

export interface SchemaFieldConfig {
  field:        string
  type:         AnaFieldType
  sqt?:         AnaFieldSqt
  label?:       string
  remapping?:   Record<string, number>
  hidden?:      boolean
  // Stats computed at schema-build time from raw rows
  nonNullCount?: number
  avgLen?:       string
  avgWords?:     string
  uniqueRatio?:  string
  sample?:       string[]
  values?:       string[]
  min?:          number
  max?:          number
  avg?:          string
}

export interface SchemaConfig {
  fields:            SchemaFieldConfig[]
  primaryTextField?: string
  autoDetected:      boolean
  version:           number
}

export interface AnaTheme {
  id:           string
  label:        string
  keywords:     string[]
  color:        string
  description?: string
}

export interface ThemeModel {
  themes:      AnaTheme[]
  industry?:   string
  aiGenerated: boolean
  version:     number
}

export interface SavedChart {
  id:        string
  title:     string
  chartType: string
  config:    Record<string, unknown>
  createdAt: string
}

export interface SavedStat {
  id:        string
  title:     string
  testType:  string
  inputs:    Record<string, unknown>
  results:   Record<string, unknown>
  createdAt: string
}

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

export interface Dataset {
  id:             string
  name:           string
  description:    string | null
  source:         'upload' | 'study'
  study_id:       string | null
  org_id:         string
  client_id:      string | null
  created_by:     string
  ana_library:    string | null
  visibility:     'private' | 'public'
  status:         'active' | 'archived'
  row_count:      number
  last_synced_at: string | null
  created_at:     string
  updated_at:     string
}

export interface DatasetRowBatch {
  id:          string
  dataset_id:  string
  rows:        Record<string, unknown>[]
  row_count:   number
  batch_index: number
  source_ref:  string | null
  created_at:  string
}

export interface ProcessedRow {
  [key: string]: unknown
}

export interface DatasetWithState extends Dataset {
  state?:      DatasetState
  study_name?: string | null
}
