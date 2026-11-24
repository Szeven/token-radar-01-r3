# Token Radar

[![Token Radar](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/Szeven/token-radar-01-r3/rank.svg)](https://make.fun/bounty/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/Szeven/token-radar-01-r3/reward.svg)](https://make.fun/bounty/token-radar-01)

Every pre-token protocol, ranked by what its token could be worth.

## The board

`main.ts` reads the sealed snapshot (`/input/snapshot.json`, 758 protocols as of
2026-11-14) and writes the ranked board to `/output/board.json`: **226 rows** —
the 40 protocols on the watchlist (TVL at or above the $50,000,000 floor) plus
186 early finds below the floor, every one of them pre-token. Protocols whose
token already trades are set aside as a live list of 24, never ranked.

## The model (radar-2)

```
implied = TVL × 0.25 × growth × maturity × breadth × category prior
```

- **Base:** TVL × 0.25 — a token's fully diluted value usually clears a quarter
  of the value locked in the protocol.
- **Growth:** the 7-day change, clamped to −60%…+120%. A rise counts more than
  a fall of the same size (×0.8 against ×0.4): growth is a signal a launch is
  coming, a fall is a weaker signal of the opposite.
- **Maturity:** 0.6 + min(age, 1095 days) / 1095 × 0.4. A protocol that has run
  three years with no token is likelier to issue one; an unlisted protocol is
  treated as a year old.
- **Breadth:** 1 + 0.04 × extra chains, up to 5. A protocol live on more chains
  reaches more farmers and more liquidity.
- **Category prior:** 0.85 + 0.30 × the share of the category that already has a
  token, learned from this snapshot (global rate 54.9%; categories under 10
  protocols use the global rate). Categories where tokens are the norm score
  above categories where they are rare.

No name is ever special-cased; the same function scores every row. The
dashboard recomputes each row's value from the snapshot's figures, so the page
and the board agree.

## The farm plans

Every row carries seven steps, each with what it costs and how long it takes,
derived from the protocol's category, chains, TVL and age: a fresh wallet, the
category's main position, a second qualifying action, a weekly cadence, a hold
period, what to watch for, and how to claim safely.

## The dashboard

`dashboard/` is a static page with no network: the ranked board, a detail view
for every protocol (the full value breakdown and its farm plan), and filters —
search, category, watchlist-only and early-finds-only, plus a live-token view.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

Node 22, standard library only. The program refuses a board the gate would
refuse, and writes `board.json`, `data.js`, the dashboard, the screenshots and
`dossier.json` to the output directory.

---

Built for the [token-radar-01 bounty on make.fun](https://make.fun/bounty/token-radar-01).
