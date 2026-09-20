# spenT — handoff

Last worked on: 16 Sep 2026.

## Where things stand

The app is **feature-complete for v1 and working end to end**. Every feature agreed so
far is built and was verified in a browser against real numbers, not just eyeballed.

You can import a CSV or Excel statement through a column mapper, spends get auto-tagged
by editable rules, and you can correct any spend by hand (tag, merchant, notes, amount,
date) or add one from scratch. Transfers and one-offs can be excluded from totals,
refunds pull their tag down instead of counting as income, merchants are grouped so
branches of the same shop read as one, and budgets are tracked per tag plus an overall
monthly cap. The Overview carries a fixed-vs-variable split with recurring-subscription
detection and price-change flags.

**Nothing is half-built.** There's no work-in-progress to pick up mid-thought; the next
session starts from a clean, working state.

## Do this first

**There is no git repository.** The whole project is loose files on disk with no history
and no backup. One bad edit loses everything. Before doing any further work:

```bash
git init && git add -A && git commit -m "spenT v1: dashboard, import, tagging, budgets, recurring"
```

If you want it backed up off-machine too, ask the agent to save the project on Cursor.

## Running it

```bash
npm install     # only if node_modules is missing
npm run dev
```

Open <http://localhost:5173>. The API runs alongside on port 3456.

Quick check that both halves are alive:

```bash
curl -s localhost:3456/api/bootstrap | head -c 80   # API + database
curl -s -o /dev/null -w "%{http_code}\n" localhost:5173/   # UI
```

If a start fails with `EADDRINUSE`, something is holding a port:

```bash
lsof -ti:3456 -ti:5173 | xargs kill -9
```

The database currently holds the **sample data**: 105 transactions across May–Sep 2026,
4 savings transfers marked excluded, budgets set (overall $4,200; Housing $2,500,
Groceries $600, Dining $120, Subscriptions $40), and one rule learned by hand
(`unknown cafe newtown` → Coffee). To start fresh, stop the servers, delete `spent.db*`
from the data directory printed at startup (on macOS `~/Library/Application
Support/spenT`), and restart — tags and rules reseed automatically, and the empty state
offers a **Load sample data** button. For a scratch database that leaves your real one
untouched, run `SPENT_DATA_DIR=/tmp/spent-scratch npm run dev` instead.

The data directory sits outside the repo on purpose: spending data must never be
committable. `server/db.js` resolves it per platform, `SPENT_DATA_DIR` overrides it, and
`.gitignore` denies everything under `data/` except the synthetic `sample.csv`.

## Code map

Roughly 4,500 lines. No framework on the client, no ORM on the server — plain JS both
sides, which keeps it easy to read but means there's no type checking.

```
server/
  db.js          757 lines. SQLite schema + every query. The money arithmetic lives
                 here in the SPEND and INCOME SQL fragments — read those first.
  parse.js       CSV/Excel reading, column guessing, date/amount parsing, and
                 deriveMerchant() (the merchant-grouping heuristic).
  rules.js       Applies tagging rules; suggests a pattern for "always tag like this".
  recurring.js   Recurring detection and the fixed-vs-variable split. All the
                 thresholds are named constants at the top.
  api.js         Express routes. Thin — logic lives in the modules above.
  index.js       Server bootstrap, static serving in production, temp-file cleanup.

client/
  app.js         692 lines. All state, routing, data loading, and event handling.
                 Events are delegated via data-action / data-change attributes, so
                 there are no per-render listeners to leak.
  lib.js         API client, money/date formatting, and period maths.
  charts.js      Hand-rolled SVG monthly chart, bar lists, budget meters.
  views/*.js     Pure functions: state in, HTML string out. No side effects.
  styles.css     Design system. All colours are variables at the top.
```

## Decisions already settled — please don't relitigate

These were debated and closed. Reopening them means redoing arithmetic that currently
reconciles.

- **One tag per spend.** Not many-to-many. This is what makes a tag breakdown always sum
  to the total. Multiple tags would break budget arithmetic and was deliberately
  deferred.
- **Rules are keyword/regex, not an LLM.** Offline, predictable, editable.
- **A hand-set tag is never overwritten** by a later rule run (`tag_source` tracks this).
- **Refunds keep their tag and subtract from it.** Only *untagged* money in is income.
- **Excluded spends stay visible in the ledger**, struck through, and are out of every
  total, chart and budget. Hiding them was tried and reverted — it made exclusions
  impossible to find or undo.
- **Recurring is derived, never stored.** No per-spend "is subscription" flag to keep in
  sync.
- **No ledger export.** Explicitly not wanted for now.

### UI direction

The visual style went through many rounds. The settled palette is **light cool stone
`#f3f4f6` page, white cards, charcoal `#1c1f24` type, denim `#2f4a6e` accent, oxblood
`#9b2c2c` for alerts**, with 4px max radius, Outfit for UI and IBM Plex Mono for money.

Already tried and **rejected**: article/rustic editorial styling, teal + orange,
violet/blue/pink ("too girly"), yellow/sand, navy + electric blue, and midnight-purple
backgrounds. Dark themes were tried and the light one won. Don't re-propose these.

## Known rough edges

None of these are bugs you'll trip over immediately, but they're the honest limits:

1. **Merchant grouping is a heuristic.** It cuts at store numbers and strips card-network
   noise, so `WOOLWORTHS 1234 SURRY HILLS` and `WOOLWORTHS 8892` group correctly. But a
   three-word name keeps its suburb, so `MCDONALDS SURRY HILLS` and `MCDONALDS NEWTOWN`
   will *not* group. Prose descriptions also derive oddly (`Cash for the farmers market`
   → `CASH FOR THE FARMERS`). The merchant field is editable per spend as the escape
   hatch. Tuning lives in `deriveMerchant()` in `server/parse.js`.
2. **Recurring detection has false positives.** `ALDI NEWTOWN` is currently flagged as
   recurring because it happened to hit three roughly-monthly, roughly-equal charges.
   Thresholds are the constants at the top of `server/recurring.js`
   (`MIN_CHARGES`, gap window, `AMOUNT_TOLERANCE`). There's no way to dismiss a
   false positive from the UI yet — that'd be a good small feature.
3. **Net-negative tags vanish from the composition chart.** The `byTag` query uses
   `HAVING spend > 0`, so a month where a tag's refunds exceed its spending drops off the
   "Where it went" bars and shows $0 in its budget meter rather than a negative. Correct
   for a composition chart, but it does hide information.
4. **The `account` column is parsed and stored but never shown.** If you import multi-
   account statements there's no way to see or filter by account yet. Low-hanging fruit.
5. **The currency setting is inert.** `settings.currency` exists server-side and defaults
   to AUD, but the client hardcodes `en-AU` and `$` in `client/lib.js`. Either wire it up
   or drop it.
6. **No tests at all.** Everything was verified manually through the browser. Any
   refactor of the money arithmetic is unguarded — see the regression figures below.
7. **`dev:server` must keep `--watch-path=./server`.** Plain `--watch` walks
   `node_modules` and crashes the API with `EMFILE: too many open files`.
8. **Deleting a tag** untags its spends (keeps them) but *also* deletes its rules and its
   budget. That's intentional, just easy to forget.
9. **No auth, single user.** Fine locally; don't expose `npm start` to a network.

## Regression figures

If you touch the money arithmetic, these should still hold with the sample data loaded.
They're hand-checked, not generated from the code:

| Check | Expected |
| --- | --- |
| Shopping, all time | `$251.00` — two $41 Kmart charges minus the $29.50 refund |
| Income, all time | `$21,000` — 5 × salary only, no refunds leaking in |
| August spend, transfer excluded | `$3,738.11` (was `$4,238.11` before excluding) |
| September vs previous | `+3% vs $3,216 over 1–16 Aug` (part-month compares like-for-like) |
| Woolworths merchant | 12 spends folded into one across two store numbers |
| Telstra recurring | flagged `Price up +13%`, $72 → $81 |

The comparison figure is the subtle one. It steps back **whole calendar months** and trims
to the same elapsed days. An earlier version slid a 30-day window, which started August on
the 2nd, dropped that month's rent, and reported a nonsense `+80%`.

## Possible next steps

Nothing is required — v1 stands on its own. Ideas, roughly by value:

- **Use it with your real statements.** The most valuable next step by far, and the
  fastest way to find out whether the merchant heuristic and rules suit your bank.
- Dismiss/ignore a false-positive recurring merchant.
- Surface `account`: show it on spends and add a filter.
- A "merge merchants" action, so folding `MCDONALDS SURRY HILLS` into `MCDONALDS` doesn't
  need editing each spend (`POST /api/merchants/rename` already exists server-side and is
  unused by the UI).
- Tests around the SPEND/INCOME arithmetic and `deriveMerchant`.
- Wire up or remove the currency setting.

## Related notes

The original planning document is at
`~/.cursor/plans/spent_dashboard_a42ce0a4.plan.md` — it's **outside this repo**, so it
won't be committed and won't travel with the project. It covers the same ground as this
file in more detail on the feature specs. Worth copying in if you want it preserved.

`README.md` covers running the app and explains how the numbers work; this file covers
project state and history.
