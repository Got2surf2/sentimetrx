# What is Advanced Analytics (multi-location reporting)?

**Advanced Analytics** is a section of **TextMine**, sitting alongside Themes,
Dimensions and Entities in the section bar. It's for brands with **many
locations**: instead of asking "what are people saying?", it asks "**which of my
locations is this happening at, and how does each one compare?**"

It only appears for datasets that support it — see *Why can't I see it?* below.

## The three views

Pick **Advanced Analytics** in the section bar and you get three views:

- **Brand Health** — the chain-wide picture. Which issues are dragging the brand
  down, which locations are worst affected, and a recommended-actions playbook.
- **Leaderboard** — the inverse of a single-location view: for every theme and
  dimension, the best and worst locations, ranked. Good for "who's strong on
  service, who's weak on wait times".
- **Outlet Deep-Dive** — one location, in full: its rating distribution, how it
  ranks in the network, what guests talk about there and how each topic scores,
  a per-dimension comparison against the network, and an action plan for that
  location's manager.

## Why can't I see it?

Two things both have to be true.

1. **It has to be switched on.** Advanced Analytics is a capability, not
   something every dataset gets automatically. It can be enabled for your whole
   organization, or per dataset on the **Schema** tab (tick *Enable the
   Leaderboard & Outlet Deep-Dive*). Your account team can turn it on for the
   organization.
2. **The data has to identify locations.** Today that means a Google-reviews
   dataset with at least five locations. On the **Schema** tab you can also mark
   the column that identifies a location — and add broader columns above it
   (Region → District → Store) so reports roll up to each level.

If the section isn't in the bar, start with the **Schema** tab.

## Reading the comparisons

Most of Advanced Analytics is **relative**: it compares one location against the
rest of the network rather than against a fixed target. A bar reading *+25* means
this location is 25 percentage points better than the network average on that
item, not that 25% of guests said it. Each view names the figure it's using and
how many mentions sit behind it, so a number based on a handful of comments is
visibly a small number.

## Want the takeaway in words?

Advanced Analytics tells you *where* and *how much*. To ask *why* — "what are
people at this location actually unhappy about?" — use **Ask Ana** inside the
dataset.
