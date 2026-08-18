# What are Dimensions and emotion flags?

**Dimensions** is a lens in **TextMine** that tags each comment across a set of
structured axes — a more organized view than themes. Where themes surface the
topics people bring up, Dimensions classifies *what kind* of thing each comment is
about, consistently, across every response.

## How do I turn Dimensions on?

Dimensions are **not** on automatically — you switch them on once per dataset and a
one-off classification pass tags every comment.

1. Open the dataset, go to **Advanced Analytics** → **TextMine**, and open the
   **Dimensions** section.
2. If you see *"Pick a field to analyze"*, choose an open-ended field first using
   the field toggle at the top of TextMine. You can select more than one.
3. Click **Enable Dimensions**.

That single button does both things: it turns Dimensions on for the dataset and
classifies your comments. A progress bar shows how many rows have been scanned —
keep the tab open while it runs, and you can leave it running.

Classification is keyword-based and runs in one pass, so there's no AI cost and no
waiting on a model.

What you get depends on the data. **Restaurant data** — Google reviews, or an
organisation in the restaurant industry — gets the full restaurant taxonomy:
service, food, drinks, ambiance, value and more, each with sentiment and severity.
**Every other dataset** gets the universal **Emotion** dimension described below.

### If you don't see a Dimensions section at all

Open the **Schema** tab and tick **Apply Dimensions**. That reveals the
**Dimensions** section for the dataset, plus dimension breakdowns in **Charts** and
**Statistics**. You don't need this step for Google-reviews datasets or
restaurant-industry organisations — those are already eligible, so you can go
straight to **Enable Dimensions**.

## The Dimensions axes

Open a dataset in **Advanced Analytics**, go to **TextMine**, and open the
**Dimensions** section. Each comment is tagged across axes such as **touchpoint**,
**attribute**, **product**, and more. You'll see:

- **Axis pills** you can click to drill into an axis and its sub-dimensions.
- Sub-dimension cards showing the star rating, positive/negative sentiment, and
  how much of the axis each one represents.
- A **Severity** flag that marks comments as normal, alert, or crisis — handy for
  catching the issues that need attention first.

Dimensions are tagged on the open-ended field(s) you selected when you turned them
on, and the view reflects the comments in your current selection. Tagging is not
automatic — you enable it once per dataset and a classification pass runs. See
**How do I turn Dimensions on?** below.

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
