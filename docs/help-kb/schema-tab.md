# How do I set up my data (the Schema tab)?

The **Schema** tab is where you tell Sentimetrx what each column in your dataset
is — which columns are open-ended text, which are ratings, which are just labels.
Getting this right is what makes themes, charts, and statistics work correctly, so
it's worth a quick pass before you dig in.

## Set a type for each field

Every column gets a **field type**. Open the **Schema** tab and pick the type that
matches the data:

- **Open-ended** — free-text answers and comments. These are the columns TextMine
  mines for themes, entities, and dimensions, so mark every comment column here.
- **Categorical** — a fixed set of labels (region, plan, location, yes/no). Used to
  split charts and compare segments.
- **Numeric** — numbers you want to average or chart (a 1–10 score, an amount).
- **Date** — dates, so you can trend results over time and filter by date range.
- **ID** — a respondent or record identifier. Kept for reference, not analyzed.
- **Ignore** — columns you don't need. Set these to Ignore so they stay out of your
  charts and pickers.

If you uploaded a CSV, Sentimetrx auto-detects a type for each column. Always
skim the results and correct anything it guessed wrong — a comment column typed as
categorical won't be mined for themes.

## Rename fields and set export names

You can give any field a friendlier **label** so it reads clearly in charts,
filters, and the Statistics tab — for example turning a cryptic column header into
"Overall satisfaction." You can also set an **export name**, which controls the
column heading used when you export the data or a report. Your original data isn't
changed; you're just relabeling how it's shown and exported.

## When it matters most

Come back to the Schema tab whenever a chart or filter is missing a field, or a
comment column isn't producing themes — the usual fix is a corrected field type
here. If you want to ask what the data actually *says*, that's a job for **Ask Ana**
inside the dataset, not the Schema tab.
