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
- **[S] Purge the Postgres fossils outside `lib/tick/`** — Prisma was deleted in the Phase-2 pivot, but comments across `lib/types/game.ts:1`, `lib/types/guards.ts:2-4` ("Runtime type guards for Prisma boundary values" — the boundaries are now save-file `deserialize` + API `JSON.parse`), `lib/utils/format.ts:67`, `lib/utils/__tests__/format.test.ts:44`, `lib/world/types.ts:3`, `lib/world/gen.ts:3,49` (points at `prisma/seed.ts`, deleted), `lib/engine/relations.ts:3`, and `lib/engine/system-trade-flow.ts:4,7` still describe it as live. Mostly "no Prisma dependency" negative-space claims that are now vacuous, plus two that point a reader at deleted files. The tick's own two-backend claims were swept with the harness rename; this is the same rot in the layers that PR's scope didn't reach. Comment-only, zero risk. Find them with: `grep -rni "prisma" --include="*.ts" lib/`.
- **[S] Responsive navigation** — `GameNav` has no mobile breakpoints. Add hamburger menu or collapse below ~640px.
- **[S] Curated universe names** — Current procedural names are generic ("Forge-7"). Add curated name pools or hybrid naming for more flavour.
- **[S] Improve UI for dev cheat panel** — Other floating elements including the sidebar on the map get in the way of the dev cheat panel button. Move it to the header.
- **[S] Improve UI** — Standardize main content panel size, system detail smaller than command center.
- **[M] System-finder dev tool** — A queryable dev panel (or `scripts/` CLI) to surface representative systems by characteristic for manual smoke-testing / QA: population band (dead/undeveloped/tiny-outpost/healthy), economy-type, deposit profile, building roster, NaN/anomaly checks — returning name + direct `/system/<id>` link. Recurring need whenever generation/economy changes land (e.g. verifying barren-but-alive systems read correctly). Build it against the in-memory world (`getWorld()`), surfaced in a `scripts/` CLI or the dev-tools panel.

## Needs Design

Direction is clear, approach needs a design doc before implementation.

- **[M] Tick perf: the events processor scales worst in the tick — and is now the biggest lever in
  it** — it costs 1.3ms/tick at 600 systems and 10.5ms at 2,400: **~7× the cost for 4× the systems**,
  the worst scaling curve of any stage. Deleting the market World↔Tick round-trip roughly halved the
  off-boundary tick without touching events, so its share **doubled from 19.4% to ~40%** — it is now
  the single largest stage off-boundary, where the round-trip used to be. It legitimately runs every
  tick (phase progression, plus a spawn every `EVENT_SPAWN_INTERVAL`), so boundary-gating does not
  touch it; the cost is the processor itself. At 10,000+ systems this is the wall. **Fold it into the
  events re-point** (pivot Phase 5, [grand-strategy-vision.md](./planned/grand-strategy-vision.md) §4
  "Re-point") rather than fixing it standalone — that pass rewrites the model anyway (physical
  perturbations + player-facing choice events), so pay the perf work once, there.
  Percentages are the portable figure — absolute ms move with machine and load (the same off-boundary
  tick measured 54ms on 2026-07-16 and 94ms on 2026-07-17 pre-fix), so re-baseline in-run rather than
  comparing ms across sessions.
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
  build recovers roughly the same absolute ms as before, but against a tick that is now half as long
  — so its **share roughly doubled** (the ~13% scoping was taken against the baseline from before the
  market round-trip was deleted). Scoped on the parked `perf/tick-boundary-gating` branch; **no
  longer blocked** — the market round-trip it waited on has shipped.
  The gateable off-boundary setup now reads (2,400 systems): `migration+edges` 12.4%,
  `marketRowsBySystem` 12.3%, `toTickSystems` 13.3% — together ~38% of an off-boundary tick, second
  only to events (~40%, which gating cannot touch). `marketRowsBySystem` is the natural first cut of
  those: it still rebuilds a row per market every tick.
  **`marketRowsBySystem` is not the only full-market pass left, though — re-measure before assuming
  it is.** Each adapter still copies every market row on construction
  (`initial.markets.map((m) => ({ ...m }))`), and both the events and economy stages are
  unconditional, so **two full ~62K-row copies run back-to-back every tick** (a third — population —
  on boundary ticks only). Deleting the round-trip removed the top-of-tick copy but left these, so
  they are now a larger share of a smaller tick. They are not removable by gating alone: they are what
  stops a stage mutating rows the previous world still holds (see the `let markets` comment in
  `lib/world/tick.ts`). Retiring them means giving markets a real dirty/ownership model, which is its
  own piece of work — size it before folding it in here.
- **[M] Switchable faction relation model** — `FactionRelation` currently stores one shared `score` per faction pair (symmetric). If the War re-spec or later play-testing reveals asymmetric opinions matter (one-sided grudges, vassal arrangements, "I trust you more than you trust me"), switch to per-direction scores. Two shapes available: (a) add `aOpinionOfB` / `bOpinionOfA` columns keeping the canonical-ordering convention; (b) drop ordering, store two rows per pair. Reevaluate when the pivot's diplomacy phase (Phase 5) or war (Phase 6) is specced.
- **[S] Flow-overlay particle thresholds vs economy-scale** — The map flow-overlay particle density (`LOGISTICS_FLOW` / `TRADE_FLOW` in `components/map/pixi/theme.ts`: `volumePerExtraParticle`, `minParticlesPerEdge`, `maxParticlesPerEdge`, `maxTotalParticles`) is tuned for S=1 flow magnitudes and is intentionally **not** scaled by `ECONOMY_SCALE` (client-side visual constants; the knob is server-only by design). At the calibrated S≈100 every edge pins at `maxParticlesPerEdge` and the global budget concentrates on the top flows, so the overlay loses its high- vs low-volume contrast (purely a legibility loss, not perf/correctness). Revisit the thresholds when running at the scaled economy; also a natural fold-in for the pivot's flow-system merge (Phase 4).
