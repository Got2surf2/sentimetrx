# How do I read the Statistics tab?

The **Statistics** tab (in Advanced Analytics, alongside TextMine) is for the
numbers behind your feedback — how ratings break down, what moves them, and
whether differences between groups are real.

## Charts

Build a chart by dragging fields into the chart slots. You can chart counts,
percentages, averages, and distributions, and split by a second field to compare
groups. Charts respect your active **Filters**, so what you see reflects the
segment you're looking at.

## Key Drivers

The **Key Drivers** insight ranks which factors are most associated with your
outcome (for example, what correlates with a top-box rating) so you can see what
matters most at a glance, without setting up a model yourself.

## Regression (Linear and Logistic)

For a deeper look, the regression panel fits a model over your data:

- **Linear** for a numeric outcome, **Logistic** for a yes/no outcome (like
  "gave a top rating: yes/no").
- It can use numeric fields, categorical fields, and themes as inputs, and it
  automatically drops inputs that are too tangled up with each other so the
  results stay trustworthy.
- Logistic results are shown as **odds ratios** — how much each factor raises or
  lowers the odds of the outcome.

## Likert questions

Likert-scale questions (agree/disagree style) are automatically given a numeric
score so you can average and chart them, while still keeping the original labels.
On charts, the scale is colored intuitively — low is red, high is green.

## A note on large datasets

For very large datasets, Statistics computes on a consistent, representative
sample rather than every row, so the tab stays fast. The numbers you see are the
exact counts *of that sample*.

## Want it in words?

To ask about the data conversationally instead of building a chart, use **Ask
Ana** in the dataset.
