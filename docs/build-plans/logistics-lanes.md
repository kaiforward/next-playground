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
