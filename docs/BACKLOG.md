# Backlog

Actionable work items. When something ships, delete it — git history is the audit trail. For detailed designs, see linked docs in `docs/active/` and `docs/planned/`.

> **Purged 2026-07-06 for the grand-strategy pivot** ([grand-strategy-vision.md](./planned/grand-strategy-vision.md)): items serving the retired personal-player layer (mini-games, smuggling/bribes, hazard chains, reputation decoupling, trade-mission/ship-re-pricing rework, NPC trader agents) and the retiring Postgres runtime (batch writes, events query optimization) are deleted — git history has them. The pivot itself is tracked by phase in the vision doc §8, not here.

Sizes: **S** (hours), **M** (1-2 sessions), **L** (multi-session), **XL** (multi-week).

## Ready

Well-defined, can start now.

- **[M] Type `goodId` as a `GoodId` union instead of `string`** — `GOODS` is declared
  `Record<string, GoodDefinition>` (`lib/constants/goods.ts`) and every `goodId` is a bare `string`, so
  `GOODS[goodId]` type-checks as `GoodDefinition` and never narrows to `undefined` — a typo'd or stale id
  is a runtime `undefined` deref with no compile-time signal. Not currently a live bug: world-gen seeds
  every `goodId` from `Object.keys(GOODS)`, so the key always exists. It became worth doing when the
  market World↔Tick round-trip was deleted: the tick used to resolve the catalog in exactly one place
  (`toTickMarkets`), and now reads `GOODS[goodId]` at ~10 point-of-use sites, so the untyped key is
  load-bearing in more places. Violates the "Typed keys" checklist item and "fix the types at the
  source rather than casting at the consumer".
  **Sized as its own PR, not a fold-in**: 89 `goodId: string` declaration sites across 96 files. The
  shape is `export const GOODS = {...} satisfies Record<string, GoodDefinition>` +
  `type GoodId = keyof typeof GOODS`, then propagate through `WorldMarket.goodId`,
  `MarketRowForLogistics`, and every consumer. The real work is the **save-file boundary**: `deserialize`
  takes untrusted JSON, so a save written before the union (or hand-edited) needs a guard in
  `lib/types/guards.ts` narrowing `string` → `GoodId` with a decided failure mode (reject the save vs
  drop the row). Don't start it without settling that.
- **[S] The default quick-run is too short to exercise logistics** — `npm run simulate` runs 500 ticks,
  and directed-logistics does not move a single unit before tick 456. Measured at 600 systems / seed 42:
  the 500-tick default reports **30 transfers over 2 pulses across 19 systems and 6 of 26 goods**, while
  the same world at 1500 ticks reports **14,200 transfers over 44 pulses across 473 systems and 25 of 26
  goods**. The cause is colonisation pacing, not a logistics fault: the galaxy is still expanding at tick
  500 (~70 of 600 systems developed), and a faction needs two developed systems within `MAX_HOPS` before
  anything can move. Once it starts it never misses — 62 pulses fit in 1500 ticks, logistics fires on
  every one from pulse 19, and 62 − 19 + 1 = the 44 measured exactly. So the default run calibrates a
  pre-logistics galaxy: one of the three pillars is essentially outside its window. Decide between
  raising the default tick count (a ~3× slower "quick" check) and documenting the warm-up so the
  Logistics Activity block is read as "too early" rather than "broken". Logistics-activity numbers
  in a 500-tick report are not evidence of health either way.
- **[S] Alarm the ECONOMY_SCALE invariance bridge** — `vitest.config.ts` pins `ECONOMY_SCALE: "1"`, so
  the whole suite tests a scale nobody plays at (the code default, and the game's scale, is 100). That
  is defensible **only because** `lib/engine/__tests__/economy-scale-invariance.test.ts` and
  `lib/world/__tests__/economy-scale-dynamic-invariance.test.ts` prove the economy is S-invariant —
  those two tests are the load-bearing bridge that makes S=1 testing valid for an S=100 game. When
  invariance broke (the directed-logistics `Math.floor` that quantized the matcher's continuous
  transfers away), the bridge collapsed and every magnitude assertion in the suite silently became
  meaningless, with nothing detecting it. Make the dependency explicit and alarmed, so the next
  invariance break fails loudly at the bridge instead of quietly everywhere else.
- **[S] Two different quantities are both called `demandRate`** — `WorldMarket.demandRate` (stored) is
  civilian consumption **plus** industrial input draw: the days-of-supply pricing denominator and the
  logistics deficit anchor. `demandRateForGood` (`lib/constants/market-economy.ts:59`) is civilian
  **only** — it feeds `demandFootprint`, which is what the Population panel's demand chart renders. Both
  are correct for their context (the SPEC deliberately sums both channels for pricing so a refinery
  world's Ore "prices honestly rather than cheap-when-scarce"; a population panel should show what the
  population demands). The hazard is purely comprehension: a reader hits `demandRate` and assumes it is
  the pricing denominator when it is not. Rename `demandRateForGood` → `civilianDemandRateForGood` (and
  the `demandRate` key on demand-footprint entries follows), and give `WorldMarket.demandRate` a doc
  comment naming it as civilian + industrial and as the pricing/logistics anchor. The doc comment is the
  load-bearing half; rename the stored field only if it reads clearly at its call sites. **No calculation
  changes** — existing tests must pass untouched apart from the rename.
- **[S] Stale "48-tick agency clock" claims in the docs** — `docs/SPEC.md:158` and
  `docs/active/gameplay/economy-autonomic-agency.md:211`/`:265` describe a 48-tick agency clock and
  per-faction staggering. Neither is true: `MONTH_LENGTH = 24` and `pulseShard` resolves every faction on
  the same boundary tick. Comment/prose only, zero risk.
- **[S] `popCap`'s only rise path has no test** — `popCap` is stored and rises **only** at
  `lib/world/tick.ts:348` (`Math.max(s.popCap, housingPopCap(buildings))`, inside `applyBuildingIncreases`,
  gated on housing being among the landed types). Infrastructure decay is downward-only and will not
  repair it, so any refactor that lands housing by another path welds a colony's cap to its seed level
  **permanently** — it builds housing and never grows into it, silently, with nothing else failing. That
  is a lot of load on one unasserted line. Add an explicit test: popCap rises when a housing project
  completes.
- **[S] Purge the Postgres fossils outside `lib/tick/`** — Prisma was deleted in the Phase-2 pivot, but comments across `lib/types/game.ts:1`, `lib/types/guards.ts:2-4` ("Runtime type guards for Prisma boundary values" — the boundaries are now save-file `deserialize` + API `JSON.parse`), `lib/utils/format.ts:67`, `lib/utils/__tests__/format.test.ts:44`, `lib/world/types.ts:3`, `lib/world/gen.ts:3,49` (points at `prisma/seed.ts`, deleted), `lib/engine/relations.ts:3`, and `lib/engine/system-trade-flow.ts:4,7` still describe it as live. Mostly "no Prisma dependency" negative-space claims that are now vacuous, plus two that point a reader at deleted files. The tick's own two-backend claims were swept with the harness rename; this is the same rot in the layers that PR's scope didn't reach. Comment-only, zero risk. Find them with: `grep -rni "prisma" --include="*.ts" lib/`.
- **[S] Responsive navigation** — `GameNav` has no mobile breakpoints. Add hamburger menu or collapse below ~640px.
- **[S] Curated universe names** — Current procedural names are generic ("Forge-7"). Add curated name pools or hybrid naming for more flavour.
- **[S] Improve UI for dev cheat panel** — Other floating elements including the sidebar on the map get in the way of the dev cheat panel button. Move it to the header.
- **[S] Improve UI** — Standardize main content panel size, system detail smaller than command center.
- **[M] System-finder dev tool** — A queryable dev panel (or `scripts/` CLI) to surface representative systems by characteristic for manual smoke-testing / QA: population band (dead/undeveloped/tiny-outpost/healthy), economy-type, deposit profile, building roster, NaN/anomaly checks — returning name + direct `/system/<id>` link. Recurring need whenever generation/economy changes land (e.g. verifying barren-but-alive systems read correctly). Build it against the in-memory world (`getWorld()`), surfaced in a `scripts/` CLI or the dev-tools panel.

## Needs Design

Direction is clear, approach needs a design doc before implementation.

- **[L] Make the pulse interval a real knob — four processors don't scale with theirs** — `catchUpFactor`
  (`lib/tick/shard.ts:52`) exists to make a processor apply "elapsed-ticks worth" per run, so tuning an
  interval changes granularity and not the wall-clock rate. It is wired into **`economy.ts` and
  `migration.ts` only**. `population.ts`, `infrastructure-decay.ts`, `directed-build.ts` and
  `directed-logistics.ts` all ride the same pulse and take no magnitude scaling — so changing
  `MONTH_LENGTH` from 24 to 10 silently makes population growth, decay, construction and logistics 2.4×
  faster per game-year while the economy and migration correctly compensate. The interval reads as a
  tunable constant and is not one: it is a performance knob that silently moves gameplay rules, which is
  the hazard CLAUDE.md names outright. Not urgent (nothing is broken at 24, the calibrated reference),
  but it blocks every cadence question — including re-basing the tick for armies later. Two parts are not
  mechanical: `idleMonths` is a *counter* not a rate (halve the interval and "three months idle" becomes
  1.5 months of game time), and `PER_BUILD_ABSORPTION_CAP` is the minimum-build-time mechanic and must
  scale with the pool or the parallel-front count moves when someone turns a perf knob. Full findings,
  the Vic3 reference model, and the open design questions: [processor-interval-awareness.md](./build-plans/processor-interval-awareness.md).

- **[M] Tick perf: `toTickSystems` is the whole off-pulse tick outside events** — it costs 2.5ms/tick
  at 2,400 systems, **19.0% of an off-pulse tick** and, since boundary-gating shipped, the only
  remaining cost there other than events (67.5%). **Gating cannot touch it**: ship-arrivals and events
  both genuinely run every tick and both consume `TickSystem` rows, so the join has to happen. The
  lever is to *narrow* it, not skip it — it walks every building row in the galaxy to build the count
  and idle-months rosters, then maps every system, and off-pulse the only consumers are ship-arrivals
  (ids/names) and events (ids, names, control, region). Worth checking what those two actually read
  before assuming the full row is needed; a cheaper off-pulse projection, or moving the roster join
  behind what needs it, is the likely shape. Fold into the events re-point only if that pass changes
  what events reads from a system — otherwise it stands alone.
- **[M] Tick perf: the events processor scales worst in the tick — and is now two-thirds of it** — it
  costs 1.3ms/tick at 600 systems and ~9-10ms at 2,400: **~7× the cost for 4× the systems**, the worst
  scaling curve of any stage. Two shipped changes have hollowed out everything around it without
  touching it — deleting the market World↔Tick round-trip, then gating the monthly-pulse stages' setup
  — so its share has gone **19.4% → ~40% → 67.5% of an off-pulse tick**. It legitimately runs every
  tick (phase progression, plus a spawn every `EVENT_SPAWN_INTERVAL`), so neither lever touched it;
  the cost is the processor itself. Off-pulse it now essentially *is* the tick: events 67.5%,
  `toTickSystems` 19.0% (its own entry above), relations 7.8%, everything else <4%. At 10,000+ systems
  this is the wall. **Fold it into the events re-point** (pivot Phase 5,
  [grand-strategy-vision.md](./planned/grand-strategy-vision.md) §4 "Re-point") rather than fixing it
  standalone — that pass rewrites the model anyway (physical perturbations + player-facing choice
  events), so pay the perf work once, there.
  Percentages are the portable figure — absolute ms move with machine and load (the same off-boundary
  tick measured 54ms on 2026-07-16 and 94ms on 2026-07-17 pre-fix), so re-baseline in-run rather than
  comparing ms across sessions, and measure a before/after in one process as the gating change did.
- **[M] Give markets a real dirty/ownership model — the last full-galaxy copy per tick** — every tick
  the events adapter copies every market row in the galaxy on construction
  (`initial.markets.map((m) => ({ ...m }))`, `lib/tick/adapters/memory/events.ts`) — ~62,000 rows at
  2,400 systems — and events almost never writes one (the spawn log routinely reports `0 shocks`).
  That copy is **load-bearing, not waste**: `markets` starts as `world.markets` itself, and the events
  adapter is the first stage to touch it, so its copy is what stops a later stage mutating rows the
  previous world still holds (see the `let markets` comment in `lib/world/tick.ts`). It cannot be
  gated away for the same reason the events stage cannot — it runs every tick by design.
  Boundary-gating already removed the *second* copy (economy's, which off-pulse was a redundant copy
  of rows events had just de-aliased); population's is pulse-only. So this is now the one remaining
  per-tick full-market pass, and retiring it needs an actual ownership model — copy-on-write rows, or
  a dirty flag the events stage sets when it shocks a market — not another gate. Real correctness risk
  (aliasing the previous world corrupts a save), so it needs a design pass.
  Note the obvious dirty-check is dead on arrival for the same reason recorded when the round-trip was
  deleted: reference-identity against the adapter output always reports "dirty", because the
  constructor hands back fresh rows whether or not anything changed.
- **[L] Paradox-style nested/pinnable deep tooltips** — Rich-tooltip infrastructure in the spirit of
  Stellaris / EU5 / Victoria: tooltips whose terms are themselves hoverable (nested), pinnable for comparison,
  backed by a cross-linking concept glossary so any mechanic term (labour grade, basket, anchor, fulfilment)
  explains itself anywhere it appears. Needs a real design doc + collaborative HTML-prototype pass. The
  shipped tooltip-affordance convention (grey dotted underline, see `docs/active/design-system/theme.md`)
  deliberately reserves a copper treatment as this system's future second tier for glossary-backed concept
  links. **Post-pivot this is core genre UI, not polish** — slot it once the player seat (pivot Phase 3) exists.

## Future

Blocked on prerequisites or very large scope.

- **[M] Switchable faction relation model** — `FactionRelation` currently stores one shared `score` per faction pair (symmetric). If the War re-spec or later play-testing reveals asymmetric opinions matter (one-sided grudges, vassal arrangements, "I trust you more than you trust me"), switch to per-direction scores. Two shapes available: (a) add `aOpinionOfB` / `bOpinionOfA` columns keeping the canonical-ordering convention; (b) drop ordering, store two rows per pair. Reevaluate when the pivot's diplomacy phase (Phase 5) or war (Phase 6) is specced.
- **[S] Flow-overlay particle thresholds vs economy-scale** — The map flow-overlay particle density (`LOGISTICS_FLOW` / `TRADE_FLOW` in `components/map/pixi/theme.ts`: `volumePerExtraParticle`, `minParticlesPerEdge`, `maxParticlesPerEdge`, `maxTotalParticles`) is tuned for S=1 flow magnitudes and is intentionally **not** scaled by `ECONOMY_SCALE` (client-side visual constants; the knob is server-only by design). At the calibrated S≈100 every edge pins at `maxParticlesPerEdge` and the global budget concentrates on the top flows, so the overlay loses its high- vs low-volume contrast (purely a legibility loss, not perf/correctness). Revisit the thresholds when running at the scaled economy; also a natural fold-in for the pivot's flow-system merge (Phase 4).
