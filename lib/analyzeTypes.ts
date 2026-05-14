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

export type FieldSection = 'core' | 'psychographic' | 'demographic' | 'custom' | 'url_param' | null

export interface SchemaFieldConfig {
  field:          string
  type:           AnaFieldType
  sqt?:           AnaFieldSqt
  section?:       FieldSection    // grouping: psychographic, demographic, or core
  label?:         string
  prompt?:        string          // original survey question text (full, untruncated)
  remapping?:     Record<string, number>
  valueAliases?:  Record<string, string>
  hidden?:        boolean
  status?:        string          // 'ignored' etc — used to hide fields in UI
  scoreField?:    boolean
  nonNullCount?:  number
  avgLen?:        string
  avgWords?:      string
  uniqueRatio?:   string
  sample?:        string[]
  values?:        string[]
  min?:           number
  max?:           number
  avg?:           string
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
  type:        'categorical'
  nonNull:     number
  counts:      Record<string, number>   // value -> count, sorted desc
  topN:        string[]                 // top 20 values by count
  values?:     string[]                 // all unique values sorted by count (up to 500)
  uniqueCount: number
  uniqueRatio?: number                  // uniqueCount / nonNull — high = possible id field
}

export interface NumericSummary {
  type:         'numeric'
  nonNull:      number
  min:          number
  max:          number
  avg:          number
  median:       number
  stddev:       number
  p25?:         number                  // 25th percentile
  p75?:         number                  // 75th percentile
  histogram:    HistogramBucket[]       // 10 equal-width buckets
  valueCounts?: Record<string, number>  // for discrete numerics (1-5 ratings) — value -> count
  uniqueCount?: number                  // number of distinct values
  isDiscrete?:  boolean                 // true if ≤20 unique values (rating scales etc)
}

export interface HistogramBucket {
  min:   number
  max:   number
  count: number
}

export interface OpenEndedSummary {
  type:          'open-ended'
  nonNull:       number
  avgWordCount:  number
  avgCharLen?:   number                 // average character length
  maxCharLen?:   number                 // longest response
  sample:        string[]               // first 10 non-empty values
}

export interface DateSummary {
  type:    'date'
  nonNull: number
  min:     string
  max:     string
  counts:  Record<string, number>      // ISO date string -> count (daily/monthly)
}

export interface IgnoredSummary {
  type:         'id' | 'ignore'
  nonNull:      number
  uniqueCount?: number                 // how many distinct values
  sample?:      string[]               // first 5 values
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
  source:         'upload' | 'study' | 'google_reviews' | 'reddit' | 'townhall' | 'substack' | 'collection' | 'regulations'
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
  state?:          DatasetState
  study_name?:     string | null
  theme_count?:    number
  theme_source?:   string
  theme_lib_name?: string
  creator_name?:   string
  creator_email?:  string
  org_name?:       string
  // Set on source='collection' rows: 'brand' = auto-curated by brand_tag,
  // 'manual' = user-curated. member_count + collection_id are the
  // collections-table id and member tally for that virtual dataset.
  collection_kind?:     'manual' | 'brand' | null
  member_count?:        number
  collection_id?:       string | null
  // Set on member datasets: the brand-collection they belong to. Drives
  // hiding them from the flat /analyze grid (shown via brand drill-in).
  brand_collection_id?: string | null
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

// -- Google Reviews types --------------------------------------------------

export interface ReviewSource {
  id:                    string
  org_id:                string
  dataset_id:            string | null
  brand_name:            string
  status:                'pending' | 'searching' | 'active' | 'paused' | 'error'
  sync_frequency_hours:  number
  last_synced_at:        string | null
  next_sync_at:          string | null
  error_message:         string | null
  created_by:            string
  created_at:            string
  updated_at:            string
}

export interface ReviewSourceLocation {
  id:                string
  review_source_id:  string
  place_id:          string
  name:              string
  address:           string | null
  city:              string | null
  state:             string | null
  zip:               string | null
  rating:            number | null
  review_count:      number
  selected:          boolean
  last_review_id:    string | null
  last_review_date:  string | null
  total_pulled:      number
  last_synced_at:    string | null
  error_message:     string | null
  created_at:        string
}

// -- Reddit types -------------------------------------------------------------

export interface RedditSource {
  id:              string
  org_id:          string
  dataset_id:      string | null
  search_query:    string
  subreddits:      string[]
  status:          'pending' | 'downloading' | 'done' | 'error'
  total_posts:     number
  total_comments:  number
  error_message:   string | null
  created_by:      string
  created_at:      string
  updated_at:      string
}

export interface RedditSourceThread {
  id:                string
  reddit_source_id:  string
  thread_id:         string
  subreddit:         string
  title:             string
  author:            string | null
  score:             number
  comment_count:     number
  permalink:         string | null
  created_utc:       string | null
  selected:          boolean
  total_pulled:      number
  error_message:     string | null
  created_at:        string
}
