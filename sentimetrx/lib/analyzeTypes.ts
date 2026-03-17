// lib/analyzeTypes.ts
// All TypeScript interfaces for the Analyze module

export type AnaFieldType = 'open-ended' | 'categorical' | 'numeric' | 'date' | 'id' | 'ignore'

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
  field:         string
  type:          AnaFieldType
  sqt?:          AnaFieldSqt
  label?:        string
  remapping?:    Record<string, number>
  hidden?:       boolean
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

// -- Analytics types (pre-computed by /api/datasets/[id]/compute) -------
// Modules read these instead of loading raw rows.

export interface CategoricalSummary {
  type:       'categorical'
  nonNull:    number
  counts:     Record<string, number>   // value -> count, sorted desc
  topN:       string[]                 // top 20 values by count
  uniqueCount: number
}

export interface NumericSummary {
  type:      'numeric'
  nonNull:   number
  min:       number
  max:       number
  avg:       number
  median:    number
  stddev:    number
  histogram: HistogramBucket[]         // 10 equal-width buckets
}

export interface HistogramBucket {
  min:   number
  max:   number
  count: number
}

export interface OpenEndedSummary {
  type:         'open-ended'
  nonNull:      number
  avgWordCount: number
  sample:       string[]               // first 5 non-empty values
}

export interface DateSummary {
  type:    'date'
  nonNull: number
  min:     string
  max:     string
  counts:  Record<string, number>      // ISO date string -> count (daily/monthly)
}

export interface IgnoredSummary {
  type:    'id' | 'ignore'
  nonNull: number
}

export type FieldSummary =
  | CategoricalSummary
  | NumericSummary
  | OpenEndedSummary
  | DateSummary
  | IgnoredSummary

export interface DatasetAnalytics {
  totalRows:      number
  computedAt:     string
  fieldSummaries: Record<string, FieldSummary>
}

// -- Dataset state -------------------------------------------------------

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
  analytics:     DatasetAnalytics | null    // null = not yet computed
  updated_at:    string
  updated_by:    string | null
}

// -- Dataset metadata ----------------------------------------------------

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
  state?:        DatasetState
  study_name?:   string | null
  creator_name?: string | null
  org_name?:     string | null
}

// -- Paginated rows response (for TextMine) ------------------------------

export interface PagedRowsResponse {
  rows:       Record<string, unknown>[]
  page:       number
  pageSize:   number
  totalRows:  number
  totalPages: number
  field?:     string    // if filtered to single field
}
