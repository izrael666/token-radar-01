[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/izrael666/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/izrael666/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

[![Vibe coded with Muse](https://make.fun/api/badge?repo=izrael666/token-radar-01)](https://make.fun/bounty/token-radar-01)
[![View the Bounty on make.fun](https://make.fun/api/badge?repo=izrael666/token-radar-01&type=view-bounty)](https://make.fun/bounty/token-radar-01)
[![Fund this Bounty](https://make.fun/api/badge?repo=izrael666/token-radar-01&type=fund-bounty)](https://make.fun/bounty/token-radar-01)

# token-radar-01 — Build the best token launch radar

Every pre-token protocol, ranked by what its launch would be worth.
The board covers the snapshot's whole 40-protocol watchlist plus 158
early pre-token protocols below it — 198 rows in all — each with an
implied value from the snapshot's own figures and a seven-step farm
plan with what it costs and how long it takes.

## What the program does

`main.ts` (Node 22, standard library only) reads the sealed snapshot
at `/input/snapshot.json`, scores every rankable pre-token protocol
with the model in `lib/model.ts`, and writes to `/output`:

- `board.json` — the 198 ranked rows, each with its implied value,
  its three multipliers, and its 7-step farm plan.
- `data.js` — the same board for the dashboard page.
- `dashboard/` — the static page (search, category and chain filters,
  watchlist-only toggle, Pre-token / Live token tabs, sortable columns,
  a detail view per protocol with the model's inputs and the farm plan).
- `screenshots/` — the board, a detail view, and a filtered view.
- `dossier.json` — the summary the judge reads, built with the
  vendored make.fun library in `vendor/makefun-board.ts`.

## The model (radar-2)

```
implied = round( tvl_usd x 0.25
  x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
  x (0.6 + min(age_days, 1095) / 1095 x 0.4)
  x (1 + 0.04 x min(chains - 1, 4)) )
```

TVL and seven-day growth come from the snapshot. Age is the time
since the protocol was first listed — how long it has run with no
token on record; an unlisted age uses 365 days. Chains count its
distribution. No protocol name is special-cased, and no row is
hand-picked. Rank 1 is Steakhouse Financial, implied $630.6M.

A protocol is called pre-token because its record carries no token,
not because it has none. Live-token protocols are set aside on their
own tab with their market caps shown. Implied value is the model's
claim about a launch, never a price and never a promise that a token
comes.

## How to run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

Two runs into different output directories write byte-identical
files. The dashboard needs no network: serve `out/` and open
`dashboard/index.html`, or open the file directly.

## Verification

- All 7 gate rows pass locally (dashboard files, board file,
  sorted by value, watchlist coverage 40/40, farm steps, screenshots,
  dossier matches a rebuild byte for byte).
- The page recomputes every row's implied value and farm plan from
  the same figures: 198/198 agree with `board.json`.
- Kit check passes except `thinking_priced` (usage rows are attached
  by the top-level agent when the bundle is rebuilt for submission).
