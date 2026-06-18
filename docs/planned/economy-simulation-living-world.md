# Economy Simulation — Sub-Project 2: The Living World (Population Dynamics & Consequences)

Status: **Design locked** 2026-06-18; **Part 0 shipped** 2026-06-18 (de-region diffusion — faction-bounded topology + work-budget slicing; calibrated `DISTANCE_DECAY = 0.1`, `EDGES_PER_TICK = 256`). **Part 1 not started.** This is the sub-project spec for **Sub-Project 2** of the [Economy Simulation Vision](./economy-simulation-vision.md) (vision §13 item 2, "Demand & consequence loop"). It assumes the shipped SP1 model — physical substrate, population-scaled consumption, days-of-supply pricing — and does not re-argue it. The code-heavy build plan hangs off this spec in `docs/plans/` and is deleted when SP2 ships.

Read the [vision](./economy-simulation-vision.md) (§4 population keystone, §5 tick loop, §7 consequences, §10 rethinks) and [SP1 substrate spec](./economy-simulation-substrate.md) first.

---

## 1. What SP2 is

SP1 made the economy physically *driven* (production from bodies + labour, consumption from population) and self-*pricing* (days-of-supply), but **population is static** — a stored number that never moves. SP2 makes it move, and gives unmet need *teeth*. This is the vision's dial-2 payoff ("stakes of an unmet need: High"): a system that can't get what it needs now genuinely declines, strikes, and bleeds population, instead of merely showing an expensive price.

The loop SP2 delivers (vision §5.3, §7):

```
MEASURE     → per-good need-satisfaction = delivered / demanded   (signal)
ACCUMULATE  → unrest = integral of dissatisfaction               (property)
THRESHOLD   → high unrest ⇒ strike (production suppressed)        (state)
EFFECT      → population grows (fed+calm) / declines (starved/unstable)
              and migrates along jump lanes toward better systems
```

---

## 2. Decisions locked at the start of SP2

The forks left open by the vision are settled (brainstorm, 2026-06-18):

| Fork | Decision | Rationale |
|---|---|---|
| **Consequence scope** | **need-satisfaction, unrest, strikes, growth/decline, migration**; **rebellion deferred to SP5** | Five of the six consequences are self-contained in the economic + population substrate. Rebellion mutates faction control, which only has meaning once factions are live actors — that is the SP5 agency layer. Unrest still has teeth in SP2 via strikes + migration. |
| **Prosperity** | **Retired**, replaced by `unrest` | Prosperity was a trade-volume proxy for "people are happy → produce more." SP1 already moved that smooth supply response to `population` (`labourFactor`), so the proxy collapses into the real thing. Population is now the smooth health channel; unrest is the new property. |
| **Starvation sharpness** | **Convex, demand-weighted** (option B) | A famine must be catastrophic while a luxury gap is a shrug — *without* a hand-authored "importance" tier. The weight is the per-capita demand magnitude that already exists; convexity makes a deep/binding shortage dominate. See §6. |
| **Migration topology** | **De-region the diffusion engine first** (Part 0), then migrate on the unified topology | The region round-robin conflated *load-sharding* (necessary) with an *impermeable flow boundary* (an artifact). Gameplay rules must not be dictated by a performance mechanism. Region-bound migration would be throwaway; build on corrected bedrock. |
| **Flow boundary** | **Sovereign (faction) borders, hard-closed**; distance attenuates within | Real migration/trade is gated by sovereign borders and distance, not region membership. "Factions don't trade at all" in SP2; **relation-weighted borders deferred to SP5**. |
| **Faction viability** | **Accept** that some territories lack a viable resource mix | No generation guarantee, no autonomic floor — that is premature tuning. Self-resolves when SP5 opens inter-faction trade and lets territory move. Players are the intended escape valve for inter-faction shortages (deliberate holes). |
| **Population representation** | **`Int` → `Float`** | Growth/migration produce fractional per-tick deltas that round to zero on small systems as `Int`. Population is an abstract magnitude anyway; Float matches `popCap`/`demandRate` and sidesteps the int4-overflow ceiling. UI prettifies to millions/billions later. |
| **Calibration target** | **Stable-but-growing = avoid the extremes** | No total collapse, no instant saturation, no migration ping-pong. Localized boom/bust geography and isolated non-viable-faction decline are *success*. Coarse only — SP3–SP5 reshape too much to over-tune now. |

### 2.1 The guiding principle uncovered this session

**Gameplay rules and performance mechanisms are separate concerns.** The region boundary existed to bound per-tick DB work (the Postgres-30s ceiling at 10K scale), but it silently became a hard rule that goods cannot cross region edges. SP2 untangles them: *topology* answers "what can flow where" (gameplay), *sharding* answers "how much work per tick" (performance). The same edge set can be sharded for performance without being walled for gameplay.

---

## 3. SP2 decomposition (2 parts)

Bottom-up, each its own build plan → PR set (each part may be 2–3 PRs per the phase-PR convention).

| Part | Scope | Ships when |
|---|---|---|
| **Part 0 — De-region the diffusion engine** (§5) | Split sharding from topology. Goods diffuse over the full **intra-faction** jump-lane graph (region lines ignored), **distance-attenuated**, **faction borders hard-closed**; re-sharded by a work-budget slice. Recalibrated. | The corrected topology is verified for goods **before** population rides on it. |
| **Part 1 — The consequence loop + migration** (§4, §6–§9) | New `population` processor + `PopulationWorld`. need-satisfaction recording → `unrest` → strikes → growth/decline; migration on the unified topology. Prosperity retired; `demandRate` recomputed per tick. | The living world is on screen and calibrated stable-but-growing. |

**Why Part 0 lands alone.** It re-touches shipped, calibrated `trade-flow` code and carries the only real performance risk (re-sharding the full graph under the 10K Postgres ceiling). Landing it first — goods only, no population — lets us verify and recalibrate the new topology in isolation, and means goods and population share one map from the moment migration exists (avoiding the "people flee to a thriving neighbour but food can't follow → oscillation" failure mode).

---

## 4. The state model (taxonomy)

A system's population is described by three tiers over two anchors. This taxonomy is the backbone of the new processor and is **flexible by construction** — every deferred extension plugs into exactly one tier, additively.

| Tier | What it is | SP2 members | Storage | Extension slot (later) |
|---|---|---|---|---|
| **Magnitude** | the one number everything moves | `population` (**Float**) | column | — |
| **Ceiling** | the carrying-capacity bound | `popCap` (exists) | column | SP3: housing raises it |
| **Signals** | per-tick measurements, transient | need-satisfaction per good | computed, not persisted | amenity needs (health, entertainment); pollution exposure |
| **Properties** | slow, stored condition variables (integrals of signals) | `unrest` (**new**, 0…1) | column | amenity-satisfaction; blight load |
| **States / effects** | threshold-triggered regimes + what they do | strike; growth/decline; migration | derived per-tick (strike optionally stored for hysteresis) | rebellion; famine; boomtown |

**The spine:** `measure → accumulate → threshold → effect`. A new need channel is a term in *measure*; a new property is another *accumulate* column; a new state is another *threshold* consumer; a new consequence is another *effect* term. v1 ships one commodity need-channel and one strike state, expressed as **data-driven lists** so additions are entries, not new branches — no premature plugin framework.

**Ownership:** one new `population` processor + `PopulationWorld` interface, with prisma and memory adapters (matching the SP1 processor architecture). It depends on `economy` (it consumes the satisfaction signal the economy tick records).

**Prosperity is retired.** The `prosperity`/`tradeVolumeAccum` columns, the `PROSPERITY_PARAMS` constants, `updateProsperity`/`getProsperityMultiplier`, the prosperity multiplier in the economy tick, `lib/services/prosperity.ts`, `lib/utils/prosperity.ts`, and the prosperity map-choropleth layer + badges are removed or re-pointed. Population (live, via `labourFactor` + per-capita consumption) is the sole smooth health channel; the choropleth/badge UI re-points to an **unrest-derived stability** readout (same rendering pipeline, new source).

---

## 5. Part 0 — De-region the diffusion engine

> **Shipped 2026-06-18.** Faction-bounded topology + work-budget edge slicing landed on the shared branch (Phase A — structural refactor; Phase B — calibration + docs). Calibrated constants: `DISTANCE_DECAY = 0.1`, `EDGES_PER_TICK = 256` (a full sweep is 4 ticks at default scale, 46 at 10K — both inside the 200-tick prune window). A simulator sweep confirmed the targets hold (stocks in `[5,200]`, distance-graded dispersion on long-haul goods, greedy ≫ random) with no far-system starvation. The durable topology description now lives in [trade-simulation.md](../active/gameplay/trade-simulation.md); this section retains the design rationale.

**Goal.** Make goods diffusion flow over the topology it *should* have, with sharding as an independent, invisible performance concern.

- **Topology = the intra-faction sub-graph.** Goods diffuse along the full jump-lane graph **within a faction's territory**, ignoring region boundaries. Cross-faction edges are **closed** ("factions don't trade at all"). Independent systems (if the faction flood-fill leaves any `factionId = null`) form their own permeable pool among adjacent independents.
- **Distance attenuation.** The flow gradient decays per hop, so distant systems pull weakly. Gateways become low-friction long-haul **bridges** — migration and trade preferentially route through them, enriching the gateway role rather than competing with it.
- **Sharding = work-budget slices.** Process a fixed-size slice of the intra-faction edge set per tick (N edges/tick), **not** "one faction per tick" — faction territories vary too much in size to bound per-tick work. This preserves the Postgres-30s bound without an impermeable wall.
- **Recalibration.** Goods diffusion is re-validated in the simulator under the new topology: faction territories become semi-isolated trade blocs (intra-faction trade easy, inter-faction nil), so the equilibrium shifts. Targets unchanged (stocks in `[5,200]`, dispersion, greedy ≫ random).

**Accepted limitation:** a faction territory lacking a tier-0 resource (water/ore/arable) has no NPC import path and may be structurally stressed. This is tolerated (see §2 viability decision); it self-resolves in SP5.

---

## 6. Part 1a — Need-satisfaction → unrest

- **Signal (per system, per good):** `satisfaction_g = delivered_g / demanded_g`, where `demanded_g = perCapitaNeed(g) × population` and `delivered_g` is the consumption actually drawn from stock before it hit the floor. Measured inside the **economy processor** (the tick that performs the consumption clamp) and handed to the population processor.
- **Aggregate (per system):** demand-weighted, convex —

  ```
  D = Σ_g  demandShare_g · (1 − satisfaction_g)²
  ```

  where `demandShare_g = demanded_g / Σ demanded`. **Importance comes from the demand magnitude that already exists** (people need ~8× more food than luxuries), not a separate field. Convexity makes a *deep* shortage dominate many shallow ones, so a famine bites and broad mild tightness is forgiven.

  **Worked example — why a famine is catastrophic but a luxury gap is a shrug.** The two levers are orthogonal: *demand-weighting* decides **which** good matters (food's deficit counts ~8× a luxury's, because people need ~8× more of it); *convexity* decides **how deep** a shortage has to be to hurt. A bare ratio (`delivered/demanded`) is scale-free — 0% food and 0% luxuries look identical alone — so the weight is what distinguishes them, and it is simply the per-capita demand, not a new "importance" knob. Using illustrative demand shares (food ≈ 18 %, luxuries ≈ 2 % of weighted demand):

  | Scenario | `D` this tick | Why |
  |---|---|---|
  | **Food fully cut**, rest met | `0.18 · 1² = 0.18` | high weight × deep deficit → spikes |
  | **Luxuries fully cut**, rest met | `0.02 · 1² = 0.02` | tiny weight → ~9× smaller, a shrug |
  | **Everything at 90 %** (broad, shallow) | `Σ w · 0.1² ≈ 0.01` | convexity forgives spread tightness |

  So a famine produces ~9× the dissatisfaction of a luxury outage **from the demand weight alone**, and convexity ensures a *deep* food shortage dominates rather than averaging away across twelve goods.

- **Accumulate:** `unrest ← clamp(unrest + k·D − decay·unrest, 0, 1)`. Catastrophe lives in the **integral** over sustained shortage — one bad tick is harmless, chronic famine crosses the strike/decline thresholds in a dozen-ish ticks. `k`, `decay`, and the per-capita demand gradient are simulator-tuned; if food is not lethal enough, widen the existing consumption gradient rather than adding an importance field.

---

## 7. Part 1b — Growth / decline

Population change is logistic toward `popCap`, gated by satisfaction and damped by unrest:

```
Δpopulation = growthRate · population · (1 − population/popCap) · satisfactionFactor
            − declineRate · population · unrestFactor
```

Fed + calm → grows toward capacity then asymptotes (the hard `popCap` ceiling guarantees no runaway). Starved/unstable → net decline. Seeded below capacity (SP1) gives the growth headroom. Rates simulator-tuned to gentle growth with no extremes. (`satisfactionFactor`/`unrestFactor` are the data-driven *effect* terms of §4 — new effects are added terms.)

---

## 8. Part 1c — Migration

Migration **relocates** existing population (conserved), distinct from growth/decline which creates/destroys it. Together they produce population *geography* (boomtowns, ghost towns).

- **Same unified topology as Part 0** — intra-faction graph, distance-attenuated, borders closed — so people and goods share one map (no flee-but-cannot-be-fed oscillation). Reuses the `SystemConnection` adjacency cache, the work-budget sharding, and the per-edge gradient-flow algorithm shape; it is a parallel population-flow, not a literal call into goods trade-flow.
- **Attractiveness gradient** replaces price: a neighbour's pull = **low unrest + headroom** (`popCap − population`). Population flows down-unrest / up-headroom, attenuated by distance.
- **Conserved, abstract transfer** (like goods): move a capped fraction of source population to the neighbour in one tick — no in-transit state. Multi-hop relocation *emerges* over successive ticks. Capped by destination headroom and a small per-tick fraction of the source.
- **Composes with decline:** a dying system both shrinks (decline) and empties (emigration) → ghost towns form fast. Rate caps keep a single tick sane.

---

## 9. Integration & the feedback loop

The load-bearing wiring, within one tick:

1. **Economy processor** produces and consumes. Production applies the system's **current strike state** (derived from *last tick's* `unrest`) as a suppression multiplier. It records per-system `delivered_g / demanded_g`.
2. **Population processor** (`dependsOn economy`) reads the recorded satisfaction, updates `unrest`, applies growth/decline, runs migration, and **rewrites `demandRate`** for the new population (the per-tick update [Part 3's design](./economy-simulation-substrate.md#822-locked-decisions-2026-06-17) explicitly anticipated, alongside `anchorMult`).

This is a **one-tick feedback loop, not a cycle**: unrest written this tick suppresses production next tick. All changes are gradual and bounded per tick (the vision's legibility property) — a market drifts, never teleports.

---

## 10. Calibration

`npm run simulate` is extended to model dynamic population, unrest, and migration, and to check **stable-but-growing**:

- Viable core grows gently toward capacity then plateaus; **no total collapse**, **no instant saturation**, **no migration ping-pong** between two systems.
- Localized boomtowns/ghost towns and isolated non-viable-faction decline are **success**, not failure.
- Bounded unrest in well-supplied systems; spikes localized to genuinely starved ones.
- The existing economy targets still hold — stocks in `[5,200]`, price dispersion, greedy ≫ random — now with `demandRate` recomputed each tick as population moves.

**Coarse only.** The seed-fill fraction and growth/unrest/migration coefficients are sim-discovered; do not over-tune — SP3 (build space) and SP5 (faction trade/territory) reshape the equilibrium.

---

## 11. Reseed & simulator implications

- **Full reseed** — `population` changes type, `unrest` is added, prosperity columns are dropped, and `demandRate` seeding is unaffected (still seeded, now also rewritten per tick). Consistent with the "full reseed at sub-project start" norm.
- **Simulator (Part 0):** recalibrate goods diffusion under the de-regioned topology (static population — no new population modelling yet).
- **Simulator (Part 1):** model population growth/decline, unrest accumulation, and migration along the adjacency graph; recompute `demandRate` per tick; add the stable-but-growing checks. This is the first point at which "growing" is something the simulator can observe (vision §9).

---

## 12. Deferred / out of scope

**→ SP5 (faction agency / dynamics):**
- **Rebellion** — sustained high unrest → system leaves faction control (`factionId` mutation).
- **Relation-weighted borders** — diplomacy *opens* cross-faction flow (goods + migration): allies trade, enemies sealed. SP2 hard-closes all faction borders; SP5 opens them by relation.
- *(Territory capture — borders physically moving — rides with the war system, SP5+.)*

**→ Future consideration (timing TBD):**
- **Independent systems & tiny / single-system factions** as a first-class concept (none exists deliberately today; an independent system is effectively a 1-system sovereign).

**→ Accepted limitations (document, don't fix in SP2):**
- Resource-awkward faction territories under closed borders (§5). Self-resolves with SP5 inter-faction trade + territory capture.

**→ Taxonomy extension slots (already designed-in, §4):**
- Amenity need-channels (health, entertainment) → new *signals*. Industrial externalities (pollution/blight) → new *property*; industrialize-vs-livability. Both plug into the same spine.
- **Dedicated starvation/famine consequences.** In SP2, starvation acts *only* through the generic channel — a deep food deficit dominates `unrest` (convex weighting, §6) and suppresses growth (the satisfaction gate, §7); there is no famine-specific effect. A dedicated famine *state* (e.g. direct population loss above a food-deficit threshold, or a famine event) is a clean later addition: a new threshold + effect on the same spine.

**→ Not in SP2 (other sub-projects):**
- Build space / housing raising `popCap`, supply-chain input-gating, 26-good roster, facilities (SP3). Event physical-perturbation redesign (SP4).

---

## 13. Success criteria ("done")

1. **Part 0:** goods diffuse over the intra-faction graph (region lines ignored, faction borders closed), distance-attenuated, sharded by work-budget; the economy recalibrates to the same coarse targets; no Postgres-timeout regression at 10K scale.
2. **Part 1:** `population` is Float and moves; `unrest` accumulates from convex demand-weighted dissatisfaction; chronic shortage triggers strikes (production suppressed) and decline; migration relocates population along the unified topology, producing visible boom/bust geography.
3. Prosperity is fully retired; the stability UI reads from unrest; `demandRate` tracks population each tick.
4. `npm run simulate` validates stable-but-growing (no collapse, no saturation, no ping-pong; existing targets hold).
5. All unit/integration tests pass; no `as`/`unknown` violations; conventions held.

---

## 14. Open questions → resolved in the build plan

- **Distance-attenuation curve** (per-hop decay shape) and the **work-budget slice size** for re-sharding.
- **`unrest` dynamics** — `k`, `decay`, the strike threshold, and whether strike is stored (hysteresis) or derived each tick.
- **Strike suppression shape** — hard halt vs steep multiplier.
- **Growth/decline + migration coefficients** and the seed-fill fraction (sim-discovered).
- **Satisfaction hand-off mechanism** — exactly how the economy processor surfaces per-system `delivered/demanded` to the population processor (transient store vs context field).
- **Processor placement of migration** — a phase inside the `population` processor vs a sibling processor.
- **Independent-system rule** — confirm whether the flood-fill leaves any `factionId = null`; if so, the permeable-pool rule.
- **Schema specifics** — `unrest` column, optional `strikeActive`, the `population` type migration, and the prosperity-column drops.

---

## 15. Relationship to existing docs

- **[economy-simulation-vision.md](./economy-simulation-vision.md)** — the north star; SP2 implements its §13 item 2 (demand & consequence loop) and resolves its §14 open items on migration mechanics and unrest thresholds. Rebellion and relation-weighted borders move to SP5; prosperity's fold (§10) lands here.
- **[economy-simulation-substrate.md](./economy-simulation-substrate.md)** — SP1; SP2 builds on its static population, days-of-supply pricing, and the anticipated per-tick `demandRate` rewrite (§8.2.2).
- **[economy.md](../active/gameplay/economy.md)** / **[system-traits.md](../active/gameplay/system-traits.md)** (active) — updated when SP2 ships (unrest/stability replaces prosperity; population becomes dynamic; diffusion topology section rewritten).
- **[faction-system.md](../active/gameplay/faction-system.md)** (active) — gains the SP5 hooks SP2 defers to it (rebellion, relation-weighted borders).
