# Economy Scaling & Trade-Logistics Rework

> **Status:** Designed, not built. Sits inside **SP5 autonomic-light** (the directed-logistics track),
> *before* SP4 and long before full-SP5 agency. Decomposed into ordered sub-projects, each its own
> spec → plan → build. See the roadmap slot in [economy-simulation-vision.md](./economy-simulation-vision.md) §13.
>
> **Supersedes** the Phase-2 "Contract layer" approach (built on branch `feat/sp5-logistics-contracts`,
> then **ditched** — see [Phase 2 disposition](#phase-2-disposition--lessons-learned)).

## Headline

The player-facing trade-logistics layer needs a rework, and it's blocked on a deeper **unit/scale
coherence** problem. The economy runs on small floats (per-cycle production/consumption is often
sub-unit); players trade in whole units. The two were never scaled to each other, so demand-driven
player opportunities come out either too sparse, too small, or both. The fix is three independent
dials — **scale the goods economy up, size a "mission" at roughly one ship-load, tune the share
offered to players** — plus a rethink of what a player trade-opportunity even *is* (discrete mission
vs. bounty vs. just better-surfaced marketplace arbitrage), which is also forced by a multiplayer
contention problem the discrete-mission model can't solve.

## The problem

- **The economy is internally float-coherent; whole units only appear at the player boundary.**
  Production, consumption, market stock (`Float`/`double precision`), and price are continuous floats.
  Whole units appear only where a player buys/sells or where a deficit becomes a mission/contract `Int`.
  This is a *boundary* mismatch at a handful of seams (buy/sell capacity `Math.floor(stock − band)`,
  and `Math.floor(shortfall × catchUp)` → mission quantity), not an engine-wide rounding mess.
- **Magnitudes are small and hard to reason about.** Per-capita consumption is tiny (≈0.007/run for a
  staple); at modest populations a system moves a few units per cycle, and per-tick rates read as
  "0.1/cyc". Players can't form a clear trade mental model around fractions.
- **Density is supply-capped.** At 10k scale, the directed-logistics matcher finds ≈8,300 surplus→deficit
  transfers per interval ≈ **~1 transfer per system, maximum**. So no per-faction skim count (the old
  `K`) can ever reach ~2 contracts/system — the *supply of distinct transfers* is the ceiling. Density
  has to come from **bigger deficits chunked into more pieces**, not from a bigger skim.

## North star

> *A civilisation always has goods to move, and there are always people to move them. We scale the
> transportation to the goods, not the other way around. Players move a small slice of a much bigger
> flow. (1 unit of population ≈ 1M people.)*

This reframes everything: a populated world exports large tonnage; a single trader hauls one ship-load —
a sliver of it; the faction's own logistics moves the rest. Density and mission size both fall out of
*real demand magnitude*, once the economy is scaled to make that magnitude legible.

## Key findings (grounding the design)

1. **Linear scaling is safe for price equilibrium.** Price = `base × (targetStock/stock)^k`, and
   `targetStock = TARGET_COVER × demandRate`. Scale production **and** consumption by the same factor S
   and both `stock` and `targetStock` scale by S — the *ratio* is unchanged, so prices and equilibrium
   are untouched. You just get bigger numbers, and float→int rounding loss shrinks (`floor(476.2)` loses
   0.04% vs `floor(4.7)` losing 6%). The catch: a handful of **absolute** terms that don't ride the ratio
   and must be scaled explicitly — `storageCapacity` (additive in `maxStock`), route/fuel costs, the
   mission reward formula, the affordable-budget cap, and seed-time stock rounding. That audit *is* the
   work of sub-project 1.
2. **"Integers everywhere" is the wrong goal.** The economy's dynamic range is enormous (a sub-1-pop
   outpost needs ~0.0003 of a rare good per run; a populated world needs hundreds of a staple). No single
   multiplier makes both ends integer-friendly. Keep the **float engine**; keep the **integer/rounded
   player surface**; scale up enough that fractions are *noise* at the systems players actually trade at.
3. **There is no global magnitude multiplier today.** `UNIVERSE_SCALE` controls system/region count, not
   per-system magnitudes. Introducing one modifiable `ECONOMY_SCALE` is the foundational change.

## The three-dial model

| Dial | Meaning | Notes |
|---|---|---|
| **Scale (S)** | Global multiplier on production + consumption (and the audited absolute terms). | Makes a real export *large* (hundreds–thousands). Calibrated via the simulator, which runs the real prod/con + silent flows. |
| **Chunk (C)** | The size of one player "mission" ≈ one ship-load. | A constant, **decoupled from today's ships** — ships get re-priced/re-capacitied *to* the economy later (see sub-project 4). |
| **Offered fraction (F)** | Share of each export exposed to players vs. moved silently by the faction. | The only dial with an economy-health consequence (see [the deferral](#the-deferral-and-transit-time-equalisation)). Calibrated live. |

**Density = F × deficit / C** — demand-driven. Big exporters spawn many opportunities; barren rocks spawn
none. This **retires the arbitrary `K`** entirely.

## Rival vs non-rival missions

A clean distinction that isolates the multiplayer problem:

- **Rival** (trade / logistics): the deficit is a *finite shared resource* — one player filling it depletes
  it. Contention is real; a shared claimable board lets one player hoard or block others. Needs shared
  state **and** a contention-proof model (below).
- **Non-rival** (survey, and many event/battle missions): every player can complete one *independently*
  without depleting anything. These don't need a shared board at all — **generate them locally/per-player
  and only write a DB row when a player accepts.** No contention, no hoarding. (Tracked in the backlog;
  applies to events/battles/surveys, not trade.)

The contention problem is therefore *only* the rival/trade case.

## The pivotal fork: what is a player trade-opportunity?

The discrete-claimable-mission model is being replaced. The replacement is an open question for its own
brainstorm (after the scale work), with three candidates:

1. **Discrete missions + anti-hoarding** — keep claimable missions, bolt on per-player accept caps and a
   penalty for accepting-and-not-delivering. Least change, still fundamentally a claim model.
2. **Open standing demand (bounty)** — no claimable rows. Expose the deficit as "System X wants N units of
   good G, pays R/unit"; *any* player delivers *any* amount toward it, paid per unit, until it's filled or
   the faction backstops it. No claim → no contention, and **no chunk-size decision** (players self-chunk by
   cargo).
3. **Better-surfaced marketplace arbitrage** — the key realisation: the market price curve **already** pays
   the surplus→deficit haul (a deficit system has low stock → high price; a surplus has high stock → low
   price), so a player doing arbitrage is *already* doing a logistics contract, paid by the spread. A
   "bounty" is largely a marketplace variant. This option does little new generation and instead *surfaces*
   the best arbitrage routes to players. Missions, in this light, are training wheels / discoverability.

The bounty and marketplace options converge; the real decision is **how much bespoke "mission" structure we
add on top of the arbitrage the market already incentivises.** Resolve in the contract-model sub-project.

## The deferral, and transit-time equalisation

When a transfer is *silent*, the deficit fills on the logistics run that creates it. When it's a *contract*,
it fills only when a player delivers **or** the faction self-hauls at the deadline — up to one logistics
interval (~48 ticks) later. So a high F shifts redistribution from *instant* to *player-or-timeout*, which
the current simulator can't see (it runs F=0). The faction backstop guarantees the deficit still heals
within that window, so a *moderate* F is safe; pushing F high is the part that needs validation.

**The clean fix (deferred enabler):** give **silent moves a transit time too** — the faction decides, then
the goods take time to arrive. Then silent fills and contract-timeout fills land on the *same clock*, the
deferral penalty disappears, and **F becomes a pure gameplay dial with no economic cost.** The game already
models in-transit ships with arrival ticks (`getArrivingShips`), so "goods in transit" can reuse that arrival
mechanism. Its own sub-project; do it when we want to push F high.

## Phase 2 disposition — lessons learned

Phase 2 ("Contract layer") was fully built and per-task reviewed on `feat/sp5-logistics-contracts`
(8 commits): a `TradeMission.origin` discriminator, a top-K split (`splitContractTransfers`), Contract
create/expire/close I/O, a processor body doing timeout-resolve + top-K contract creation, retirement of
the old price-ratio mission generator, and integration coverage. It works mechanically and the simulator
stayed byte-equivalent under `contractCount: 0`.

**It is ditched, not merged.** Discrete claimable trade missions are the wrong primitive for a multiplayer
game (rival resource + hoarding/contention), and the bounty/marketplace rework replaces them wholesale —
merging then ripping out is pure churn with a misleading main history. The branch is **preserved unmerged**
as a reference.

**What carries forward:**
- The **timeout-resolve / faction-backstop** concept — a faction self-hauling whatever players don't take —
  survives directly into the bounty model (it *is* the backstop in [the deferral](#the-deferral-and-transit-time-equalisation)).
- **Resolve-before-match ordering** and the **byte-equivalence sim-calibration discipline** (prove the sim
  curve is unchanged when a feature is off) are reusable techniques.
- The **supply-ceiling** and **instant-vs-deferred** findings (above) came directly out of Phase 2's live
  smoke — they're the reason this whole initiative exists.
- The old price-ratio generator (`selectEconomyCandidates`) **stays live on main** until the contract-model
  rework replaces it (Phase 2's retirement of it is not merged). The rework should retire it.

## Decomposition & order

Each is its own spec → plan → build.

**First — the UI / visualisation pieces** (model-agnostic, do not need contracts, build *before* the
scaling work):

- **P3 — map overlay by `flowType`** — visualise silent market vs logistics flows on the map.
- **P4 — logistics tab = imports/exports dashboard** — per-system flow view; *not* a contract board.

**Then — the scaling + contract rework** (each its own spec → plan → build):

1. **Global economy-scale knob** — one modifiable `ECONOMY_SCALE` that uniformly scales production,
   consumption, and the audited absolute terms; ratio-invariant terms (target-cover, price) deliberately
   *don't* scale. Foundational, independently mergeable, equilibrium-preserving. **Do first of the scaling work.**
2. **Calibrate the scale via the simulator** — bump the knob, run sims, find the factor that lands typical
   imports/exports in the hundreds–thousands. A measurement pass, not a build.
3. **Contract-model rework** — resolve [the pivotal fork](#the-pivotal-fork-what-is-a-player-trade-opportunity)
   (discrete vs bounty vs marketplace), then build it (its own player-facing surface — *not* P4). Needs
   (1)'s magnitudes. Own brainstorm.
4. **Ship re-pricing / capacity** — re-tune ship cargo and price *to* the scaled economy (inverting today's
   accidental dependency). Later.

Deferred enabler: **transit-time equalisation** (slot in when we want to push F high).

## Relationship to the roadmap

This expands the SP5 autonomic-light directed-logistics track from "Contract layer → map → tab" into
"~~Contract layer~~ → **map overlay → imports/exports tab** → scale → calibrate → contract-model → ships"
(the UI/visualisation comes first; the scaling rework follows). It sits before SP4 (population ← viability)
and well before full-SP5 agency (treasury, build planner, military ceiling). See [economy-simulation-vision.md](./economy-simulation-vision.md) §13 for the full sequence.
