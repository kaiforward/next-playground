# Logistics lanes — working file

## Build plan — map-generation sub-project

Sub-project 1 of the spec (`docs/planned/logistics-lanes.md` §5); lane mechanics follow as their
own sub-project. Branch shape per AGENTS: integration branch `shared/logistics-lanes` off main;
the current `feat/logistics-lanes` (brainstorm → evidence → spec) is sub-PR 1 into it; this plan's
work runs on `feat/map-gen-geography`, sub-PR 2. Phases below are check-in pauses, never PRs.

### Resolution — every measure to its producer

| Measure (spec prose) | State | Producer |
|---|---|---|
| density grid (128×128, 0–1) | new | Task 1 |
| cluster seed count K "derived from system count" | new | Task 1 knob defaults via `genConfigForSystemCount` / `interpolateBySqrtN` (`lib/constants/universe-gen.ts:78,71`) |
| seed size skew + ellipse stretch | new | Task 1 (authored constants, proposals) |
| seed influence / distance falloff | new | Task 1 |
| two noise layers | new | Task 1 (seeded via `mulberry32`, `lib/engine/universe-gen.ts:86`) |
| void floor | new | Task 1 constant |
| corridor pair choice (MST over seeds) | exists | `kruskalMST` (`lib/engine/universe-gen.ts:446`), re-aimed at seeds in Task 1 |
| corridor realisation (waypoint band / crossing lane) | new | Task 3; style mix decided at Gate A |
| density-varying placement radius | new | Task 2 (variable-radius variant of `bridsonSample`, `lib/engine/universe-gen.ts:219-305`) |
| region = Voronoi over cluster seeds | exists | `assignRegions` (`lib/engine/universe-gen.ts:312`) with seed centers; names via `REGION_NAMES` (`lib/constants/universe-gen.ts`) + wrap path (`lib/engine/universe-gen.ts:152`) |
| `isGateway` = corridor endpoint | exists (field `lib/world/types.ts:107`) | new writer in Task 3 |
| crossing-lane fuel class | exists | `laneFuelCost` multiplier arg (`lib/engine/universe-gen.ts:421-428`) |
| fuel p90/p10, all + trafficked cohorts | new | Task 4 harness module |
| corrected flow projection (own+unclaimed, fuel-weighted) | new | Task 4, importing `buildFuelAdjacency` (`lib/engine/pathfinding.ts:43`) |
| cross-faction lane count | new | Task 4 |
| beyond-crossing cohort (colony cluster ≠ faction homeworld cluster) | new | Task 4 fold over `regionIndex` + faction homeworld |
| relations-score distribution + border_conflict count | exists (state) | new report rows, Task 4 |
| re-derived ≥0.40 concentration line | — | Gate A output |
| `distanceDecay` recalibration | exists (`lib/constants/population.ts:159`) | Gate A action |
| shape-knob config type | new | Task 1 export; boundary schema Task 6 (`newGameSchema`, `lib/schemas/game-setup.ts:5`) |
| map extent derivation | exists | `interpolateBySqrtN` (`lib/constants/universe-gen.ts:71`) — unchanged |

### Task 1 — Galaxy-shape engine: density grid, cluster seeds, corridors

Files: `lib/engine/density-field.ts` (new), `lib/engine/__tests__/density-field.test.ts` (new),
`lib/constants/universe-gen.ts` (shape-knob defaults + sqrt-N derivation entries).
Interface: `GalaxyShapeKnobs { clusterCount, sizeSkew, clusterSpacing, voidFloor,
corridorsPerCluster, corridorStyle }`; `ClusterSeed { x, y, size, stretch, angle }`;
`DensityGrid { resolution, cells: number[] }` (flat array, JSON-serialisable);
`CorridorPlan { pairs: Array<{ a, b, style }> }`;
`buildGalaxyShape(knobs, mapSize, rng) → { grid, seeds, corridors }`. Pure; no import that pulls
`lib/constants/economy-scale` (the preview renders it on the main thread — `client/worker/boot.ts`
docstring constraint).
Proves: cells below the floor read exactly 0 (true void, not small); the size distribution
actually skews (a few large, many small — not uniform) across seeds; every seed pair chosen by the
corridor MST gets a raised-density band or a crossing mark, and no seed is left unconnected; same
knobs + seed → byte-identical grid twice; a degenerate single-cluster knob set still yields a
valid grid rather than crashing.
Consumes: nothing.

### Task 2 — Density-aware placement and cluster regions

Files: `lib/engine/universe-gen.ts` (`bridsonSample` variable-radius variant, `generateRegions` /
`generateSystems` rework to consume `buildGalaxyShape`), `lib/world/gen.ts` (`buildGenParams`
lockstep, `lib/world/gen.ts:55`), `lib/constants/universe-gen.ts` (`UniverseGenConfig` members),
`lib/engine/__tests__/universe-gen.test.ts` + `universe-gen-invariants.test.ts` (re-authored —
seeds shift by design; intrinsic invariants replace parity), `lib/map/mock-data.ts` (fixture).
Interface: `GenParams` gains the shape knobs; `generateSystems(rng, regions, params)` keeps its
signature but places by grid density; regions are the Voronoi partition over cluster seeds
(`Region` row shape unchanged: id, name, dominantEconomy, x, y — center = seed position).
Proves: no system lands in a zero-density cell; median nearest-neighbour distance inside clusters
reads tighter than on corridor bands (density actually modulates the radius); every system's
region is its nearest seed; homeworld stamping still yields the spaced, substrate-biased
homeworlds on a clustered map (`stampHomeworldPrefabs` untouched but exercised); cluster counts
past 28 name via the wrap path without collision; same `{systemCount, seed}` → byte-identical
world (determinism contract, `lib/world/gen.ts:77-83`).
Consumes: Task 1 (`buildGalaxyShape`).

### Task 3 — Connections: per-cluster lanes + realised corridors

Files: `lib/engine/universe-gen.ts` (`generateConnections`: phase 1 intra-cluster MST + extras
kept; phases 2–3 — region-centre MST `:543-547` and gateway pairs `:549-604` — replaced by
corridor realisation from `CorridorPlan`), `lib/utils/region.ts` (`getIntraRegionConnections` /
`getInterRegionConnections` / `getGatewayTargetRegions` re-read against the new structure — the
intra/inter dichotomy survives with region=cluster; verify semantics, rename only if behaviour
shifted), tests.
Interface: crossing lanes priced through `laneFuelCost`'s multiplier (the crossing class);
waypoint-band corridors laned at intra rates along the band; `isGateway` written on
corridor-endpoint systems (readers are cosmetic — map styling, two panel badges, one territory
sort — spec §5).
Proves: the finished lane graph is fully connected (every system reachable — union-find over
lanes); no cross-cluster lane exists outside a corridor pair the plan chose; a crossing lane costs
more than an intra lane of the same length (the class multiplier bites); `isGateway` holds exactly
on corridor endpoints, nowhere else; a map with `corridorStyle` at each extreme (all-band /
all-crossing) generates validly.
Consumes: Task 1 (CorridorPlan), Task 2 (placed systems + regions).

### Task 4 — Geography acceptance instruments in the harness

Files: `lib/tick-harness/geography-analysis.ts` (new — first harness module to read the connection
graph), `lib/tick-harness/types.ts` (summary interface + `HarnessResults` field),
`lib/tick-harness/runner.ts` (registration), `scripts/simulate.ts` (report block, copy the
`logisticsActivity` idiom), `lib/tick-harness/experiment.ts` (comparison fields),
`lib/tick-harness/__tests__/harness-results-fixture.ts` (fixture field), tests (new).
Interface: `summariseGeography(finalWorld, flowEvents) → { topDecileShare, topDecileShareByFaction,
fuelP90P10All, fuelP90P10Trafficked, crossFactionLaneCount, beyondCrossingCohort }` — the
projection uses own+unclaimed adjacency and fuel-weighted shortest paths
(`buildFuelAdjacency` + the Dijkstra, `lib/engine/pathfinding.ts:43,109-111`), per spec §5's
corrected instrument; the beyond-crossing cohort folds migrant inflow and population trajectory by
colony-cluster ≠ faction-homeworld-cluster. Report rows also surface the existing relations-score
distribution and border_conflict count. NaN rule: zero denominators report 0 with the reason
(`lib/tick-harness/logistics-analysis.ts` conventions).
Proves: projection volume conserves exactly (Σ placed edge volume = Σ haul quantity × path length
— the premise-1 validation trick); a zero-flow world reports zeros, never NaN; the trafficked
cohort is a strict subset of the all-edges cohort; per-faction rows gate on a minimum trafficked
edge count; the fixture-typed field fails the build if unregistered (vacuity: delete the runner
fold, watch the type/test break).
Consumes: Task 3 (generated worlds with corridors).

### Gate A — Candidate sweep and owner acceptance

Arms: candidate knob sets across cluster count / size skew / spacing / void floor / corridor style
(all-band, all-crossing, mixed), seeds 42/43/44, viewed in the Task 5 preview and read through the
Task 4 instruments at both horizons.
Reads: fuel p90/p10 (both cohorts), top-decile concentration (re-derived line — the committed 0.40
was calibrated on the old projection), migration beyond-crossing cohort, cross-faction lane count,
relations-score distribution + border_conflict count, conservation identities, coarse health bar.
Merge condition: owner picks the shipped default knob set and the corridor style mix by looking;
fuel spread ≥ 2 on both cohorts; the re-derived concentration line is documented in this file and
met; `distanceDecay` recalibrated against the generated distribution (or kept, with the receipt
quoted); no conservation identity fails; the booking "re-derive the ≥0.40 line" closes here.

### Gate A — results (recorded 2026-09-01, shipped defaults, seed 42, 600 systems, both horizons)

Owner-driven candidate exploration replaced a formal arm sweep: the preview gained live levers
(star spacing, cluster tightness, map size, cluster turbulence) plus geometry-driven corridor
style (void-fraction measured on the base grid; fan suppression at 20°), and the owner picked
the shipped defaults by eye — BASE_CONFIG knobs with POISSON_MIN_DISTANCE 117 (request fully
placed at 600 and 5000; the ×1.0 / 180 default filled ~48%).

Instrument reads (equilibrium 10,000t unless noted; founding 1000t structurally empty of flow
as measured at premise 1):

- **Re-derived concentration line: aggregate top-decile share ≥ 0.35 on the corrected
  instrument.** Reads 0.383 (vs 0.282 for the flat map on the same instrument — geography
  concentrates flow by +36%); per-faction rows over the 20-edge gate: 0.393 / 0.612 / 0.504.
  Line met.
- **Fuel p90/p10: 1.81 both cohorts — the committed ≥ 2 line is NOT met** (flat map read
  1.99/1.93). **Owner decision (2026-09-01): accepted; the ≥ 2 line is retired as a gate.**
  Rationale: premise 4 already established raw fuel cost cannot differentiate lanes alone;
  invested lane infrastructure (the next sub-project) is the intended differentiator, and
  tuning the map's look against that unfinished system would invert the priority. The owner
  notes the maps do not read as uniform to the eye — the structural variety (clusters, voids,
  corridors) also makes locations findable, value beyond lane variance. Revisit fuel spread
  when lane mechanics ship.
- Migration across geography healthy at current `distanceDecay` 0.1: beyond-crossing cohort
  (n=39) mean migrant inflow 56 vs interior (n=123) 69, population trend 0.50% vs 0.41% —
  far colonies grow at least as fast; **`distanceDecay` kept at 0.1, receipt: this cohort
  read.**
- Cross-faction lanes 182 (89 on the flat map — denser borders); border_conflict events over
  the run 116, none on board at end. Relations scores pin at ±100 extremes at equilibrium
  (median −100) — pre-existing clamp behaviour, unchanged shape from the flat map; watch item
  for the relations pass, not a geography regression.
- Unreachable haul share 4.5% (old-instrument noise band was 3.6–8.6%).
- All conservation identities PASS at both horizons; no collapsed systems; 162 developed
  colonies + 20 homeworlds at 10K.

### Task 5 — Galaxy-preview prototype (styleguide section)

Files: `components/start/galaxy-preview.tsx` (new), `components/panels/styleguide-panel.tsx`
(new `StyleSection`), routed at `/styleguide` (`client/routes.ts:27,33,40` — exists).
Interface: `<GalaxyPreview knobs={GalaxyShapeKnobs} seed={number} systemCount={number} />` —
renders the density field via canvas `ImageData` plus star dots from the real engine placement
(same `mulberry32` draw order as the worker, so the impression IS the playable galaxy), regenerates
on prop change.
Reuse (props read this session): `NumberInput` (`components/form/number-input.tsx:4-7` —
`Omit<InputFieldProps,"type">`, forwardRef), `RangeInput`
(`components/form/range-input.tsx:35-44` — the slider for skew/void-floor knobs),
`SegmentedControl<T>` (`components/form/segmented-control.tsx:38-48` — corridor-style picker),
`StyleSection` (`styleguide-panel.tsx:19`). New: `GalaxyPreview` — nothing fits: the codebase has
no 2D-canvas rendering pattern at all (nearest are SVG sparklines/rings and Pixi, both wrong
tools for an ImageData field + a few thousand dots).
Proves: same knobs + seed renders an identical impression twice; the dots match a world generated
from the same inputs (parity with `generateWorld` placement — the determinism seam); extreme knobs
(void floor 1.0, cluster count 1) render without crashing; a 20,000-system impression completes
within an interactive bound.
Consumes: Tasks 1–2 (engine functions), and its approval is the AGENTS prototype gate for Task 6.

### Task 6 — New Game wiring

Files: `lib/schemas/game-setup.ts` (`newGameSchema` gains optional shape knobs with server-side
defaults), `components/start/create-faction-form.tsx` (knob section + embedded `GalaxyPreview`;
also fix the hardcoded 600 default at `:40` to import `DEFAULT_SYSTEM_COUNT`),
`components/start/start-screen.tsx` (the New Game `Dialog` at `:198` grows to hold the preview —
stays a dialog, no new route), `client/worker/game-worker.ts` (payload through `:83,361-368`),
`lib/services/game.ts` (knobs → `generateWorld`), `lib/world/gen.ts` +
`lib/constants/universe-gen.ts` (the four-place knob lockstep: `UniverseGenConfig`, `BASE_CONFIG`,
`GenParams`, `buildGenParams`).
Interface: `NewGameInput` gains `shape?: GalaxyShapeKnobs`; omitted → the Gate-A defaults.
Reuse: `Dialog`/`useDialog` (props read — `start-screen.tsx:198`), RHF + zodResolver as the form
already does. New: none beyond Task 5's component.
Proves: a `newGame` with no knobs produces a byte-identical world to the Gate-A default set (the
back-compat pin); out-of-range knobs are rejected at the schema, not downstream; the previewed
galaxy and the played galaxy match for identical inputs end-to-end (form → worker → gen); an
omitted seed still randomises (`lib/services/game.ts:18`).
Consumes: Tasks 1–2 (knob type), Task 5 (approved component).

### Verification

`npm run simulate` on the shipped default map, **both horizons**, quoted in the sub-PR: all
conservation identities pass; coarse health bar (no NaN/runaway/pinning, dispersion, liquidity)
comparable to the flat-map baseline; the new geography table (fuel spread both cohorts,
concentration aggregate + per-faction, cross-faction lane count, beyond-crossing cohort) at both
horizons. Build gate `npm run build` (tsc && vite build). Determinism: re-authored invariants
tests green; preview↔world parity test green. Red-proof per task's Proves list before review.

### Doc fold

On the branch before final review: `docs/active/gameplay/universe.md` (placement, regions,
gateways sections rewritten to density-grid/cluster/corridor reality),
`docs/SPEC.md` Universe & Map paragraph, `docs/active/engineering/map-rendering.md` only if it
names gateway/region structure (check at fold). The spec `docs/planned/logistics-lanes.md` stays
in planned/ until the lane sub-project ships (multi-PR rule); its §5 is marked shipped-by-sub-PR
at the fold. This working file survives until the whole feature ships.

### Not covered

- **Lane mechanics** (§1–§4, §6–§8 of the spec) — the next sub-project; the spec itself is the
  booking.
- **Player map-drawing tool** — booked: `docs/ROADMAP.md` row added in this plan's commit (second
  author of the same density grid; after the lanes pass).
- **Deep-space crossing lane class / open-space travel tech** — dropped for now: named in the
  spec's Not-claimed with the future shape (a lane-class unlock), no roadmap row until the tech
  system exists.
- **Connection-object style fingerprint widening + per-lane map state** (`connection-object.ts:27`
  binary fingerprint; fuel labels unrendered) — booked at the lane sub-project, which owns lane
  visuals; the map-gen pass keeps today's two-style drawing (region-crossing lanes read as
  crossings automatically under region=cluster).
- **Region-label centroid drift** (`territory-layer.ts:107` labels at member centroid) — no issue
  under region=cluster: members ARE the cluster, so the centroid sits inside it; noted, not
  changed.

### Net-new UI

One item: **`GalaxyPreview`** (canvas + ImageData density field + star dots — the codebase's first
2D-canvas component; knobs compose existing form controls). Prototype-first: it lands as a
styleguide section (Task 5) and is the owner-approved prototype before the New Game wiring
(Task 6) starts.

### Carried into the lane-mechanics sub-project

Items the gitignored session ledger (`temp/sdd/map-gen-geography/progress.md`) held that had to
survive the map-gen branch, with the owner decisions taken on them (2026-09-03):

- **Test blind spot** (open, engineering): no test catches a band waypoint cross-wired into the
  wrong pair's chain when two band corridors run geometrically close — the repair-lane count stays
  0 and today's provenance assertions cannot see it. Lands on this branch with a red-proof.
- **Lane-length observation → crossings are just lanes** (decided). Intra-cluster lanes sometimes
  out-run corridor crossings; the only reader of `WorldConnection.isCrossing` was the map's line
  style, so the ordering the name implied was never a mechanic. The flag leaves the connection row;
  the map draws every lane by its fuel cost. The New Game preview keeps drawing crossings from the
  corridor plan (a generation-time exception the player should see). The tech-gated deep-space
  lane class (spec §5) stays the one real second class; wormholes, if ever, a third.
- **Foreign transit** (decided, spec §2 amended): traversable when the holder's relation tier with
  the hauler is friendly or allied; neutral and below closed; negotiated rights stay the future slot.
- **`lanePruneFraction`** stays internal at its connectivity-tested 0 — the preview cannot show
  lanes and the knob has no felt effect until lane investment exists; revisit only if the
  lane-mechanics sim shows lane density changes play.

## Build plan — lane-mechanics sub-project

Sub-project 2 of the spec (`docs/planned/logistics-lanes.md` §1–4, §6–8, plus the map-gen plan's
"Carried into…" items above). Branch: `feat/lane-mechanics` off `shared/logistics-lanes`. Phases
are check-in pauses. **PR shape (proposal):** two sub-PRs into `shared/logistics-lanes` — the
mechanics (Tasks 1–11, Gate B; sim-verifiable on their own) and the surfaces (Gate C, Tasks 12–15;
prototype-gated) — because the UI needs an approved prototype between them and the mechanics can
be reviewed while the prototype is being looked at. One PR if the owner prefers.

### Resolution — every measure to its producer

| Measure (spec prose) | State | Producer |
|---|---|---|
| lane level (float ≥ 0), one row per undirected pair | new | Task 1 `WorldLane.level`; generation writes 0 |
| `capacity(level) = BASE_LANE_CAPACITY × (1 + level)` | new | Task 1 `laneCapacity` + `LANES.BASE_LANE_CAPACITY` (volume per reference cycle, `scaleValue`-denominated like `GENERATION_PER_POP`, `lib/constants/directed-logistics.ts:16`) |
| capacity scaled by `catchUpFactor(LOGISTICS_INTERVAL)` at booking | exists | `catchUpFactor` (`lib/tick/shard.ts`), the processor's `catchUp` (`lib/tick/processors/directed-logistics.ts:90`); Task 5 passes it to the booker |
| per-run booked load (resets each run) | new | Task 2 computes per booker; Task 5 persists on `WorldLane.bookedLoad` |
| capacity-blocked volume, on the first saturated edge of the cheapest path | new | Task 2 `RouteBooking.blocked`; Task 5 persists `WorldLane.blockedVolume` |
| attempted load = booked + blocked (decay input) | new | Task 6 reads the two Task-5 fields |
| investability: faction controls both endpoints (`control ≥ controlled`) | exists (fields `lib/world/types.ts:104-106`) | Task 1 `laneInvestor` |
| route cost = Σ edge `fuelCost` × bounded congestion multiplier; full edge excluded | new | Task 2 (`fuelCost` exists, `lib/world/types.ts:445`; `CONGESTION_MAX` Task 1) |
| prices frozen within one deficit's fan-out, live across deficits | new | Task 2 booker contract (one search per deficit at the moment the queue reaches it) |
| work-budget price = quantity × route cost | exists (`lib/engine/directed-logistics.ts:332-344` per-unit sort, `:355-359` cost) | Task 4 keeps the formula on the booker's `perUnit` |
| per-deficit skip replacing the run-terminating clamp | new | Task 4 (replaces `budget = 0; break`, `lib/engine/directed-logistics.ts:375-379`) |
| `GENERATION_PER_POP` re-denominated so spend keeps today's small fraction | exists (`lib/constants/directed-logistics.ts:8-16`) | Task 5 (value chosen at Gate B from the measured spend fraction) |
| `MAX_HOPS` / `HOP_WEIGHT` / `FUEL_WEIGHT` deleted | exists (`lib/constants/directed-logistics.ts:94-98`; readers `lib/world/tick.ts:1610,1627`) | Task 5 |
| traversable: own + unclaimed + friendly-or-allied holder | new predicate over existing data | Task 5 `laneOpenFor` (`getRelationTier(score)`, `lib/constants/relations.ts:143-156`; ownership `factionId`) |
| faction match order: faction id ascending, pooled booking | new | Task 5 (independents' `null` group last — assumption, see Not covered) |
| `arrival = now + max(0, round(Σ path fuelCost / FREIGHT_SPEED))` | new | Task 3 `freightArrivalTick`; `FREIGHT_SPEED` Task 1 |
| scheduled inbound per (system, good) | new | Task 3 `scheduledInbound` over the ledger; Task 4 consumes at the sink test |
| dispatch sizing against `maxStock − stock − scheduled inbound` | exists cap (`marketBandForRow(...).maxStock`, processor `:177-181`) | Task 5 adds the inbound term at the transfer clamp |
| arrival credit up to band cap; remainder = return leg toward donor | new | Task 3 arrivals stage |
| flow row emitted at arrival with credited quantity | exists shape (`LogisticsFlowInsert`) | Task 3 stage writes it; Task 5 stops the dispatch-time write |
| interdiction query "flows crossing edge E in [t₁,t₂]" | new | Task 3 `flowsCrossingEdge` (no consumer this pass) |
| lane upkeep = own term summed into `bills.maintenance` | new | Task 6 `laneUpkeepWork`; priced by the existing `maintenanceRatePerWork` (`lib/tick/processors/treasury.ts:134-138`) |
| lane decay: idle buffer + whole-level-unused + reset-on-use | exists shape (`idleLevels` `lib/engine/infrastructure-decay.ts:95-96`, hysteresis `:130-137`) | Task 6 `decayLanes`, `LANES.IDLE_BUFFER_CYCLES` Task 1 |
| lane-upgrade project in the committed queue, `origin` tagged | exists queue (`world.constructionProjects`, `orderOpenProjects` `lib/engine/construction.ts:312`) | Task 7 `kind: "lane_upgrade"` |
| project dropped when an endpoint stops satisfying investability | exists site (`dropAbandonedBuildProjects`, `lib/world/tick.ts:1028-1034`) | Task 7 extends it |
| effective level = built + queued | exists pattern (`queuedBuildLevelsBySystem`, `lib/engine/directed-build.ts:325-334`) | Task 8 `queuedLaneLevels` |
| no further proposal while an upgrade is open | exists pattern (colony in-flight gate, `lib/engine/directed-build.ts:1570-1574`) | Task 8 |
| planner value = blocked volume the upgrade unblocks | new | Task 8 (`WorldLane.blockedVolume`, Task 5) on the existing ROI order (`orderProposals`, `construction.ts:355`) |
| AI claiming: adjacent candidates, score floor softened | exists (`proposeFactionClaims` `lib/engine/expansion.ts:81-92`; `EXPANSION.REACH_JUMPS`/`SCORE_FLOOR`, `lib/constants/expansion.ts:20-28` — spec's `MIN_CLAIM_SCORE` is `SCORE_FLOOR` in code) | Task 8 |
| player claim: adjacent, free, one per `PLAYER_CLAIM_COOLDOWN` cycles | new | Task 9 (`LANES.PLAYER_CLAIM_COOLDOWN` Task 1; `world.player.lastClaimTick` Task 9) |
| `world.player.automation.lanes` | exists shape (five sites: `lib/world/types.ts:49`, `lib/types/api.ts:368`, `lib/schemas/construction-orders.ts:12`, `lib/world/gen.ts:242` (the spec's `:226` is drifted), `lib/services/construction-orders.ts:225-233`) | Task 9 |
| `stockChange` over the whole cycle, not one tick | exists (snapshot `lib/world/tick.ts:1377-1386`, write `:1906-1916`, cadence caveat in the field docstring `lib/world/types.ts:539-548`; clear `:1005-1018`; sole reader `lib/services/alerts.ts:420-421`) | Task 10 persisted baseline |
| "Survival stock falling" instance count before/after | new | Task 11 (harness has no seat — `categories: []`; the rule is folded galaxy-wide) |
| per-lane utilisation distribution, top-decile flow share (real), in-transit volume, blocked volume | new | Task 11 `summariseLanes` |
| deficit spell-length distribution on PHYSICAL stock | new in harness (instrument shape: `temp/lane-premise-diag.ts` `spellStats`) | Task 11 |
| funding-bound market count | exists (`fundingBoundCensus`, `lib/tick-harness/logistics-analysis.ts:57`) | read at Gate B |
| post-clamp skipped-deficit count | new | Task 4 `TransferMatchResult.budgetSkipped`; Task 11 sums |
| contention-attributable unserved shortfall (first-mover read) | new | Task 2 `blocked[].foreignShare`; Task 11 folds per faction |
| queued lane levels vs realised load (overshoot watch) | new | Task 11 from open projects + lane rows |
| logistics wall-clock median and share of tick | new | Task 11 `TickInstrumentation.stageMs` (orchestrator-side timing, calibration-only like every other instrumentation field) |
| goods-mass identity Σ dispatch debits = Σ arrival credits + in-flight + returned | new | Task 11 fifth identity, two independently-recorded sides |
| zero-latency arm; faction-blind traversability arm | new | Task 11 `HarnessConfig.freightSpeed` / `.laneTraversal` threaded through `runWorldTick` opts like `drawBrakeCeiling` (`lib/world/tick.ts:1228`) |
| overshoot read (deliveries landing above target) | new | Task 3 stage instrumentation; Task 11 sums |
| lane state on the map: level, load vs capacity, in-flight | new | Task 12 `getLaneStates` slice |
| in-transit rows with ETA on the Logistics tab | new | Task 13 (`SystemLogisticsData` gains transit rows; durations via `formatDuration`) |

### Task 1 — Lane rows, lane constants, lane engine

Files: `lib/world/types.ts` (`WorldLane`, `World.lanes`), `lib/world/gen.ts` (one row per undirected
pair at level 0, beside the connections mapper `:189-193`), `lib/world/save.ts` (version bump — saves break, pre-1.0 policy), `lib/types/guards.ts`
(save spot-check if the world guard enumerates collections), `lib/constants/lanes.ts` (new),
`lib/engine/lanes.ts` (new), `lib/engine/__tests__/lanes.test.ts` (new). The generator's private index-keyed `laneKey`
(`lib/engine/universe-gen.ts:425`) is a generation-time helper over array indices, not this key —
rename it `pairKey` there so two `laneKey`s do not coexist.
Interface: `WorldLane { key: string; aId: string; bId: string; level: number; bookedLoad: number;
blockedVolume: number; idleCycles: number }` — `key` is the sorted `"a|b"` pair, the same key
`buildOpenEdges` uses (`lib/tick/world/trade-flow-topology.ts`). `LANES = { BASE_LANE_CAPACITY,
CONGESTION_MAX, FREIGHT_SPEED, UPGRADE_WORK_PER_LEVEL, IDLE_BUFFER_CYCLES, PLAYER_CLAIM_COOLDOWN }`
— every value a proposal with its rationale docstring; `CONGESTION_MAX` carries the spec's ~3×.
`laneKey(a, b): string`; `laneCapacity(level): number`; `laneInvestor(lane, ownerOf: (systemId) =>
{ factionId, control }): string | null` (the faction controlling both endpoints, else null).
Proves: two generated lanes never share a key and every connection pair has exactly one lane row
(both directions collapse to one); `laneKey` is order-independent; `laneInvestor` returns null when
one endpoint is unclaimed, when the endpoints belong to different factions, and when either is below
`controlled`; capacity at level 0 is the baseline and strictly rises with level; a world with lanes
round-trips `serialiseWorld`/`deserialiseWorld` byte-identical and a pre-bump save is refused.
Consumes: nothing.

### Task 2 — Route engine: edge-keyed cheapest path with congestion pricing and booking

Files: `lib/engine/pathfinding.ts` (the private `dijkstra` gains an edge-cost hook and is exported;
`findLowestFuelPath`/`findReachableSystems`/ship callers unchanged), `lib/engine/lane-routing.ts`
(new), `lib/engine/__tests__/lane-routing.test.ts` (new), `lib/engine/__tests__/pathfinding.test.ts`.
Interface: `pathfinding.ts` exports `dijkstra(originId, adjacency, options: { maxFuel?; stopAt?;
edgeCost?: (from, to, fuelCost) => number | null })` — null closes the edge for this search.
`lane-routing.ts`: `LaneNetwork` built by `buildLaneNetwork(connections, lanes, capacityOf: (lane)
=> number)`; `createRouteBooker(network, opts: { openEdge: (laneKey) => boolean; congestionMax;
catchUp }): RouteBooker`; `RouteBooker.routeAndBook(from, to, quantity): RouteBooking | null` where
`RouteBooking { placements: Array<{ quantity; edges: string[]; perUnit; fuelTotal }>; blocked:
Array<{ laneKey; quantity; foreignShare }> }` — placements cover the quantity placed (partial when
no affordable path remains for the rest), `blocked` names the first saturated edge of the cheapest
path per the spec's emission rule; `RouteBooker.loads(): ReadonlyMap<laneKey, { booked; blocked }>`;
`RouteBooker.priceFrom(sinkId): (donorId) => number | null` — the frozen per-unit prices for one
deficit's fan-out (one search per deficit; bookings apply after). `foreignShare` is the fraction of
the saturated edge's booked load placed by other factions at the moment of blocking (the
first-mover read's input). The booker is one physical ledger shared by every faction in a run.
Proves: an edge at capacity is excluded, so the cheapest remaining path is returned rather than a
priced-through one; the congestion multiplier never exceeds `congestionMax` even at load just under
capacity; a haul larger than the cheapest path's remaining capacity ships that much on it and the
rest on the next path, with blocked volume recorded once on the choke edge; a closed edge
(`openEdge` false) is never traversed even when it is the only cheap route; two factions booking the
same edge see each other's load; `dijkstra` with no hook returns the same paths as before for every
ship-navigation fixture (the vacuity check on the refactor).
Consumes: Task 1 (`WorldLane`, `laneCapacity`).

### Task 3 — Pending-arrivals ledger, per-tick goods-arrivals stage, interdiction query

Files: `lib/world/types.ts` (`WorldPendingArrival`, `World.pendingArrivals`), `lib/world/gen.ts`
(empty), `lib/world/save.ts` (same bump as Task 1), `lib/engine/freight.ts` (new),
`lib/tick/world/goods-arrivals-world.ts` (new), `lib/tick/adapters/memory/goods-arrivals.ts` (new),
`lib/tick/processors/goods-arrivals.ts` (new), `lib/tick/types.ts` (processor name, instrumentation
fields), `lib/world/tick.ts` (stage directly after ship-arrivals `:1323-1330`, before events;
`pendingArrivals` threaded into `nextWorld`; `processorsRun.push` beside `:1329`), `docs/active/engineering/processor-architecture.md`
(table row), `lib/world/__tests__/tick-stage-gating.test.ts` (enumerates stages), tests
(`lib/tick/processors/__tests__/goods-arrivals.test.ts` new, adapter test).
Interface: `WorldPendingArrival { id: string; factionId: string | null; fromSystemId; toSystemId;
goodId; quantity; dispatchTick; arrivalTick; routeEdges: string[]; leg: "outbound" | "return" }`.
`freight.ts`: `freightArrivalTick(now, fuelTotal, freightSpeed): number` (the spec formula, no
per-hop floor); `scheduledInbound(ledger): ReadonlyMap<"systemId|goodId", number>` (outbound legs
only); `flowsCrossingEdge(ledger, laneKey, fromTick, toTick): WorldPendingArrival[]`.
`GoodsArrivalsWorld { getDueArrivals(tick); getMarketCaps(keys): Map<key, { stock; maxStock }>;
creditMarkets(updates: { id; stock }[]); settleArrivals(applied: { id; credited; returned:
WorldPendingArrival | null }[]); appendFlows(flows: LogisticsFlowInsert[]) }`. Processor result:
`{ credited: number; returned: number; overshootVolume: number }` (instrumentation only). Rules the
stage applies, verbatim from the spec: credit up to the band cap; remainder becomes a `return` leg
toward the donor over the reversed edges at the same delay; flow row written for the credited
quantity of an outbound leg. Two assumptions the spec leaves open, carried here for the owner: a
`return` leg credits the donor **uncapped** (the cancelled-colony precedent — staged materials return
"uncapped", `docs/active/gameplay/player-seat.md` Cancel), and return legs write **no flow row** (the
log stays a record of delivered goods).
Proves: a row due this tick is credited and gone from the ledger, a row due next tick is untouched;
credit stops at the band cap and the excess reappears as one return row toward the donor with the
edges reversed; a return leg landing on the donor credits in full; the flow row carries the credited
quantity, not the dispatched one; `freightArrivalTick` at a large speed returns `now` (the
zero-latency fallback is reachable); `flowsCrossingEdge` returns exactly the rows whose window
overlaps and whose route holds the edge; the stage runs on a non-boundary tick (delete the stage
call, watch the mid-cycle arrival test fail).
Consumes: Task 1 (`laneKey` for `routeEdges`).

### Task 4 — Matcher engine: booked routing in the fill loop, per-deficit skip, inbound-aware sink

Files: `lib/engine/directed-logistics.ts`, `lib/engine/__tests__/directed-logistics.test.ts`.
Interface: `GoodMarketState.scheduledInbound?: number` (absent ⇒ 0); the sink test classifies
`stock + scheduledInbound` against `logisticsTarget`, the donor test stays on `stock`.
`matchFactionTransfers(systems, booker: RouteBookerFor)` where `RouteBookerFor = { priceFrom(sinkId):
(donorId) => number | null; routeAndBook(from, to, quantity): RouteBooking | null }` — replaces
`RouteCost` and `ReachableSystemIds` (both retired; candidates are every same-faction donor holding
drawable surplus). `PlannedTransfer` gains `edges: string[]` and `fuelTotal: number` — one row per
placement, so a partially-placed draw yields several. The budget clamp becomes a per-deficit skip:
an unaffordable draw ends that deficit's fill and the remaining budget continues to the next
deficit; `TransferMatchResult` gains `budgetSkipped: number` (deficits so ended) and keeps
`fundingBound` / `unservable` with their present meanings. Candidate order is the frozen
`priceFrom` order; `routeAndBook` is consulted inside the loop with the quantity.
Proves: a sink with enough goods in flight to clear the deficit line is not a deficit, while the same
stock without inbound is; a donor whose physical stock is at its reserve gives nothing regardless of
its own inbound; one unaffordable draw leaves later, cheaper deficits still funded (the old
run-terminating behaviour is the red arm); a haul the booker splits produces one transfer per
placement whose quantities sum to the draw; `unservable` is unchanged by congestion (a blocked haul
is not an unservable one — both emission sites, `:311` no-source and `:402-408` insufficient-source, stay as they are); `budgetSkipped` counts exactly the deficits the skip ended.
Consumes: Task 2 (`RouteBooking`).

### Task 5 — Logistics processor and tick wiring: dispatch to ledger, lane signals, traversability, constants

Files: `lib/tick/processors/directed-logistics.ts`, `lib/tick/world/directed-logistics-world.ts`,
`lib/tick/adapters/memory/directed-logistics.ts`, `lib/tick/processors/good-market-state.ts`
(inbound joined at the matcher's feed only), `lib/world/tick.ts` (`:1605-1614` BFS radius loses the
logistics term; `:1620-1660` the routeCost/reachable closures replaced by a per-run booker; lanes and
ledger threaded), `lib/engine/lane-access.ts` (new — the traversability predicate),
`lib/constants/directed-logistics.ts` (delete `MAX_HOPS`, `HOP_WEIGHT`, `FUEL_WEIGHT`; re-denominate
`GENERATION_PER_POP` with the docstring's "rare, deliberate" promise restated against route cost),
`lib/services/colony-eligibility.ts` (`COLONY_REACH_HOPS` restated over the two surviving radii),
`lib/constants/__tests__/band-constants.test.ts:608-616`, `lib/world/__tests__/tick-logistics-reach.test.ts:73-80`
(both re-authored), processor tests.
Interface: `DirectedLogisticsProcessorParams` loses `routeCost`/`reachableSystemIds`, gains
`bookerFor(factionKey: string | null): RouteBookerFor` and `scheduledInbound`; factions are matched
in ascending id order, the `null` group last, against one shared booker. The processor debits donors
at dispatch, writes `WorldPendingArrival` rows (`appendPendingArrivals`), writes no flow row, and
emits `applyLaneLoadUpdates(updates: { key; bookedLoad; blockedVolume }[])` from `booker.loads()`
for every lane (zero for unused ones — the reset). Transfer clamp reads
`max − stock − scheduledInbound`. `lane-access.ts`: `laneOpenFor(haulerId, lane, ownerOf,
tierBetween: (a, b) => RelationTier): boolean` — own, unclaimed, friendly, allied open; else closed;
the `null` hauler traverses unclaimed only. Work billed = Σ transfer `cost` as today.
Proves: nothing is credited at the destination on the dispatch tick (stock rises only when the
arrivals stage runs); the ledger row's `arrivalTick` equals the freight formula over the placed
path; a lane crossing neutral foreign space is closed to that hauler and open to a friendly one; the
faction matched first books first on a shared edge (order test with two factions and one saturable
lane); a lane unused this run reads `bookedLoad` 0 even if it was loaded last run; the BFS radius no
longer names a logistics term (constant gone — tsc); the re-denominated budget keeps the
funding-bound census at its pre-change level on the fixture (the vacuity check on the constant).
Consumes: Task 2, Task 3, Task 4.

### Task 6 — Lane upkeep and lane decay

Files: `lib/engine/lanes.ts` (`laneUpkeepWork`, `decayLanes`), `lib/engine/treasury.ts` (no change
if the rate is reused — verify), `lib/tick/processors/treasury.ts` (`bills.maintenance` gains the
lane term; settlement gains `laneUpkeepBill`), `lib/tick/world/treasury-world.ts` +
`lib/tick/adapters/memory/treasury.ts` (lanes and endpoint ownership readable at settlement),
`lib/world/types.ts` (`WorldTreasurySettlement.laneUpkeepBill`), `lib/world/tick.ts` (decay applied
in the logistics boundary block after the processor, on that run's attempted load), tests.
Interface: `laneUpkeepWork(lanes, ownerOf): ReadonlyMap<factionId, number>` — Σ level ×
`UPGRADE_WORK_PER_LEVEL` over lanes the faction is the investor of; the processor prices it with
`maintenanceRatePerWork` × `catchUp` and adds it to `bills.maintenance` (one more term, same band,
the spec's deliberate coupling). `decayLanes(lanes, catchUp, params: { idleBufferCycles }):
{ lanes: WorldLane[]; shed: string[] }` — a lane whose attempted load leaves a whole level's
capacity unused accrues `idleCycles`; at the buffer it sheds one level (never below 0) and resets;
any run that uses the level resets the counter. A lane with no investor still decays (nobody pays).
Proves: a lane at exactly one whole level of unused capacity accrues, one unit less does not; a
congested run (blocked > 0) counts as use; the counter resets on a used run rather than pausing;
level never goes below 0; a faction's maintenance bill rises by exactly the lane term and
`funded.maintenance` moves with it on the ladder; a lane with an unclaimed endpoint bills nobody.
Consumes: Task 1, Task 5 (`bookedLoad`, `blockedVolume`).

### Task 7 — Lane-upgrade project kind

Files: `lib/world/types.ts` (`WorldLaneUpgradeProject`; `systemId` moves off the base onto the two
system-bound arms), every `kind` switch and `systemId` fold — the sibling walk: `lib/engine/construction.ts`,
`construction-centre.ts`, `construction-readout.ts`, `directed-build.ts`, `lib/tick/processors/directed-build.ts`
(landing loop gains a lane arm → `applyLaneLevelIncreases`), `lib/tick/world/directed-build-world.ts`
+ adapter, `lib/runtime/snapshot.ts`, `lib/services/{alerts,build-options,colony-eligibility,
construction-orders,construction,ownership-map,tracker}.ts`, `lib/types/api.ts`, `lib/tick-harness/{build-analysis,
conservation-analysis}.ts` (`CharterProjectRow`/`StagedProjectRow` unions), `lib/world/tick.ts`
(`dropAbandonedBuildProjects` → drops a lane project when either endpoint is abandoned),
`components/construction/{colony-section,construction-row}.tsx`, `components/system/{industry-ghosts.ts,
industry-panel.tsx}`, `components/tracker/{tracker-panel,tracker-row}.tsx`, tests — the 22 non-test
files that switch on `kind` today (grep-walked; `tsc` finds the exhaustive ones, the text grep the
defaulted ones).
Interface: `WorldLaneUpgradeProject extends WorldConstructionProjectBase { kind: "lane_upgrade";
laneKey: string; levels: number }` with `workTotal = levels × UPGRADE_WORK_PER_LEVEL`; funding lands
whole levels onto `WorldLane.level` through `fundQueueWithFloor`'s existing landing path;
`queuedLaneLevels(openProjects): ReadonlyMap<laneKey, number>` beside `queuedBuildLevelsBySystem`.
Proves: a funded lane project lands a level on the lane row and shrinks its own remaining levels; an
abandonment at either endpoint drops the open lane project and refunds nothing (matching build
projects); per-system folds ignore lane projects rather than throwing on a missing `systemId`
(tsc — the base no longer has one); the construction readout counts a lane project's work in the
faction's queue; the conservation charter census still narrows `kind` correctly with a third arm.
Consumes: Task 1, Task 6.

### Task 8 — Planner lane-upgrade opportunity and AI claiming changes

Files: `lib/engine/directed-build.ts` (`planLaneUpgradeProposals`, `Proposal` union arm),
`lib/engine/construction.ts` (`orderProposals` and its housing/survival tiebreaks tolerate the arm),
`lib/tick/processors/directed-build.ts` (proposal expansion; `skipLanes` gate for the player faction),
`lib/world/tick.ts` (`claimProvider` becomes adjacency-bounded: `h === 1`), `lib/engine/expansion.ts`
(`proposeFactionClaims` floor no longer excludes zero-substrate — `SCORE_FLOOR` reduced to 0 or
removed, docstring rewritten), `lib/constants/expansion.ts` (`REACH_JUMPS` → 1 with its docstring;
`SCORE_FLOOR`), tests (`directed-build`, `expansion`).
Interface: `LaneUpgradeProposal { kind: "lane_upgrade"; factionId; laneKey; levels: 1; value:
number; work: number }` — `value` is the lane's `blockedVolume` from the last run, `work` is
`UPGRADE_WORK_PER_LEVEL`; proposed only where `laneInvestor(lane) === factionId`, `blockedVolume > 0`,
and no open `lane_upgrade` project names the lane; effective level (built + queued) is what the
capacity read scores against. Rides `orderProposals` and the shared pool unchanged.
Proves: a congested lane with an open upgrade project generates no second proposal; a lane the
faction cannot invest in is never proposed however congested; a lane with zero blocked volume is
never proposed; the proposal competes on ROI (a housing proposal still leads it — the existing
housing-first order holds); AI candidates are exactly the unclaimed systems one lane from owned
territory, and a barren adjacent system is claimable last; the player faction with `automation.lanes`
off gets no lane proposals while other factions still do.
Consumes: Task 1, Task 5 (`blockedVolume`), Task 7.

### Task 9 — Player verbs: invest, claim, lanes automation

Files: `lib/services/construction-orders.ts` (`orderLaneUpgrade`; `cancelOrder` lane arm;
`setAutomation` gains `lanes` and spreads the existing object), `lib/services/claims.ts` (new —
`claimSystem`), `lib/schemas/construction-orders.ts` (`orderLaneUpgradeSchema`, `automationSchema`
+ `lanes`), `lib/schemas/claims.ts` (new), `client/worker/game-worker.ts` (`GameCommandMap` entries,
`Engine` members, `runCommand` cases), `lib/hooks/use-construction-orders.ts` (`useOrderLaneUpgrade`),
`lib/hooks/use-claims.ts` (new), `lib/world/types.ts` (`world.player.lastClaimTick`; `automation.lanes`),
`lib/types/api.ts:368`, `lib/world/gen.ts:242`, `lib/services/construction.ts` (automation read),
tests.
Interface: `orderLaneUpgrade({ laneKey, levels }): OrderLaneUpgradeResult` — refused unless the
player is the lane's investor, batching onto a standing player row like `orderBuild`;
`claimSystem({ systemId }): ClaimSystemResult` — refused unless unclaimed, adjacent to owned
territory, and `currentTick − lastClaimTick ≥ PLAYER_CLAIM_COOLDOWN × cycle`; sets `controlled`.
`setAutomation({ build, colonisation, lanes })`.
Proves: an invest order on a lane with a foreign or unclaimed endpoint is refused naming the reason;
a second claim inside the cooldown is refused, one after it succeeds; a claim on a non-adjacent
system is refused; toggling `build` leaves `lanes` untouched (the spread fix — the rebuild-from-scratch
is the red arm); a repeated invest order extends the standing row rather than opening a second.
Consumes: Task 1 (`laneInvestor`), Task 7.

### Task 10 — `stockChange` over the whole cycle

Files: `lib/world/tick.ts` (`:1377-1386` snapshot and `:1906-1916` write; the `stockAtCycleStart`
snapshot replaced by a persisted per-market baseline written at the end of every boundary tick),
`lib/world/types.ts` (`WorldMarket.stockAtLastBoundary`; the `stockChange` docstring `:539-548`), the
abandonment clear (`resetAbandonedMarkets`, `lib/world/tick.ts:1005-1018`), `lib/services/alerts.ts` (docstring only),
`docs/active/gameplay/alert-bar.md`, tests (`tick` alert fields).
Interface: `stockChange = (stock − stockAtLastBoundary) / catchUp`, computed on the boundary tick
after every stage has run, then the baseline is rewritten from the current stock. First boundary
after load: field absent ⇒ no `stockChange` written (the existing "absent, not zero" convention).
Proves: a delivery landing mid-cycle appears in the next boundary's `stockChange`; a system with no
change reads 0, not absent; the first boundary after a fresh load reports nothing; an abandoned
system's baseline is cleared with its `stockChange`; two consecutive boundaries with the same net
movement report the same figure (the window is one cycle, not two).
Consumes: Task 3 (mid-cycle arrivals exist).

### Task 11 — Harness: lane metrics, fifth identity, arms, wall-clock, alert census

Files: `lib/tick-harness/lane-analysis.ts` (new), `lib/tick-harness/market-analysis.ts` (spell
distribution promoted from `temp/lane-premise-diag.ts`), `lib/tick-harness/conservation-analysis.ts`
(fifth identity), `lib/tick-harness/types.ts` (`HarnessResults` fields; `HarnessConfig.freightSpeed`,
`.laneTraversal`), `lib/tick-harness/runner.ts` (collectors, registration), `lib/tick-harness/experiment.ts`
(schema + comparison fields), `lib/tick/types.ts` (`TickInstrumentation.stageMs`, `logisticsDispatched`,
`goodsArrivals`), `lib/world/tick.ts` (opts threading; timing around the two stages),
`scripts/simulate.ts` (report blocks), `lib/tick-harness/__tests__/harness-results-fixture.ts`,
`lib/engine/survival-stock.ts` (new — the cycles-to-empty rule extracted from `alerts.ts:420-421`
so the service and the harness read one function), tests.
Interface: `summariseLanes(...)` → `{ utilisation: { p50, p90, max, saturatedShare }, topDecileShare,
inTransitVolume: { mean, max }, blockedVolume: { total, topLanes }, queuedVsRealised, foreignTransitShare,
contentionShortfallByFaction, overshootVolume, budgetSkipped, survivalStockFalling: { count, share } }`;
spell distribution `{ median, singleRunShare, p90 }` on physical stock, equilibrium window; identity
"Σ dispatch debits = Σ arrival credits + in-flight + returned" with the left side from the logistics
processor's own dispatch record and the right from the arrivals stage's credits plus the end-ledger;
`stageMs.directedLogistics` / `.goodsArrivals` medians and share of tick. Arms: `freightSpeed`
(overrides `LANES.FREIGHT_SPEED`), `laneTraversal: "tier" | "factionBlind"`.
Proves: the identity fails when the ledger drain is broken (red-proof named in the spec); a
zero-flow world reports zeros never NaN; the trafficked cohort is a subset of all lanes; the
faction-blind arm opens strictly more edges than the tier arm on the fixture; the fixture-typed field
fails the build if unregistered; `stageMs` is absent from every state frame (calibration-only).
Consumes: Tasks 2–6, 8, 10.

### Gate B — Mechanics calibration and owner acceptance (both horizons, seeds 42/43, 600 + 10,000 systems)

Arms: live (tier traversability, proposed `FREIGHT_SPEED`), zero-latency (`freightSpeed` large),
faction-blind traversability, pre-change baseline (the `shared/logistics-lanes` head, from git).
Reads: every Task-11 metric; funding-bound count and `budgetSkipped` against baseline (the C3
gates); spell median / single-run share / p90 and overshoot volume, latency arm vs zero-latency arm
(the oscillation gate); "Survival stock falling" count before/after Task 10; logistics share of tick
against the spec's baseline (9.0–13.3 ms / 7.2–8.6% at 600; 17.6 ms / 2.2% at 10,000) — a rise past
~3× the share blocks; conservation identities; coarse health bar; contention shortfall per faction
(first-mover read); queued-vs-realised (overshoot-then-decay).
Merge condition: no identity fails; funding-bound census and skipped-deficit count not materially up
(else `GENERATION_PER_POP` is retuned here, not the mechanic); oscillation gate holds or the owner
chooses the zero-latency setting (one constant); the wall-clock line holds; the owner picks the
shipped `FREIGHT_SPEED`, `BASE_LANE_CAPACITY` and traversability arm by reading. **Bookings that
live here:** the multi-cycle smoothing window for the survival alert (owner, 2026-09-03: "depends
how long the travel time is") is decided from the alert census at the shipped speed; a route
dictionary / per-source cache is booked only if the wall-clock line fails; the fuel-spread revisit
retired at Gate A ("revisit fuel spread when lane mechanics ship") is read here — lane utilisation
dispersion is the differentiator the map-gen gate deferred to.

### Gate C — Surface prototype

Arms: one browser-viewable HTML prototype of the Net-new UI list (below): lane selection and card,
the invest and claim verbs' enabled/disabled states, the restyled lane layer (level → weight, load
→ colour, in-flight → particles), the Logistics tab's in-transit rows, the third automation switch.
Reads: owner review by eye.
Merge condition: prototype approved (AGENTS UI rule) before Task 12 starts; the lane-card surface
decision (route-docked panel vs map popover — recommendation in Net-new UI) taken.

### Task 12 — Map: lane state slice, lane layer restyle, lane selection, chord overlay retired

Files: `lib/services/lanes.ts` (new — `getLaneStates`), `lib/runtime/snapshot.ts` (`lanes` slice),
`lib/types/api.ts` (`LaneStateRow`, `TradeFlowEdgeInfo` re-keyed per lane), `lib/hooks/use-lanes.ts`
(new), `lib/hooks/empty-slices.ts`, `lib/hooks/use-map-data.ts` (`ConnectionData` joined with lane
state), `lib/services/trade-flow.ts` (`getTradeFlowEdges` reads in-flight per lane from the ledger's
`routeEdges`, not chords from flow rows), `lib/engine/trade-flow-edges.ts` (`buildFlowEdges` becomes
per-lane; delete if nothing remains), `components/map/pixi/objects/lane-style.ts` (level and load
inputs beside fuel), `components/map/pixi/layers/{connection-layer,trade-flow-layer}.ts`,
`components/map/pixi/lane-hit-test.ts` (new), `components/map/pixi/interactions.ts` (`onSelectLane`),
`components/map/star-map.tsx`, `client/routes.ts` + `lib/utils/route-hrefs.ts` (if the route
option is taken), `components/map/pixi/theme.ts`, `docs/active/engineering/map-rendering.md`, tests.
Reuse: `laneStyleForFuel` (read: pure, three tiers) extended rather than duplicated; `TradeFlowLayer`
particle machinery (read: `sync(systems, flowEdges)`) re-fed per lane; `findFactionAt` hit-test
pattern (read: cell-gated on zoom) as the shape for the lane hit-test; `useGameSlice` slice
convention (`use-trade-flow.ts`). New: `lane-hit-test.ts` — nothing fits because selection today is
Voronoi-cell only (`interactions.ts:113-118`) and a lane is a segment between cells.
Interface: `LaneStateRow { key; aId; bId; level; capacity; bookedLoad; blockedVolume; inFlight;
investorFactionId: string | null; openUpgradeLevels }`; `findLaneAt(point, lanes, systems,
tolerance): laneKey | null`; `TradeFlowEdgeInfo` gains `laneKey` and is one per lane per direction
with in-flight volume; the chord builder's per-pair grouping is gone.
Proves: a lane's drawn weight tracks its level and its colour tracks load/capacity (moved to a
node-tested helper — a style is not asserted in jsdom); clicking within tolerance of a lane selects
it and clicking inside a cell still selects the system (precedence stated: system cell wins when
the point is within the star's hover radius); an in-flight haul draws particles on every lane of its
route, not a chord between endpoints; the overlay reads zero edges when the ledger is empty; the
`lanes` slice is absent from a frame for a world without lanes (empty-slice fallback).
Consumes: Tasks 1, 3, 5, 7.

### Task 13 — Lane card, verbs, transit rows, automation switch, copy

Files: `components/panels/lane-panel.tsx` (new) or `components/map/lane-card.tsx` (new — per Gate C),
`components/construction/claim-section.tsx` (new), `components/panels/system-overview.tsx`
(`ClaimSection` beside `ColonySection`), `components/construction/faction-construction-card.tsx`
(third switch), `components/system/logistics-panel.tsx` (in-transit rows), `lib/services/trade-flow.ts`
(`getSystemLogistics` gains `inbound`/`outbound` transit rows with `arrivalTick`), `lib/types/api.ts`,
`lib/glossary/terms.ts` + `docs/active/glossary.md` (lane level, lane capacity, in transit, congested,
blocked volume; `jumpLane` updated; the stale `crossingLane` entry — it still describes a
generator-marked class with its own line style, which #278 removed — corrected as part of this
change), `lib/constants/system-tabs.ts` if a badge is added, tests (`.test.tsx`).
Reuse: `DetailPanel` (read: `title, subtitle, headerAction, subHeader, backPath, scrollResetKey`),
`Card`, `StatRow`, `Button` (`variant="action"` as `ColonySection` uses it), `ConstructionRow` for the
open upgrade project, `TermLabel`/`Popover` for glossary terms, `formatDuration` for ETAs,
`EmptyState`. New: `ClaimSection` — nothing fits because `ColonySection` is gated on `controlled`
and the claim verb targets `unclaimed`; new: the lane card root (shape per Gate C).
Interface: `SystemLogisticsData` gains `transit: { inbound: TransitRow[]; outbound: TransitRow[] }`,
`TransitRow { goodId; goodName; quantity; otherSystemId; otherSystemName; arrivalTick }`; the lane
card reads `LaneStateRow` + the open project; verbs dispatch Task 9 commands.
Proves: the invest button is disabled with text naming the missing endpoint when the player does
not control both; an in-transit row disappears once its arrival tick passes; the claim button is
disabled during cooldown with the remaining time; the third switch toggles only `lanes`; every new
player-facing string is a glossary term or plain copy through `/game-copy`.
Consumes: Task 9, Task 12.

### Task 14 — Band cross-wiring guard (carried from map-gen)

Files: `lib/engine/__tests__/universe-gen-invariants.test.ts`, `lib/engine/universe-gen.ts` /
`density-field.ts` only if the test needs a provenance export that does not exist.
Interface: none new unless provenance must be exposed — then `CorridorPlan` waypoints carry their
pair index and `generateConnections` returns the band lanes keyed by pair.
Proves: on a fixture with two band corridors running geometrically close, every waypoint lane joins
consecutive waypoints of the same pair's chain; a deliberately cross-wired waypoint fails the
assertion (the red-proof the map-gen plan asked for); the repair-lane count is not the instrument.
Consumes: nothing.

### Task 15 — Doc fold and roadmap

Files: `docs/active/gameplay/logistics-lanes.md` (new, from spec §1–4, §6–8, present tense),
`docs/active/gameplay/universe.md` (any §5 residue not already folded), `docs/SPEC.md` (Active
Systems entry; interaction map: Goods Arrivals node, DL → ledger → arrivals → EC edges, lane upkeep
→ treasury, planner lane proposals), `docs/active/gameplay/economy-autonomic-agency.md` (matching
engine, silent application → scheduled), `docs/active/gameplay/trade-simulation.md` (Map Overlay,
Logistics Tab), `docs/active/gameplay/alert-bar.md` (Survival stock falling measure),
`docs/active/gameplay/player-seat.md` (lanes automation, claim and invest verbs),
`docs/active/gameplay/player-seat-purse.md` (lane upkeep line), `docs/active/gameplay/colonisation.md`
(drop rule), `docs/active/engineering/{processor-architecture,tick-engine}.md`, `docs/active/glossary.md`,
`docs/ROADMAP.md` (the logistics pass row loses what shipped and keeps its unbuilt leanings; the
map-gen "Next step" line goes), delete `docs/planned/logistics-lanes.md` and this working file, memory
pointer update.
Interface: none.
Proves: the doc-sync test's hand count matches; no active doc names a phase, plan or date; `git log
-S` shows each deferred item below reached its booking.
Consumes: everything.

### Verification

`npm run build`; `npx vitest run`; `npm run simulate` at both horizons quoted in each PR — the
mechanics PR quotes Gate B's arms; the surfaces PR quotes the live arm to show the mechanics did
not move. Sim metrics that must move: per-lane utilisation dispersion (lanes-off reads uniform 0),
in-transit volume > 0 at the shipped speed and 0 on the zero-latency arm, blocked volume > 0 on at
least one corridor at equilibrium, real top-decile share reported beside the Gate-A projection. Must
not move: funding-bound census, conservation identities, coarse health bar. `npm run duplication`
on the branch diff before review. Browser smoke on the lane card, claim verb, transit rows, and the
survival alert on a net importer.

### Doc fold

Task 15 above; runs on the branch before the final review of the last sub-PR. This working file is
deleted there.

### Not covered

- **War interdiction mechanics** — the query ships, nothing calls it. Booked: roadmap war row.
- **Negotiated transit rights (treaties, tolls, per-lane grants)** — booked: one line on the
  faction-direction design row (the relations input it needs).
- **Migration / colonist delivery / founding-manifest rehost onto the path engine** — booked: the
  logistics pass row already carries "unifying people-movement" and "hauling founding freight".
- **Deep-space crossing lane class (tech-gated)** — booked: one line on the logistics pass row at
  fold.
- **Alert-bar congestion category** — dropped by the spec ("revisit after play"); the map's blocked
  volume is the surface.
- **Multi-cycle survival-alert window** — booked at Gate B.
- **Route dictionary / per-source caching** — booked at Gate B (only if wall-clock fails).
- **Ship travel unified onto the path-summed formula** — dropped: the spec assigns it to the ship
  system's own surface pass.
- **`lanePruneFraction`** — stays internal (decided at #278); revisited only if Gate B shows lane
  density changing play.
- **Independents' match order** (`null` group last) and **return-leg rules** (uncapped credit, no
  flow row) — assumptions stated in Tasks 3 and 5; overturnable by the owner before Task 5 starts.
- **`REACH_JUMPS`** kept at 1 rather than deleted — the constant keeps its reader; the spec's
  "untouched" applies to the hop-cap cleanup, not to claiming's reach.

### Net-new UI

- **Lane card surface** — decision for Gate C. Recommendation: a route-docked panel
  (`/lane/:key`, `components/panels/lane-panel.tsx`) like the system and faction panels, because
  the card carries a verb, an open project row and a cancel, which the detail-panel conventions
  already handle; a map popover is the lighter alternative if the owner wants the card to feel
  ephemeral.
- **Lane hit-test** (`lane-hit-test.ts`) — segment selection on the Pixi stage.
- **Lane layer restyle** — level → weight, load → colour, in-flight → particles on the lane itself;
  the chord overlay goes.
- **`ClaimSection`** on the system overview for an unclaimed adjacent system.
- **In-transit rows** on the Logistics tab.
- **Third automation switch** on the faction construction card.

---

## Spec

Written 2026-08-31 from the evidence below plus the session's settled decisions:
**`docs/planned/logistics-lanes.md`** — its own planned doc because the feature is multi-PR (the
map-generation rework is its own sub-project) and this file is already the length of a spec.
Next gate: `/spec-review` (cross-mechanic surface — logistics + build planner + gen + treasury).

## Idea

### Problem

Goods movement is invisible and decisionless. Space should make lanes scarce and governed — mass
traffic between two stars runs down essentially one corridor, like controlled airspace — but today
the player neither invests in lanes nor feels them, and cutting one means nothing. Routing between
systems does not exist in the simulation: a haul is a direct donor→deficit stock delta with route
cost = hop count × weight capped at 4 hops (`lib/world/tick.ts:1625-1627`,
`lib/constants/directed-logistics.ts:95`); no path is traversed, no edge is billed, and the
overlay's "routes" are stitched from the flow log for display only. Edge `fuelCost` is read by
migration attenuation only, never by goods.

### Chosen direction

**Lanes as first-class per-edge objects, one shared routing substrate, capacity from investable
infrastructure, scheduled virtual transit.**

- A jump lane becomes a persistent object carrying invested infrastructure → capacity. The player
  (and the autonomic planner, symmetrically) invests in lanes; routes form themselves — the player
  never authors a route.
- Every haul routes over an actual cheapest path and bills capacity on each edge it crosses; a
  saturated edge throttles or reroutes. Chokepoints, congestion and severing fall out of the graph.
- One path engine serves every mover — goods now; migration, colonist delivery and founding-manifest
  staging can be rehosted onto it.
- **Transit is scheduled, never positionally simulated**: dispatch computes arrival tick from route
  time; a pending-arrivals ledger applies the delta at arrival. Interdiction (war, environmental
  events) resolves lazily — query which scheduled flows cross the affected edge in the affected
  window. Nothing per-tick moves.
- Severed lanes are the war system's future strategic verb; this pass builds the substrate hook,
  not the war mechanics.
- **Map generation is a coupled lever, not a fixed given.** Star distribution need not be an even
  spread — clusters, corridors and voids are on the table precisely to give lane mechanics
  geography worth investing in. Whether the map-gen rework rides in this pass is decided by the
  flow-concentration measure below.

### Killed alternatives

- **Player-authored route objects (Anno-style)** — Vicky3 shipped manual routes 2022, deleted them
  1.9/2025 as decisionless clerical work; owner: "C is definitely out… we decide where to invest and
  which systems need the increased load most."
- **Positional transit simulation (per-tick ship movement)** — cost scales with traffic, and the
  information it produces (where exactly a shipment is) matters only when something interdicts it;
  the lazy query answers that on demand.
- **Bandwidth-only, no transit time (pure Vicky3 market-access)** — subsumed: the scheduled-arrival
  ledger delivers latency at negligible cost, and pure bandwidth loses the in-transit loss hook war
  needs.

### Premises

**Checkable** (→ `/measure`, step-1 form):

1. **Flow concentrates.** At equilibrium (10,000 ticks, default 600 systems), projecting the flow
   log's hauls onto shortest paths over the open-edge graph, the top decile of trafficked
   intra-faction edges carries ≥ 40% of edge-crossing haul volume.
2. **Routing workload is boundable.** Per logistics run at equilibrium, transfers and distinct
   donor→deficit pairs are small enough to path-find within budget — measure the actual counts and
   the current logistics processor's share of tick wall-clock at 600 and 10K systems.
3. **Correction is already slow relative to transit.** Median ticks from a system entering a
   survival-good deficit to recovery at equilibrium is ≥ one `LOGISTICS_INTERVAL` — i.e. a few
   ticks of scheduled transit latency is small against today's real correction time.
4. **Edge cost varies.** The intra-faction edge `fuelCost` distribution has real spread
   (p90/p10 ≥ 2) — else all lane differentiation must come from invested infrastructure alone.
5. **Long chains exist to serve.** Goods already effectively traverse > MAX_HOPS via relay through
   intermediate markets (visible in the flow log as stitched same-good chains) — the demand for
   real multi-hop routing is present, not hypothetical.

**Definitional** (owner decisions, quoted):

- Player invests, never routes: "the player doesnt set the routes, but they invest in routes which
  need more capacity" / "we decide where to invest and which systems need the increased load most."
- Lanes are shared objects: "whatever system we use here for the routing, should be able to be
  hijacked for other systems too" / "Treating the lanes as their own objects … is important for
  many other things."
- Virtual transit: "we dont update the transit location as we go along, we just check which ships
  should be in transit on that route at that tick if something happens on that route."
- War hook: "cutting off resources becomes a real strategic move in the war system."
- The player challenge is allocation: "balancing the different systems and having to make hard
  decisions about what to spend money or invest in."

**Hypotheses** (carried forward, labelled):

- The generated jump-lane graph is sparse enough at cuts (gateways) that capacity investment is a
  choice, not a uniform upgrade everywhere. *(hypothesis — premise 1 measures the flow side; the
  graph-structural side stays open until measured)*
- Scheduled-transit latency at realistic travel times does not destabilise the equilibrium (no
  shortage-response oscillation). *(hypothesis — not cheaply checkable before a prototype)*
- A route dictionary keyed on (faction, source, destination), invalidated on topology/ownership
  change, keeps pathfinding affordable at 10K systems. *(engineering hypothesis)*

### Decision rule (owner-reframed: the measure diagnoses, it does not veto)

The direction is a design commitment, not a hypothesis under test. Owner (2026-08-31): "I'm not
keen on shaping our mechanics based on a measure, if the measure is off then we need to think of
way to fix that because we've chosen the mechanics we think will make it fun."

The measurement stays, with its consequence redirected: at equilibrium (10,000 ticks, default
600-system galaxy), project every directed-logistics haul in the flow window onto its shortest
open-edge path.

- **If the top 10% of trafficked intra-faction edges carry ≥ 40% of edge-crossing haul volume**, the
  current topology already concentrates flow — lane mechanics land on the map as generated, and the
  map-gen rework (clustered/uneven star distribution) can follow as its own pass.
- **If below**, the map is too uniform for chokepoints — the map-generation rework (clusters,
  corridors, voids) becomes a co-requisite of this pass, so geography supplies the structure the
  even spread lacks. The lane mechanics are unchanged either way.

## Premises 2–5 — falsifiers (committed before measurement)

Same diagnostic posture as premise 1: a falsified premise redirects the spec, it never kills the
chosen mechanics.

- **Premise 2 (routing workload).** The raw counts (per-run transfers, distinct donor→deficit
  pairs, route-cost evaluations, and the logistics processor's wall-clock share) are *descriptive,
  no kill-line*. The one kill-line: **if measured per-run distinct haul sources × a measured
  single-source BFS over the largest faction's open-edge subgraph projects to more than the
  current directed-logistics run's own wall-clock** (real pathfinding would at least double the
  processor), the workload premise is falsified and the route dictionary is promoted from
  engineering hypothesis to spec requirement.
- **Premise 3 (correction already slow).** Measured as consecutive-logistics-run deficit spells per
  (system, survival good) using `classifyMarketState` where the matcher reads it: **if the median
  spell is a single run (deficit cleared by the next run, i.e. correction ≤ one
  `LOGISTICS_INTERVAL` = 24 ticks) at both the 10K and 16K horizons**, the premise is falsified —
  scheduled-transit latency is then a real addition to correction time, and the oscillation
  hazard gets first-class treatment in the spec instead of a "small against today" waiver.
- **Premise 4 (edge cost varies).** **If intra-faction edge `fuelCost` p90/p10 < 2 on both seeds at
  equilibrium**, falsified — existing edge costs cannot differentiate lanes, and all lane
  differentiation must come from invested infrastructure plus map-gen geography.
- **Premise 5 (long chains exist).** **If under 5% of edge-crossing haul volume in the equilibrium
  flow window departs a donor that itself received the same good within the window** (re-export
  stitching), relays are rare and the premise is falsified — routing beyond `MAX_HOPS` serves
  demand that does not yet exist and the spec must not lean on it. The premise-1 hop-histogram
  cliff at `MAX_HOPS` shows the cap *binds*; it does not show relaying, so it cannot confirm this
  premise on its own.

## Evidence

### Unreachable-haul share rise under the neighbourhood-graph rework (claim + falsifier committed 2026-09-02, pre-measurement)

Question: post-rework the geography instrument reads unreachable-haul volume share 12.3% at 10K
(pre-rework 4.5%). Real degradation, or an artefact of how the projection models routing?

Code read (pre-measurement): the shipped router is ownership-blind — `computeBoundedHopDistances`
(lib/engine/pathfinding, called at lib/world/tick.ts:1608) BFSes over ALL connections with only a
hop cap; the projection (lib/tick-harness/geography-analysis.ts:115-142) restricts adjacency to
the hauling faction's own + unclaimed systems, read off FINAL-tick ownership. So a haul is counted
"unreachable" when its endpoints have no own+unclaimed lane path at end-state, even though the
shipped matcher actually placed it through foreign-held systems.

Claim: the 12.3% is entirely foreign-space blocking under the projection's own+unclaimed
adjacency (plus any unclaimed-donor hauls) — every "unreachable" haul has a lane path under full
ownership-blind adjacency, so no haul volume is genuinely lane-disconnected; the rise vs 4.5%
reflects the sparser RNG lane graph offering fewer redundant own-space detours, not lost cargo.

Falsifier: if, at either horizon, more than 1% of TOTAL haul volume is unroutable even under full
(ownership-blind, hop-unbounded) adjacency, the claim is false — the rework genuinely
disconnected hauls and the reading is real degradation, back to design.

Measured 2026-09-02 (instrument: temporary classification inside computeGeographyProjection —
each unreachable haul retried under full unfiltered adjacency; identity check classes-sum ==
unreachable counter; reverted same session, grep clean):

```
Meaning:  No cargo is lost or lane-disconnected. Every "unreachable" haul was placed by the
          shipped ownership-blind router through foreign-held systems; the metric counts the gap
          between the instrument's foreign-space-closed model and the router the game actually
          runs, and the sparser lane graph widens that gap by removing redundant own-space detours.
Claim:    The 12.3% unreachable-haul share is entirely foreign-space blocking under the
          projection's own+unclaimed adjacency; nothing is unroutable under full adjacency.
Number:   10K, seed defaults: flows=43493, unreachable=5137 hauls / 697,707.7 volume (12.3%
          share); classification: foreignBlocked=5137/697707.7, trulyUnreachable=0/0.0,
          donorUnclaimed=0/0.0; identity OK (classes sum == counter). Falsifier line (>1%
          truly-unroutable) reads 0.0%.
Horizon:  1000t: zero flow events (pre-founding — projection early-returns empty; report reads
          unreachable 0 / share 0.000). 10,000t: the reading above. Both quoted.
Cohort:   All directed-logistics flow events in the trailing FLOW_HISTORY_TICKS window at run
          end, classified per haul; ownership read off final-tick systems (same as the metric).
Licenses: Supports: the 4.5%→12.3% rise is not degradation — no haul volume became unroutable;
          goods moved. Supports: the shipped router routes ~12% of haul volume through foreign
          space at equilibrium — a real divergence between spec §2's "foreign space is closed"
          and the ownership-blind hop-BFS, amplified by the sparser RNG graph; that is lane-
          sub-project material (interdiction surface), not a map-gen defect. Does NOT support:
          any claim about pre-rework composition (4.5% was not re-classified); any claim that
          12.3% is stable across seeds (one seed measured).

Raw (report + diag, verbatim):
  1000t block:  Unreachable hauls 0 · Unreachable haul volume 0 · Unreachable volume share 0.000
  10K block:    Unreachable hauls 5137 · Unreachable haul volume 697.7K · share 0.123
  DIAG-UNREACH flows=43493 unreachN=5137 classSumN=5137 identity=OK donorUnclaimed=0/0.0
  foreignBlocked=5137/697707.7 trulyUnreachable=0/0.0
```

Follow-up (owner-directed, same day): the instrument was aligned to the shipped router so the
divergence cannot recur — reachability is now ownership-blind with the router's own MAX_HOPS cut,
and foreign transit is its own metric. Post-alignment simulate (defaults, 10K): unreachable 0/0
both horizons, foreign-transit share 0.178 of placed volume, top-decile concentration 0.365
(above the ≥0.35 acceptance line; the pre-alignment 0.339 was an artefact of foreign-space-closed
placement). The numbers above stay as measured under the OLD projection — they are the record of
the divergence, not current readings.

### Premise 1 — flow concentration (measured 2026-08-31)

```
Meaning:  Logistics flow spreads broadly over each faction's lane graph — the busiest tenth of
          lanes carries about three times its uniform share, far short of dominant corridors, and
          no small edge set carries the galaxy's freight. A few individual factions do read
          concentrated (0.43-0.49), so chokepoints exist locally, not structurally.
Claim:    At equilibrium-horizon, projecting the flow log's hauls onto shortest open-edge paths,
          the top decile of trafficked intra-faction edges carries ≥ 40% of edge-crossing volume.
Number:   Top-decile share (even-split projection): 0.317 (seed 42, 10K), 0.328 (seed 43, 10K),
          0.296 (seed 42, 16K). Deterministic-path projection within 2 points of even-split on
          every run — tie-breaking is not hiding concentration. Top-10-edges absolute share only
          0.10-0.15. Per-faction top-decile ranges 0.26-0.49; above 0.40 in 2 of 6 (s42 10K),
          2 of 5 (s43 10K), 2 of 8 (s42 16K) factions with ≥20 trafficked edges.
Horizon:  1000t: zero flow events (pre-founding — 20 seeded homeworlds, no intra-faction edges;
          validated against the known first-establish ~t=4128). 10,000t: both seeds. 16,000t:
          trajectory check — share drifts DOWN (0.317 → 0.296) as the galaxy develops (188 → 212
          developed), so maturation spreads flow further; the reading is not a transient low.
Cohort:   All directed-logistics hauls in the trailing FLOW_HISTORY_TICKS=200 window (~8 logistics
          runs, 2371-3001 events), projected onto the end-state open-edge graph; per-faction rows
          gated at ≥20 trafficked edges.
Licenses: Supports: the current even-spread topology does not concentrate flow to the 40% line at
          any measured horizon or seed. Does NOT support: "no chokepoints exist" (per-faction highs
          0.43-0.49); any mature-galaxy claim (~31-35% of systems developed even at 16K — founding
          era per measurement-traps). Instrument noise: 3.6-8.6% of hauls project unreachable or
          >MAX_HOPS because ownership at snapshot differs from ownership at haul time
          (abandonment); conserved-volume validation passed exactly on all runs.
Raw:      temp/lane-flow-10k-s42.json, temp/lane-flow-10k-s43.json, temp/lane-flow-16k-s42.json
          (temp/lane-flow-diag.ts; headline rows inline below)
            s42 10K  split topDecile 0.3171  det 0.3011  edges 339  hauls 2739  unreachable 99
            s43 10K  split topDecile 0.3280  det 0.3241  edges 277  hauls 2371  unreachable 203
            s42 16K  split topDecile 0.2964  det 0.2866  edges 394  hauls 3001  unreachable 126
```

**Outcome: falsified — the decision rule's second arm fires.** The map as generated is too uniform
for lane capacity to bite; the map-generation rework (clustered stars, corridors, voids) joins this
pass as a co-requisite. Side observation for premise 5: the hop histogram is roughly uniform across
1-4 hops then cliffs at 5 — `MAX_HOPS` visibly binds; ~45% of hauls already run 3-4 hops.

*Correction (2026-08-31, premises 2-5 instrument):* the 1000t parenthetical above overstated —
intra-faction edges DO exist at 1000t (the claim wave finishes by ~t=700, freezing the faction
partition; 702 same-faction edges on s42). What is absent pre-founding is developed-to-developed
flow: zero flow events stands.

### Premises 2–5 (measured 2026-08-31)

Instrument: `temp/lane-premise-diag.ts` + two temporary measuring patches (directed-logistics block
timing + routeCost call counter in `lib/world/tick.ts`; per-run deficit/transfer census via
`classifyMarketState` at the matcher call site in `lib/tick/processors/directed-logistics.ts`),
both reverted after the runs. Validation: with hooks installed, s42/600/10K reproduced premise 1's
run exactly (developed 188, flowEvents 2739) — the instrument does not perturb the world; and on
every run the hook's transfer count over the flow window equals the flow log exactly
(single-writer cross-check). Startup horizon: structurally empty for all flow-derived metrics
(zero flow events at 1000t, validated premise 1). Equilibrium windows: run stats over ticks ≥ 60%
of horizon. Raw: `temp/lane-premise-600-s42-t10000.json`, `…-600-s43-t10000.json`,
`…-600-s42-t16000.json`, `…-10000-s42-t10000.json`, `…-600-s42-t1000.json`.

#### Premise 2 — routing workload is boundable

```
Meaning:  Real cheapest-path routing is comfortably affordable at current traffic on both galaxy
          sizes — per-run haul-source counts are around a hundred, a single-source BFS over the
          largest faction's lane graph is microseconds, and the projected pathfinding bill is a
          small fraction of what the logistics run already spends building its own state.
Claim:    Per logistics run at equilibrium, transfers and distinct donor→deficit pairs are small
          enough to path-find within budget.
Number:   600 systems (s42 10K / s43 10K / s42 16K), per-run medians: transfers 236/229/359;
          distinct pairs 133/132/249; distinct haul sources 81/80/130; routeCost calls 355/336/690;
          deficit rows 1874/1799/2271; surplus rows 304/306/537. Logistics run wall-clock median
          9.0/9.2/13.3 ms; logistics share of total tick wall-clock (equilibrium) 7.3%/7.2%/8.6%.
          Largest faction subgraph 35-38 nodes; BFS ≈ 0.006 ms → projected per-run pathfinding
          0.50-0.81 ms = 5.4-6.1% of the run's own current cost. 10,000-system galaxy (s42 10K):
          transfers 400, pairs 211, sources 123, routeCost calls 578; run 17.6 ms; share 2.2%;
          largest faction 407 nodes, BFS 0.027 ms → projected 3.3 ms = 19% of the run's cost.
Horizon:  1000t structurally empty (no flow); 10,000t both seeds; 16,000t trajectory: counts grow
          roughly with developed-system count (transfers 236 → 359 as developed 188 → 212), so the
          workload tracks development, not galaxy size.
Cohort:   Equilibrium-window logistics runs (167 runs at 10K, 250 at 16K), all factions; census
          taken where the matcher reads its state.
Licenses: Supports: per-haul shortest-path routing with per-source path caching fits today's tick
          budget at 600 and 10,000 systems — the committed kill-line (projected pathfind > the
          run's own wall-clock) fires nowhere (worst ratio 0.19). Does NOT support: the cost of
          per-edge capacity accounting or congestion-aware re-routing (not modeled); workload
          after lanes remove MAX_HOPS (reach grows, sources see more candidates); a mature-galaxy
          claim (both sizes still founding-era — 403/10,000 developed at the large size).
Outcome:  CONFIRMED (kill-line clear by >5×; the route-dictionary hypothesis stays an
          optimisation, not a requirement).
```

#### Premise 3 — correction is already slow relative to transit

```
Meaning:  The typical survival-good deficit is corrected within a single logistics interval — the
          median spell is one run at every seed and horizon — so a few ticks of scheduled transit
          latency would be a material addition to the typical correction, not a rounding error on
          an already-slow one. A heavy tail of chronic deficits (weeks-long spells) coexists with
          the fast median.
Claim:    Median ticks from a system entering a survival-good deficit to recovery at equilibrium
          ≥ one LOGISTICS_INTERVAL (24 ticks).
Number:   Median spell = 1 run (i.e. cleared by the next run, correction ≤ 24 ticks) on every run:
          single-run share 77.0% (s42 10K, n=1080), 75.5% (s43 10K, n=661), 85.3% (s42 16K,
          n=681), 82.1% (10K-system, n=3511). p90 = 2-3 runs; max 33-158 runs (chronic tail).
Horizon:  10,000t (both seeds) and 16,000t — falsified at both; 1000t structurally empty (no
          survival deficits recorded among the 20 self-sufficient homeworld prefabs).
Cohort:   (developed system, water|food) deficit spells classified by classifyMarketState at each
          logistics run, spells starting inside the equilibrium window and completed before the
          end (censored spells 0-23 per run, excluded).
Licenses: Supports: typical correction is fast — the premise's "latency rides free" waiver is
          gone. Does NOT support: "all correction is fast" (the p90+ tail is runs-to-weeks long —
          the chronic/no-donor class); an exact sub-interval correction time (resolution is one
          run, so median 1 run means ≤ 24 ticks, not a point value). A system leaving the
          developed set mid-spell ends its spell (abandonment conflation, small share).
Outcome:  FALSIFIED — per the committed falsifier, scheduled-transit latency gets first-class
          oscillation-hazard treatment in the spec; the carried "latency does not destabilise"
          hypothesis is now live, not waivable.
```

#### Premise 4 — edge cost varies

```
Meaning:  Intra-faction jump-lane fuel costs are nearly uniform — the spread between cheap and
          expensive lanes is well under the committed 2× line on every seed and size — so the
          existing edge-cost field cannot differentiate lanes on its own.
Claim:    Intra-faction edge fuelCost p90/p10 ≥ 2 at equilibrium.
Number:   p90/p10 = 1.79 (s42, 702 edges), 1.87 (s43, 692 edges), 1.60 (10K-system galaxy,
          10,123 edges). p10/p50/p90 ≈ 7.1/8.5/12.7. Identical at 1000t/10K/16K on s42 — the
          faction partition freezes when the claim wave completes (~t=700), so the cohort is
          horizon-stable.
Horizon:  Both horizons read (identical by structure); equilibrium quoted.
Cohort:   Undirected same-faction edges at end-state, all control states (claimed fringe
          included).
Licenses: Supports: lane differentiation cannot come from existing fuelCost spread — invested
          infrastructure and map-gen geography must carry it (converges with premise 1's
          second-arm outcome). Does NOT support: fuelCost being meaningless (a 1.6-1.9× spread
          exists and migration already reads it); the trafficked-edge sub-cohort's spread was not
          measured separately.
Outcome:  FALSIFIED on both seeds.
```

#### Premise 5 — long chains exist to serve

```
Meaning:  Relay chains essentially do not exist — virtually no haul departs a system that itself
          received the same good in the window. MAX_HOPS binds (premise 1's hop cliff) and the
          demand beyond it is simply unserved, not served indirectly; the donor dead-band makes
          relaying structurally impossible (a deficit fills to ~32-40 cycles of cover but only
          donates above ~56), so multi-hop service can never emerge from warehouse stitching.
Claim:    Goods already effectively traverse > MAX_HOPS via relay through intermediate markets.
Number:   Re-export share of edge-crossing haul volume (donor received same good earlier in the
          window): 0.054% (s42 10K), 0.094% (s43 10K), 0.000% (s42 16K), 0.040% (10K-system) —
          two orders below the committed 5% line. Stitched chains whose origin out-reaches
          MAX_HOPS to the final destination: 0-4 events per window. Same-run re-export: 0 in all
          runs.
Horizon:  10,000t (both seeds) and 16,000t; 1000t structurally empty.
Cohort:   All hauls in the trailing FLOW_HISTORY_TICKS=200 window (~8 logistics runs,
          2371-4684 events) against arrivals in the same window.
Licenses: Supports: no current service beyond MAX_HOPS — the spec must treat >4-hop routing as a
          new capability serving latent demand, not a formalisation of existing behaviour. Does
          NOT support: "no demand beyond 4 hops" (the hop cliff and the unreachable/unservable
          residuals say the demand is there and unserved). Window-bounded: a relay slower than
          ~8 runs would be invisible — but the donor dead-band argument above rules that out
          structurally, not just observationally.
Outcome:  FALSIFIED — decisively.
```
