# Analytics / TextMine Module

## Overview

Full-stack text analytics engine. AI-powered theme mining, lexicon-based sentiment scoring, 13+ chart types, statistical hypothesis testing, and consulting-quality PPTX export. Works with any data source: surveys, CSV uploads, Google Reviews, Town Hall responses.

---

## TextMine (Theme Detection & Analysis)

### Core Features (4 Sub-tabs)

**1. Themes**
- AI-mined or library-selected themes with keyword matching
- Each theme: name, description, keywords[], sentiment, count, percentage, confidence interval
- Per-keyword rating breakdowns (which keywords drive higher/lower scores)
- Dual color mode: sentiment gradient vs rating gradient
- Sampling control with 95% confidence margin-of-error display
- Breakdown by any categorical field (by group / by theme views)

**2. Word Cloud**
- Frequency-based keyword visualization
- Sized by mention count, colored by theme

**3. Compare / Crosstab**
- Cross-group analysis by categorical fields
- Stacked bar distributions
- Welch t-test for rating significance across groups
- Mention and rating comparison tables

**4. Comments**
- Paginated comment browser with keyword highlighting
- Filter by theme, sentiment, or custom criteria
- Clause-boundary highlight expansion (not just the keyword, but surrounding context)

---

## Theme Mining (AI-Powered)

### API: `POST /api/datasets/[id]/mine-themes`
- Uses Claude to extract 4-7 distinct themes with 8-15 keywords each
- Keywords include: core terms, synonyms, informal variants, short phrases
- Input: 10-100 text samples + field name + schema context
- Uses user's own Claude API key (stored in browser localStorage only)

### recountThemes() — Core Algorithm (`lib/themeUtils.ts`)
1. Filter rows to non-empty text
2. Pre-compile keyword regexes (lemma-aware, case-insensitive)
3. Per theme: count matching rows, score sentiment, accumulate ratings
4. Compute: percentage, Wilson 95% CI, sentiment classification, avgRating, ratingDelta, per-keyword ratings
5. Performance: O(rows x themes x keywords), single pass

### Sentiment Scoring (Lexicon-Based)
- POS_WORDS: good, great, excellent, amazing, friendly, clean, helpful, etc.
- NEG_WORDS: bad, terrible, slow, rude, dirty, expensive, disappointing, etc.
- Negation handling: "not good" flips polarity (checks up to 3 preceding words)
- Classification: positive (>=70% pos), negative (<=30% pos), mixed, neutral (insufficient data)

---

## Charts Module (13+ Types)

| Chart | Slots | Use Case |
|-------|-------|----------|
| Bar/Column | category (req), colorBy, value | Counts across categories |
| Distribution | numeric (req) | Histogram or box plot |
| Scatter | x-numeric, y-numeric | Two-variable relationship |
| Crosstab | rows (req), cols (req) | Heatmap with chi-square test |
| Time Series | date (req), metric, colorBy | Metric over time with breakdown |
| Treemap | category (req), size | Hierarchical rectangles |
| Packed Bubbles | category, size | Circles sized by measure |
| Waterfall | category (req), value | Running total contribution |
| Bullet/KPI | measure (req) | Gauge with performance bands |
| Funnel | category (req), value | Ranked bars |
| Gantt/Range | category, min, max | Min-max range bars |
| Score Driver | themes, rating | Which themes drive scores |
| Data Table | any fields | Sortable, filterable table |

### Drag-to-Assign Interface
- Drag fields from sidebar to chart slots
- Smart slot selection: prefers empty required > empty optional > replace
- Session caching for chart state persistence
- Color palettes: Hermes, Ocean, Sunset, Earth, Pastel, Vivid, Mono

---

## Statistics Module (Hypothesis Testing)

### 5 Statistical Panels

**1. Univariate Descriptive**
- Mean, median, std dev, min, max, Q1/Q3, skewness, kurtosis
- Shapiro-Wilk normality test
- Bootstrap CI (2000 iterations) on mean, median, std

**2. Bivariate Relationships**
- Pearson r (linear correlation) with p-value and 95% CI
- Spearman rho (rank correlation, handles non-linear)

**3. Group Comparisons**
- Welch's t-test (two groups, unequal variance) + Cohen's d
- Mann-Whitney U (non-parametric rank test with tie correction)
- One-Way ANOVA (k groups) + pairwise Tukey HSD post-hocs

**4. Contingency Tables**
- Chi-square test of independence + Cramer's V
- Observed vs expected frequencies

**5. Linear Regression**
- OLS with interaction terms
- Coefficient p-values, 95% CI per term
- R-squared, adjusted R-squared, F-statistic
- Residuals for diagnostics

### Statistical Infrastructure (`lib/statsUtils.ts`)
- Distribution functions: t, F, chi-square, normal CDF
- Matrix operations: Gaussian elimination for regression
- Effect sizes: Cohen's d, eta-squared, Cramer's V
- Significance labels: *** p<.001, ** p<.01, * p<.05

---

## Filters & Breakdown

### Filter Types
- **Categorical**: Checkboxes with "exclude blanks"
- **Numeric Range**: Min-max slider with "include blanks"
- **Date Range**: ISO date picker

### Global Filter Architecture
- Serializable: `serializeFilters()` / `deserializeFilters()` for URL/storage
- Application: `applyFilters(rows, filters)` returns filtered array
- Context Provider for app-wide state

### Value Aliases (`lib/aliasUtils.ts`)
- Remap categorical values for display (e.g., "1" -> "Very Satisfied")
- Applied in: filters, chart axes, statistics output, breakdown labels, exports

---

## Export Features

### PPTX (Consulting-Quality Deck)
- **API**: `POST /api/datasets/[id]/export/pptx`
- **Audience levels**: Executive (short), Stakeholder (charts + fields), Full Team (everything)
- **Slides**: Title, executive summary, NPS/rating distributions, theme deep-dives (keywords + quotes), sentiment breakdown, theme impact on scores, field breakdowns, demographic annotations, methodology appendix
- **Branding**: Datanautix palette (navy, teal, gold), logo top-right, full dates
- **Quote selection**: `pickBestComments()` selects 2-3 representative quotes per theme
- **Version numbering**: StoryTime v1.2.0 on About slide

### HTML (Shareable Dashboard)
- **API**: `POST /api/datasets/[id]/export/html`
- Interactive HTML with embedded Plotly charts
- Responsive for mobile/desktop
- Shareable via link with expiry

### CSV
- Standard row export with filtering
- Configurable columns and sections

---

## Analytics Computation Pipeline

### Server-Side (`lib/analyticsCompute.ts`)
- Batch processing: 500 records per DB trip
- Running accumulators per field type
- Reservoir sampling for numerics (50K max)
- Output: `DatasetAnalytics` JSON with per-field summaries

### Computation Triggers
- After upload batch completion
- After Google Reviews sync
- Manual re-compute from settings

---

## Shared Dashboards

### Public Sharing (`app/shared/[token]/`)
- Token-based access (no login required, read-only)
- Expiry options: 24h, 7d, 30d
- Response metrics, sentiment distribution, NPS trend, volume chart
- Theme visualization, auto-refresh
- Audit: all access logged with `last_accessed_at`

### Shared Analytics Links (Filtered vs Benchmark)
- **Purpose**: Send a stakeholder a view of how their subset (e.g., a specific restaurant) performs vs the system aggregate, without exposing individual data from other entities
- **Share type**: `analytics` — stored in `shared_links` with filter criteria in `metadata` JSONB
- **API**: `GET /api/share/analytics?token=...` — splits `dataset_rows_flat` into filtered and benchmark sets, returns only aggregates
- **UI**: "Share Analytics" button in Ana header bar opens `ShareAnalyticsModal` — use current active filters or pick new categorical filters, set label + expiry
- **Outlier Detection**:
  - **Numeric metrics**: z-score comparison of filtered mean vs benchmark (Welch-style SE). Flagged at p<0.05
  - **Theme frequencies**: two-proportion z-test of filtered rate vs benchmark rate. Flagged at p<0.05
- **Privacy safeguards**: minimum sample sizes enforced (n=10 filtered, n=10 benchmark, n=5 theme count). Benchmark data is aggregate-only — no individual rows or identifiable data exposed
- **Shared view**: side-by-side bars for each metric/theme, green/red outlier badges with p-values, filter criteria pills in header

---

## Key Files

| File | Purpose |
|------|---------|
| `components/analyze/TextMineModule.tsx` | Main shell, 4 sub-tabs (3000+ lines) |
| `components/analyze/ChartsModule.tsx` | Chart builder (3500+ lines) |
| `components/analyze/StatsModule.tsx` | Statistics (3000+ lines) |
| `components/analyze/ExportModal.tsx` | Export workflow (1500+ lines) |
| `components/analyze/FiltersModal.tsx` | Filter UI (1200+ lines) |
| `components/analyze/textmine/BreakdownDist.tsx` | Breakdown visualization |
| `components/analyze/textmine/CommentsPanel.tsx` | Comment browser |
| `components/analyze/textmine/ThemeEditor.tsx` | Theme CRUD |
| `lib/themeUtils.ts` | recountThemes(), sentiment, keyword matching |
| `lib/filterUtils.ts` | Filter types & applyFilters() |
| `lib/statsUtils.ts` | All statistical functions |
| `lib/analyticsCompute.ts` | Server-side computation |
| `lib/analyzeTypes.ts` | TypeScript interfaces |
| `lib/timeBucket.ts` | Time series bucketing (hourly/daily/weekly/monthly/quarterly) |
| `lib/aliasUtils.ts` | Value aliases & remapping |
| `components/analyze/ShareAnalyticsModal.tsx` | Share analytics link creator |
| `app/api/share/analytics/route.ts` | Filtered vs benchmark analytics API |
| `app/api/datasets/[id]/` | All dataset API routes |
