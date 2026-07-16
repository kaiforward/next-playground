# Backlog

Actionable work items. When something ships, delete it — git history is the audit trail. For detailed designs, see linked docs in `docs/active/` and `docs/planned/`.

> **Purged 2026-07-06 for the grand-strategy pivot** ([grand-strategy-vision.md](./planned/grand-strategy-vision.md)): items serving the retired personal-player layer (mini-games, smuggling/bribes, hazard chains, reputation decoupling, trade-mission/ship-re-pricing rework, NPC trader agents) and the retiring Postgres runtime (batch writes, events query optimization) are deleted — git history has them. The pivot itself is tracked by phase in the vision doc §8, not here.

Sizes: **S** (hours), **M** (1-2 sessions), **L** (multi-session), **XL** (multi-week).

## Ready

Well-defined, can start now.

- **[M] Tick perf: delete the market World↔Tick round-trip — it is half of every tick** —
  `mergeMarketsIntoWorld` (`lib/world/tick.ts`, the assemble step) costs **27.1ms/tick at 2,400
  systems — 49.9% of an off-boundary tick**; the `toTick*` joins add another 7.0ms (12.9%). Every
  market row in the galaxy (26 goods × system count ≈ 62,000 rows at 2,400 systems) is rebuilt into
  tick shape and back on *every* tick, changed or not. With ~89–93% of ticks off-boundary this is the
  single biggest lever in the tick — bigger than everything else combined.
  **The fix is to delete the round-trip, not to cache it.** `TickMarket` (`lib/tick/rows.ts`) differs
  from `WorldMarket` (`lib/world/types.ts`) by exactly three fields, and all three are static `GOODS`
  constants: `basePrice`, `priceFloor`, `priceCeiling`. `toTickMarkets` joins them in from
  `GOODS[m.goodId]`; `mergeMarketsIntoWorld` writes back only `stock`/`anchorMult`/`demandRate` — it
  rebuilds 62,000 rows to strip the same three constants back off. Have the processors read
  `GOODS[goodId]` at point of use and the two shapes collapse into one, taking the merge with them.
  Start by enumerating the three constants' consumers (`marketRowsBySystem`'s
  `MarketRowForLogistics` is one).
  **Do not reach for the obvious dirty-check — it cannot work.** Reference-identity against the
  `toTickMarkets` output is dead on arrival: every adapter constructor copies each row into a fresh
  object (`initial.markets.map((m) => ({ ...m }))` — `lib/tick/adapters/memory/economy.ts`,
  `events.ts`, `population.ts`), so it hands back fresh rows whether or not anything changed and the
  check reports "dirty" every tick. It fails safe: no correctness bug, no win. The same finding
  retires the aliasing hazard that made this look design-heavy — the adapters never mutate the
  caller's rows. A dirty flag from the events adapter is the one surviving variant (off-boundary only
  events can touch markets, and it usually doesn't — the spawn log routinely reports `0 shocks`), and
  it is second-best to deleting the round-trip outright.
  Measured 2026-07-16 by temporarily instrumenting `runWorldTick` section boundaries (scratch, not
  committed); marks accounted for 100% of wall time. Sibling costs for scale: events 10.5ms, economy
  2.4ms, `mergeSystems` 0.57ms, `flattenBuildings` 0.13ms, `rebuildModifiers` 0.06ms.
- **[S] Alarm the ECONOMY_SCALE invariance bridge** — `vitest.config.ts` pins `ECONOMY_SCALE: "1"`, so
  the whole suite tests a scale nobody plays at (the code default, and the game's scale, is 100). That
  is defensible **only because** `lib/engine/__tests__/economy-scale-invariance.test.ts` and
  `lib/world/__tests__/economy-scale-dynamic-invariance.test.ts` prove the economy is S-invariant —
  those two tests are the load-bearing bridge that makes S=1 testing valid for an S=100 game. When
  invariance broke (the directed-logistics `Math.floor` that quantized the matcher's continuous
  transfers away), the bridge collapsed and every magnitude assertion in the suite silently became
  meaningless, with nothing detecting it. Make the dependency explicit and alarmed, so the next
  invariance break fails loudly at the bridge instead of quietly everywhere else.
- **[S] Purge the Postgres fossils outside `lib/tick/`** — Prisma was deleted in the Phase-2 pivot, but comments across `lib/types/game.ts:1`, `lib/types/guards.ts:2-4` ("Runtime type guards for Prisma boundary values" — the boundaries are now save-file `deserialize` + API `JSON.parse`), `lib/utils/format.ts:67`, `lib/utils/__tests__/format.test.ts:44`, `lib/world/types.ts:3`, `lib/world/gen.ts:3,49` (points at `prisma/seed.ts`, deleted), `lib/engine/relations.ts:3`, and `lib/engine/system-trade-flow.ts:4,7` still describe it as live. Mostly "no Prisma dependency" negative-space claims that are now vacuous, plus two that point a reader at deleted files. The tick's own two-backend claims were swept with the harness rename; this is the same rot in the layers that PR's scope didn't reach. Comment-only, zero risk. Find them with: `grep -rni "prisma" --include="*.ts" lib/`.
- **[S] Responsive navigation** — `GameNav` has no mobile breakpoints. Add hamburger menu or collapse below ~640px.
- **[S] Curated universe names** — Current procedural names are generic ("Forge-7"). Add curated name pools or hybrid naming for more flavour.
- **[S] Improve UI for dev cheat panel** — Other floating elements including the sidebar on the map get in the way of the dev cheat panel button. Move it to the header.
- **[S] Improve UI** — Standardize main content panel size, system detail smaller than command center.
- **[M] System-finder dev tool** — A queryable dev panel (or `scripts/` CLI) to surface representative systems by characteristic for manual smoke-testing / QA: population band (dead/undeveloped/tiny-outpost/healthy), economy-type, deposit profile, building roster, NaN/anomaly checks — returning name + direct `/system/<id>` link. Recurring need whenever generation/economy changes land (e.g. verifying barren-but-alive systems read correctly). Build it against the in-memory world (`getWorld()`), surfaced in a `scripts/` CLI or the dev-tools panel.

## Needs Design

Direction is clear, approach needs a design doc before implementation.

- **[M] Tick perf: the events processor scales worst in the tick** — it costs 1.3ms/tick at 600
  systems and 10.5ms at 2,400 — **~7× the cost for 4× the systems**, the worst scaling curve of any
  stage, and 19.4% of an off-boundary tick at 2,400. It legitimately runs every tick (phase
  progression, plus a spawn every `EVENT_SPAWN_INTERVAL`), so boundary-gating does not touch it; the
  cost is the processor itself. At 10,000+ systems this is the wall. **Fold it into the events
  re-point** (pivot Phase 5, [grand-strategy-vision.md](./planned/grand-strategy-vision.md) §4
  "Re-point") rather than fixing it standalone — that pass rewrites the model anyway (physical
  perturbations + player-facing choice events), so pay the perf work once, there. Measured 2026-07-16
  alongside the market round-trip above.
- **[L] Paradox-style nested/pinnable deep tooltips** — Rich-tooltip infrastructure in the spirit of
  Stellaris / EU5 / Victoria: tooltips whose terms are themselves hoverable (nested), pinnable for comparison,
  backed by a cross-linking concept glossary so any mechanic term (labour grade, basket, anchor, fulfilment)
  explains itself anywhere it appears. Needs a real design doc + collaborative HTML-prototype pass. The
  shipped tooltip-affordance convention (grey dotted underline, see `docs/active/design-system/theme.md`)
  deliberately reserves a copper treatment as this system's future second tier for glossary-backed concept
  links. **Post-pivot this is core genre UI, not polish** — slot it once the player seat (pivot Phase 3) exists.

## Future

Blocked on prerequisites or very large scope.

- **[S] Tick perf: gate the per-tick setup work at the boundary** — most stages build their full setup
  every tick and rely on the *processor* to bail internally via `pulseShard`; relations is the only
  block in `runWorldTick` that is itself tick-gated. Gating the setup for economy/migration/logistics/
  build recovers ~13% of wall time. Scoped on the parked `perf/tick-boundary-gating` branch.
  **Blocked on the market round-trip above, and re-measure before designing it**: this scoping assumed
  the round-trip's cost stays, and that lever is ~50% of an off-boundary tick against this one's ~13%
  — deleting it moves both the baseline and the ranking.
- **[M] Switchable faction relation model** — `FactionRelation` currently stores one shared `score` per faction pair (symmetric). If the War re-spec or later play-testing reveals asymmetric opinions matter (one-sided grudges, vassal arrangements, "I trust you more than you trust me"), switch to per-direction scores. Two shapes available: (a) add `aOpinionOfB` / `bOpinionOfA` columns keeping the canonical-ordering convention; (b) drop ordering, store two rows per pair. Reevaluate when the pivot's diplomacy phase (Phase 5) or war (Phase 6) is specced.
- **[S] Flow-overlay particle thresholds vs economy-scale** — The map flow-overlay particle density (`LOGISTICS_FLOW` / `TRADE_FLOW` in `components/map/pixi/theme.ts`: `volumePerExtraParticle`, `minParticlesPerEdge`, `maxParticlesPerEdge`, `maxTotalParticles`) is tuned for S=1 flow magnitudes and is intentionally **not** scaled by `ECONOMY_SCALE` (client-side visual constants; the knob is server-only by design). At the calibrated S≈100 every edge pins at `maxParticlesPerEdge` and the global budget concentrates on the top flows, so the overlay loses its high- vs low-volume contrast (purely a legibility loss, not perf/correctness). Revisit the thresholds when running at the scaled economy; also a natural fold-in for the pivot's flow-system merge (Phase 4).
