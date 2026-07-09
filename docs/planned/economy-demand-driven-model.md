# Demand-Driven Economy — Pop · Industry · Logistics (Core Model Rework)

> **Status:** Design (validated by brainstorm 2026-07-09). Reworks the core economic model so faction
> industry is placed by **demand rate**, the inherited browser-trading apparatus is stripped, and a small
> capped stock buffer survives only as a passive shock-absorber. Supersedes the "seed by looping the live
> planner against a 40-day stock target" approach of
> `docs/build-plans/building-construction-pr3-seeder-funding-fix.md`. Refines the relevant parts of
> `docs/planned/economy-simulation-vision.md` (§6 pricing, §12 automation). No code yet — this design
> spawns the implementation plans (see Decomposition).

## Headline

The economy runs on **three pillars — population, industry, logistics** — in the spirit of Victoria 3,
EU5 (Project Caesar), and Stellaris. Industry is placed to satisfy **demand**, expressed as a **rate**
(a per-tick flow), never to fill an inventory target. **Demand is an extensible sum of sources**
(civilian consumption + industrial input draw today; export, military, and building maintenance later),
so new demand plugs in without rewriting the planner. Goods accumulate in a **small, capped stock buffer**
that fills passively from surplus flow and cushions production shocks — the reserve *emerges* from lumpy
capacity, it is never a build goal. **Price** becomes a derived, damped supply/demand signal (kept for
satisfaction now, inter-faction trade and taxation later); the **bid-ask spread / slippage / buy-sell
quoting machinery** that defended a multiplayer market from human arbitrageurs is **deleted**. The
build planner keeps a clean seam between **decision** (what/how much, demand-driven), **gate-validation**
(does it staff/fit), and **pacing** (how fast/funded) so a player command path and a money/treasury layer
slot in later without a rewrite.

## Scope — and what "for now" means

**In scope:** the core economic model that makes a faction's pop/industry/logistics loop work — demand,
placement, production, the stock buffer, price derivation, and start-state viability (homeworld prefab).

**Explicitly deferred** (the core model must be *completely sorted first*): war mechanics, new event
types, inter-faction trade, treasury/taxation, and any maintenance/logistics money-costs. This design
does **not** build those — but it commits to the **seams** that let each plug in later without reopening
the foundation (see Deferred, with seams). This is the whole point of the rework: stop bolting mechanics
onto a model that isn't settled.

## Motivation — why now

Three symptoms (broken seeder floor → colony-funding starvation → seed over-extraction) turned out to be
one disease: **a seam bug between the market model and the planner.** The build planner sizes industry off
a *stock* shortfall, `targetStock − stock`, where `targetStock = TARGET_COVER(40 days) × demand`. Live,
this is invisible (real stock sits near target, shortfall ≈ 0). At seed, stock is synthesized at 0, so the
shortfall is maximal and the seed loop re-feeds it up to 12×, driving every extractor to its full deposit
cap regardless of the population's actual per-tick need — the exact opposite of the intended demand-pull.
Underneath sit **inherited hangovers** from the old browser space-trading game (spread, slippage, resale
quotes) that no longer serve a single-player faction ruler. The fix is not another local patch; it is to
settle the model so demand drives placement and the vestigial layer is gone.

## The model

### 1. Demand is an extensible sum of sources, expressed as a rate

A good's demand in a system is a **per-tick rate** = the sum of independent demand sources:

- **Civilian consumption** — per-capita baseline + skill-tiered baskets (technicians, engineers), from the
  existing development-tiered demand (S3). Bounded by a small floor.
- **Industrial input draw** — the recipe inputs the system's own tier-1+ production pulls each tick.
- **(Deferred, plugs in here later)** — export demand from reachable trade partners, military/ship-build
  demand, building-maintenance goods draw. Each is *another addend*, nothing more.

Modelling demand as `Σ sources` (rather than a civilian figure the planner special-cases) is the single
architectural commitment that lets trade, war, and maintenance fold in later without touching the planner.
A good with no consumer at all is correctly never built.

### 2. Placement is driven by the demand rate, not a stock target

The build planner sizes built capacity to close a **rate deficit** — where a good's `production < demand
rate` (civilian + input today; export/military/maintenance fold in as §1 addends later). It builds enough
capacity to *meet the flow*, then production
runs at that capacity; it never sizes builds to fill a days-of-supply inventory target. Physical gates are
unchanged and remain the real ceilings: deposit-slot cap, general space, and **labour** (a build may only
add what the resident population can staff). This is how the genre works — capacity is built to meet
demand, and production is a flow that runs at built capacity — and it directly fixes the seed
over-extraction: with demand as the target, extraction grows tier-by-tier as input demand appears, exactly
as the demand-pull was always meant to.

### 3. Stock is a small, capped, passive buffer — the reserve emerges

Stock stays a **genuine running balance** per (system, good): it rises when production exceeds consumption
in a tick and drains when it doesn't, **capped by an infrastructure-derived storage ceiling** (the
existing band `maxStock`). Its jobs are (a) **shock absorption** — reserves accumulated in good ticks
cushion an event that drops production, so a single bad tick is not an instant famine — and (b) the
**surplus/deficit signal** directed logistics reads to move goods between systems.

Crucially, the reserve is a **side-effect, never a target.** Because capacity is lumpy (whole levels) it
slightly overshoots the demand rate; the excess flow fills the buffer up to the storage cap, and
production **self-throttles** as stock nears the ceiling (the existing self-limiting factor). This is the
user's "build a surplus only *after* demand is met" — realised passively, with no 40-day build goal. The
reference games confirm the shape: none plan toward a days-of-supply reserve; surplus is always a
side-effect of capacity/price mismatch, and a *small capped* buffer is the minimum viable shock-absorber
for a spatial, event-perturbed economy (EU5/Stellaris), where Victoria 3's zero-buffer purity would make
every shock instant.

**Net change here is narrow:** the buffer machinery (running-balance stock, infra-derived storage ceiling,
self-throttling near the cap) mostly already exists. What changes is that **`TARGET_COVER` stops driving
builds** — it is decoupled from placement and kept only for pricing, satisfaction, and logistics
classification. (The vision's intent to re-derive cover *emergently* rather than as a magic constant is
compatible and tracked as a calibration follow-up, not a blocker.)

### 4. Price is a derived, damped signal — the trader machinery is deleted

Price is computed from the supply/demand balance as a **damped** signal (trending toward its target rather
than snapping, EU5-style), clamped to the band. It is a **readout**, not a trading engine. Its roles:

- **Now:** a cost/satisfaction signal — the same stock number that drives pop satisfaction and logistics.
- **Later:** the value signal for inter-faction trade (is a haul worth it) and the **base for taxation**
  (a faction taxes the value of goods produced/consumed).

**Deleted** (inherited multiplayer-defence apparatus, already marked for removal in
`grand-strategy-vision.md` §4, and confirmed to have no live caller): the **bid-ask spread**, **slippage**
(`quoteTrade` / `tradeAvgMidPrice`), the **buy/sell price quote columns**, and the anti-resell design. No
buy/sell endpoint exists; these only widened display columns and defended a market from a human trader who
no longer exists. Keeping price *derivable* (three future jobs above) while deleting the *trading* machine
is the whole of thread 3.

### 5. Planner architecture — decision / gate / pacing seam

The automation that places industry must be a **sound shared primitive** for both the faction AI and (in
the player-seat phase) the player. Today `planFactionBuilds` **fuses** three concerns; this design keeps
them as clean, independently-testable units:

- **Decision** — "what/how much to build," driven by the demand-rate deficit (§2). A pure function of a
  synthesized/real market state → proposed builds.
- **Gate-validation** — "is it staffable / space-fitting / whole-level valid." Physical feasibility.
- **Pacing** — "how fast / funded." Already clean today (`fundQueue` is a decision-free pacing function;
  the FIFO→need-order swap is a drop-in reorder here).

We do **not** wire a player command path or a money constraint now (YAGNI — that's the player-seat phase).
We only ensure the seams exist, so player intent later becomes *"add a proposer that emits into the same
decision→gate→pace pipeline,"* not a planner rewrite. Corollary: **do not gold-plate the placeholder
funding.** The current throughput pool is a *construction-capacity* stand-in; when treasury/taxation lands
it adds a *money* gate on top at the pacing seam. So the original PR3 "Part C funding fix" is
substantially subsumed by the future treasury and should stay minimal.

### 6. Homeworld prefab — start-state viability (independent)

Faction homeworlds are chosen for good substrate but with **no parity guarantee** — the spacing constraint
relaxes and forces weak systems to become homeworlds, and there simply aren't enough high-pop, rich worlds
to go around. Rather than complicate the seeder with self-consistency bias, **overwrite the chosen
homeworld systems with a good, roughly-equal prefab** (a fixed body list carrying slots + quality so the
Astrography view stays consistent, plus small per-faction jitter), then seed industry on that prefab. This
makes every faction's start viable **by construction** and removes a whole class of "unlucky homeworld"
failures.

This is **independent** of the demand-rate rework (a prefab run through an over-extracting planner still
over-extracts — it is complementary, not a substitute) and **isolated**: it slots into the existing
homeworld-mutation loop in `universe-gen.ts` *after* selection, touches only the chosen homeworld systems,
and changes no other engine module. **Guardrail:** we prefab the *homeworld* only. The colonisable galaxy
stays negative/random space — making the *base* efficient is the point; making the *galaxy* efficient
would delete the negative space that faction agency exists to fill.

## Data flow (per economically-active system, each tick)

```
demand rate  = Σ sources (civilian + input [+ future: export/military/maintenance])
production   = built capacity × labourFulfilment × inputGate × yield   (a flow, runs at capacity)
stock       += (production − consumption) each tick, clamped to [0, storageCap]   (passive buffer)
price        = damped f(supply/demand), clamped to band                (derived readout)
satisfaction = delivered/demanded → unrest, growth/decline (population pillar)
logistics    = move surplus(stock>need) → deficit(stock<need) across reachable routes (logistics pillar)
placement    = build capacity to close a RATE deficit (production < demand rate), physically gated (industry pillar)
```

The three pillars close the loop: **population** sets demand and staffs industry; **industry** placement
tracks demand and is gated by labour; **logistics** moves surplus flow to deficit and (later) carries
export demand across borders. Price and stock are shared substrate, not independent mechanics.

## Deferred — with the seams that carry them

None of these are built here; each names the seam that lets it plug in without reopening the model.

- **Inter-faction trade → foreign demand drives our logistics *and* our production** *(capture — the key
  future interaction).* When diplomacy opens a **relation-gated** cross-faction route, a friendly
  neighbour's deficit becomes a **reachable build opportunity**: their demand enters our demand aggregate
  (§1) as an *export* source, so our planner builds capacity to serve it **exactly like internal demand**,
  and the goods flow out over **extended directed logistics** (the same surplus→deficit mover, borders
  opened). Price (§4) is the "is this haul worth it" signal, and payment runs through the future treasury.
  This is why demand is an *extensible sum* and why placement scores *reachable* opportunities today
  (Task 1's self-serving route cost is the same machinery) — foreign trade is "open the border + add an
  export demand source," not a parallel economy. The buffer is **not** what enables trade; the demand
  signal crossing the border is.
- **Treasury / taxation** — attaches at the **pacing seam** (§5): faction funds come from taxing the
  *value* of goods produced/consumed (needs price, §4); build/logistics gain a money gate on top of the
  capacity budget. Does not touch the placement *decision*.
- **Building & logistics maintenance costs** — maintenance-as-goods plugs into the **demand aggregate**
  (§1) as another source; maintenance-as-money is a treasury concern. Interacts with the build/decay
  equilibrium (a building that can't cover upkeep becomes a net drain) but not with demand-rate placement.
- **War / events** — out of scope until the core model is settled; war reads the aggregate industrial base
  as a capacity ceiling, which needs the demand aggregate's military source wired (a §1 addend later).

## Decomposition (this design → build plans)

Four sub-projects, each its own implementation plan when we reach it:

- **A — Strip the trader apparatus.** Delete spread/slippage/`quoteTrade`/`tradeAvgMidPrice`/buy-sell
  columns; collapse price display to the derived spot signal. Small, already blessed, low-risk.
- **B — Rate-based placement (the core fix).** Planner sizes to the demand-rate deficit; demand modelled
  as an extensible sum; `TARGET_COVER` decoupled from builds (kept for price/satisfaction/logistics).
  Fixes seed over-extraction and makes the demand-pull work. **This is the minimal path to a working base.**
- **C — Planner decision/gate/pacing seam.** Refactor `planFactionBuilds` into clean decision / gate /
  pace units (seam-aware, not player-wired). Best done *with* B since B rewrites the sizing logic anyway.
- **D — Homeworld prefab.** Isolated start-viability win; independent, can land any time.

**Minimal working base = B (+ D for a viable start).** A is a clean-up that can lead or follow; C is the
architecture pass that rides with B. Order likely: **A → B+C → D**, re-measuring economy health after B.

**Relationship to the paused PR3 branch (`feat/building-pr3-discrete-levels`):** Task 1 (self-serving
route cost, commit `3a41412`) is correct and survives — it is the reachable-opportunity machinery §1/trade
build on. Task 2 (the loop-the-planner seeder, commit `22bb17f`) is **superseded** — the seeder becomes
rate-driven (B) and runs on the prefab (D). Task 3 (funding re-measure) is **deferred/subsumed** by the
future treasury (§5). Whether to keep, amend, or revert the Task 2 commit is an implementation-plan
decision for B.

## Testing strategy

- **Demand-rate sizing:** a system with a known demand rate and ample deposits builds capacity ≈ the rate
  (+ input demand), **not** a 40-day multiple — the over-extraction regression, asserted directly.
- **Seed coherence:** a prefab homeworld seeds a coherent multi-tier chain (tier-0 → tier-1 + academy →
  tier-2), and the chain **survives** (produce-check), across the faction set.
- **Buffer emerges, not targeted:** at equilibrium, stock sits in-band from passive overshoot; no build is
  attributable to a stock target.
- **Shock resilience:** an event that drops production draws down the buffer rather than instantly starving
  pops; logistics re-routes.
- **Determinism + serializability:** seeding deterministic; no `NaN`/`Infinity` in world state.
- **Gates:** vitest, `tsc`, `npx next build --webpack`, `npm run simulate` (economy health — no
  runaway/pinning; population does not collapse; homeworlds make manufactured goods).

## Calibration note

Coarse health only until all pillars' mechanisms ship (no `NaN`/runaway/pinning; greedy ≫ random;
dispersion; liquid) — precise tuning is perishable and deferred to the single post-model calibration pass.
Magnitude assertions stay ranges. The emergent re-derivation of cover (vs the magic constant) is part of
that pass, not a blocker for B.
