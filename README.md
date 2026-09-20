# spenT

A local spending dashboard: import bank statements, tag them automatically, watch the
trends, and hold them against budgets. Everything stays on your machine.

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The API runs alongside on port 3456.

There is a **Load sample data** button on the empty state if you want to look around
before importing anything real.

Production build:

```bash
npm run build
npm start
```

## Where your data lives

Deliberately **outside this repo**, so your transactions can never be committed or pushed:

| Platform | Location |
| --- | --- |
| macOS | `~/Library/Application Support/spenT` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/spent` |
| Windows | `%APPDATA%\spenT` |

That directory holds `spent.db` plus the statement files you import. The server prints the
path on startup. Set `SPENT_DATA_DIR` to override it — useful for a second profile, a
mounted volume, or a throwaway database while developing:

```bash
SPENT_DATA_DIR=/tmp/spent-scratch npm run dev
```

Only `data/sample.csv` lives in the repo, and it is synthetic. Two consequences worth
knowing: your data is **not** backed up by cloning or pushing this repo, and if you want a
copy elsewhere, back up that directory rather than committing it.

> Do not sync the database through Dropbox or iCloud. SQLite in WAL mode keeps state
> across `spent.db`, `spent.db-wal` and `spent.db-shm`; a file syncer copies them
> independently and can pair mismatched halves, which corrupts the database. Back up an
> export, or run the app on one always-on machine and reach it over a private network.

## How the numbers work

A few deliberate choices, because they change what the totals mean:

- **One tag per spend.** Categories never double-count, so a tag breakdown always adds
  up to the total.
- **Refunds reduce their tag.** A positive amount that still carries a tag subtracts
  from that tag rather than showing up as income. Only untagged money in counts as
  income.
- **Excluded spends leave the totals but stay in the ledger**, struck through. This is
  for transfers between your own accounts and one-offs you don't want skewing a trend.
- **Merchants are grouped.** `WOOLWORTHS 1234 SURRY HILLS` and `WOOLWORTHS 8892` become
  one merchant, so the ledger can group by who you actually paid. The merchant is
  editable per spend when the guess is wrong.
- **Recurring is derived, not stored.** A merchant counts as recurring once it has three
  or more charges roughly a month apart for roughly the same amount. That drives the
  fixed-vs-variable split and the price-change flags.
- **Tags you set by hand are never overwritten** by a later rule run.

## Layout

```
server/   Express API, SQLite schema, statement parsing, tagging rules, recurring detection
client/   Vite single-page app, vanilla JS, no framework
data/     Only sample.csv, the synthetic demo fixture
```
