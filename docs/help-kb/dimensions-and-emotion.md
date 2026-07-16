# What are Dimensions and emotion flags?

**Dimensions** is a lens in **TextMine** that tags each comment across a set of
structured axes — a more organized view than themes. Where themes surface the
topics people bring up, Dimensions classifies *what kind* of thing each comment is
about, consistently, across every response.

## The Dimensions axes

Open a dataset in **Advanced Analytics**, go to **TextMine**, and open the
**Dimensions** section. Each comment is tagged across axes such as **touchpoint**,
**attribute**, **product**, and more. You'll see:

- **Axis pills** you can click to drill into an axis and its sub-dimensions.
- Sub-dimension cards showing the star rating, positive/negative sentiment, and
  how much of the axis each one represents.
- A **Severity** flag that marks comments as normal, alert, or crisis — handy for
  catching the issues that need attention first.

Dimensions are computed on the open-ended field(s) you're looking at and update
as you change your selection, so the view always reflects your current comments.

## Emotion-language flags

Alongside the axes, Dimensions surfaces **emotion-language flags** — signals like
**disappointment** or **churn-intent** language in a comment. Every flag is always
backed by the exact quote as evidence, so you can read the words that triggered it.

One important framing: these flags describe the **language in the comment**, not a
person's inner state. Sentimetrx says a comment *"contains disappointment
language"* — never *"the customer felt disappointed."* If nothing emotional shows
up in a dataset, the flags simply don't appear, so you won't see a misleading
"0% emotion."

## Want the takeaway in words?

To ask about what's driving those flags — "what are people disappointed about?" —
use **Ask Ana** inside the dataset. It reads the same comments and answers in plain
language.
