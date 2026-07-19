# Backlog

Actionable work items. When something ships, delete it — git history is the audit trail. For detailed designs, see linked docs in `docs/active/` and `docs/planned/`.

> **Purged 2026-07-06 for the grand-strategy pivot** ([grand-strategy-vision.md](./planned/grand-strategy-vision.md)): items serving the retired personal-player layer (mini-games, smuggling/bribes, hazard chains, reputation decoupling, trade-mission/ship-re-pricing rework, NPC trader agents) and the retiring Postgres runtime (batch writes, events query optimization) are deleted — git history has them. The pivot itself is tracked by phase in the vision doc §8, not here.

Sizes: **S** (hours), **M** (1-2 sessions), **L** (multi-session), **XL** (multi-week).

## Ready

Well-defined, can start now.

- **[S] Needs-tooltip language pass** — the needs-ledger / pop-short tooltips deliberately ship with
  figures plus the single sentence "Higher-pressure needs create more unrest." (a needs-visibility build
  decision: final wording waits for a dedicated nested-tooltip pass). When that pass happens, also
  consider folding the two near-duplicate tooltip bodies (`NeedTooltip` in `population-panel.tsx`,
  `PopShortTooltipBody` in `industry-panel.tsx` — shared header/footer, divergent middles) into a shared
  shell; the duplication was sanctioned at build time.
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
- **[S] Purge the Postgres fossils outside `lib/tick/`** — Prisma was deleted in the Phase-2 pivot, but comments across `lib/types/game.ts:1`, `lib/types/guards.ts:2-4` ("Runtime type guards for Prisma boundary values" — the boundaries are now save-file `deserialize` + API `JSON.parse`), `lib/utils/format.ts:67`, `lib/utils/__tests__/format.test.ts:44`, `lib/world/types.ts:3`, `lib/world/gen.ts:3,49` (points at `prisma/seed.ts`, deleted), `lib/engine/relations.ts:3`, and `lib/engine/system-trade-flow.ts:4,7` still describe it as live. Mostly "no Prisma dependency" negative-space claims that are now vacuous, plus two that point a reader at deleted files. The tick's own two-backend claims were swept with the harness rename; this is the same rot in the layers that PR's scope didn't reach. Comment-only, zero risk. Find them with: `grep -rni "prisma" --include="*.ts" lib/`.
- **[S] Re-validate treasury hoard-boundedness at a long horizon (with Purse Slice 3 Plan 2)** — the
  treasury-core calibration (rates in `lib/constants/treasury.ts`) proved early-game solvency and real
  scarcity windows on 500/1500-tick runs, but the 1500-tick balance trajectory ends in its
  fastest-growing sampled window (mean +12.65/tick over t=1250–1500) with bills consuming only ~34% of
  income at the final pulse — "no runaway hoard" is not yet demonstrated, only "not monotone". Before or
  alongside Plan 2 (when funded fractions start gating construction/logistics and a hoard becomes
  gameplay-relevant), run 2500–3000+ ticks and check balance-to-income ratio over time settles rather
  than climbs; retune sink rates if it climbs. Treasury metrics persist in `experiments/*.json`
  (`treasurySummary`/`treasurySnapshots`), so this is one YAML config + a read.
- **[S] Responsive navigation** — `GameNav` has no mobile breakpoints. Add hamburger menu or collapse below ~640px.
- **[S] Curated universe names** — Current procedural names are generic ("Forge-7"). Add curated name pools or hybrid naming for more flavour.
- **[S] Improve UI for dev cheat panel** — Other floating elements including the sidebar on the map get in the way of the dev cheat panel button. Move it to the header.
- **[S] Improve UI** — Standardize main content panel size, system detail smaller than command center.
- **[S] Colony seed-source tie-break differs between the player verb and the planner on an exact hop
  tie** — the player's direct-colony verb (`findSeedSource`, `lib/services/colony-eligibility.ts`) picks
  the nearest developed same-faction system with a deterministic **smallest-id** tie-break; the autonomic
  planner's own candidate provider (`developProvider`, `lib/world/tick.ts`) picks whichever tied system
  its hop-map iteration encounters **first** (insertion order, not sorted). Decision recorded during the
  Slice 2 PR B review: keep as-is (both are valid, deterministic choices and an exact tie is rare) —
  align only if it ever actually matters (e.g. a test or a player report keys off which specific source
  system a colony drew from).
- **[S] Two independently-coded build-ceiling checks assume monotonic system ownership** — the
  build-options read service (`lib/services/build-options.ts`) nets committed levels from the player
  **faction's** open rows at a system, while the mutation service's own check
  (`committedAt`, `lib/services/construction-orders.ts`) nets **all** open rows at the system regardless
  of faction. The two agree only because a system's owning faction cannot currently change under it
  (conquest doesn't exist yet) — unify behind one shared helper before any ownership-transfer mechanic
  (conquest, rebellion) ships, or a stale rival's in-flight row could under/over-count a player's ceiling.
- **[S] `estStaffing` and `buildingUsed`'s "none"-kind dispatch read staffing differently for support
  types** — `computeBuildOptions`'s `estStaffing` (feasibility readout) is `min` over the grades a
  building's labour vector actually draws (e.g. a Construction Centre's unskilled + skill1); the tick's
  own `buildingUsed` (`lib/engine/industry.ts`) dispatches an `output: { kind: "none" }` building through
  `count × labourFulfil` only (unskilled/overall fulfilment, not skill1). The two numbers can diverge for
  a support building whose skill1 draw is the binding constraint — a display-consistency note, not a
  correctness bug (both are internally consistent with what they each drive); worth a single shared
  staffing-estimate helper if the divergence ever confuses a player-facing readout.
- **[M] System-finder dev tool** — A queryable dev panel (or `scripts/` CLI) to surface representative systems by characteristic for manual smoke-testing / QA: population band (dead/undeveloped/tiny-outpost/healthy), economy-type, deposit profile, building roster, NaN/anomaly checks — returning name + direct `/system/<id>` link. Recurring need whenever generation/economy changes land (e.g. verifying barren-but-alive systems read correctly). Build it against the in-memory world (`getWorld()`), surfaced in a `scripts/` CLI or the dev-tools panel.

## Needs Design

Direction is clear, approach needs a design doc before implementation.

- **[M] Faction-screen colonise verb with map-based target selection** — deferred from the Slice 2
  control-surface design pass (2026-07-18). The faction construction command card gets a colonise
  action that enters a **map target-selection mode** (eligible systems highlighted, click to direct
  the colony) — explicitly not a dropdown. Complements the shipped per-system Establish-colony verb on
  a controlled system's Overview (see [player-seat.md](./active/gameplay/player-seat.md)). Needs a
  short design pass for the map selection-mode interaction before building.

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
