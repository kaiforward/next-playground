# Economy Simulation SP3.5 — Autonomic Infrastructure Decay

> **Status: Active (shipped)** — economy sub-project SP3.5, sequenced **between SP3 and SP4**.
> Sits *under* the SP3 input-gating cascade and *on* the substrate-v2 available-space model (both
> unchanged). Roadmap home: [economy-simulation-vision.md](../../planned/economy-simulation-vision.md) §13 — this is
> the **decay** half of the §13-item-5 autonomic mechanism brought forward, fused with a narrow slice of
> the §13-item-4 booked phase *"Population ← economic viability."* The SP5/war layering conclusions it drew on
> lived in `docs/planned/sp5-war-layering-contract-audit.md` (deleted with the grand-strategy pivot; git history).

---

## Key mechanics (the headline)

Today the seeded universe is a **one-way ratchet**: `WorldBuilding.count` is written once at seed and only
ever read — so the industrial base can never shrink. Population *can* decline (via unrest), but infrastructure
cannot, which means a chronically-failing system keeps all its factories forever. This sub-project gives the
world its missing counterweight.

**One rule:**

> **Infrastructure decays toward what is actively *used*. The gap between *built* and *used* is what rots.**

That single rule, applied to a seeded world, sorts it into survivors and ruins **without any growth**:

- A **viable** system sits at the natural equilibrium **built = used** — its factories are staffed, its
  output sells, its housing is occupied, its unrest is low. The built-vs-used gap is ~0, so **nothing
  decays. It holds steady.**
- A **nonviable** system drifts: a food/water shortage drives unrest → population declines → housing and
  production fall out of use → the unused gap rots → high unrest *actively* tears down even used
  infrastructure → it spirals and **falls apart.**

Crucially, **growth is deliberately *not* in this sub-project.** Building things back up — what gets built,
where — is a *decision*, and decisions belong to the faction/AI agency layer (SP5, treasury-funded). Here,
`count` only ever moves **down**. This is the layering fix the audit surfaced: autonomic *drift* conflated a
natural process (decay) with a deliberate one (construction). Splitting them makes this slice self-contained
and needs **no treasury**.

The capstone is a **rework of the Industry panel** so the three quantities the decay loop runs on —
**available** (shared land headroom), **built** (`count`), and **in-use** (occupancy for housing,
staffed-and-selling `count × min(labourFulfillment, outputUptake)` for production) — read clearly at a glance,
per land pool and per building, health-coloured. The panel was deferred until the economy *moved*; this slice
is what makes it move.

---

## How the pieces interact

```
                        ┌─────────────── existing (unchanged) ───────────────┐
 food/water shortage ─► dissatisfaction D ─► unrest (integral) ─► death (sink) │
                        └──────────────────────────────┬──────────────────────┘
                                                        │
   built count ──┐                                      │ unrest
                 ├─► used = staffed-and-sold / occupied │
 labourFulfil. ──┘            │                         │
 market uptake ──────────────┘                          ▼
                                          ┌──────── NEW: decay ────────┐
                  built − used  ──────────► (1) disuse decay  (gentle)  │ count ↓
                  unrest > θ    ──────────► (2) unrest decay  (snowball)│ count ↓
                                          └──────────────┬──────────────┘
                                                         ▼
                              housing count ↓ ─► popCap recompute ↓
                                                         ▼
                              pop > popCap ─► NEW: overshoot ─► migration ⊕ death (split by unrest)
```

The loop closes: shortage → unrest → pop leaves → infrastructure unused → decays → housing shrinks →
`popCap` drops → if it drops *below* the people still there (the unrest-snowball case), the overshoot
displaces them. Both "coins" — population decline and infrastructure decay — now fail *together*, and the
only thing that can reverse it is later faction treasury spend (build-out + unrest suppression).

---

## The decay model (detail)

`WorldBuilding.count: Float` becomes a per-tick **read/write**, mutating **downward only**. It runs on the
existing economy-shard cadence (the same fixed-interval shard as the economy and population processors, every
`ECONOMY_UPDATE_INTERVAL` ticks) and reads the freshly-computed `labourFulfillment` and market state. Writes
apply batched `count` deltas across the shard in one pass, never per-row.

### "Used" depends on the building's role

| Building class | "Used" level | Decays toward | Maintained by |
|---|---|---|---|
| **Housing** | occupancy | `population / POP_CENTRE_DENSITY` (units the current population fills) | the people living in it — full housing never rots |
| **Production / extraction** | staffed *and* selling | `count × min(labourFulfillment, outputUptake)` | active workers + a market for the output |

- **`labourFulfillment`** is the existing system-wide `min(1, pop / labourDemand)` ratio.
- **`outputUptake`** is a new, cheap per-good signal: is this output finding buyers, or piling up? Measured
  off market stock (chronically pinned near `storageCapacity` ⇒ overproduction ⇒ low uptake), the seller-side
  mirror of the consume-side `satisfaction` signal the economy processor already computes. This is exactly the
  overproduction case observed in play (systems making far more than sells) — the rule makes that excess shed.

### Two decay channels

**(1) Disuse decay — gentle, autonomic, keeps the world tidy.** Built capacity above its used level rots
toward it:

```
count ← count − disuseRate · max(0, count − used)
```

Exponential decay toward `used` with a **small** `disuseRate` *is* the hysteresis — one bad tick removes only
a sliver, so a transient labour dip or a single unsold tick never abandons a factory; only a *sustained* gap
compounds down. No separate stored "abandonment" flag or integral is needed (mirroring how `strikeMultiplier`
derives its regime from the unrest integral without its own state). `used` may be lightly smoothed so decay
tracks the trend, not tick noise (calibration knob).

**(2) Unrest decay — catastrophic, the snowball.** Above an unrest threshold, infrastructure is *actively
destroyed even while in use* (riot, neglect, sabotage):

```
count ← count − unrestRate · count · max(0, unrest − θ_decay)
```

This is the infrastructure mirror of the population-decline term `declineRate · pop · unrest`. It is what turns
a struggling system into a *dying* one: it doesn't wait for capacity to fall idle, it tears down working
capacity, deepening the shortage that drives the unrest — a self-reinforcing spiral whose only exit (later) is
treasury-funded rebuild + stability spend.

Decay never takes `count` below `0`. Both rates and `θ_decay` are simulator-tunable knobs (see Calibration).

### `popCap` recomputes live

Because housing `count` now changes, `popCap` can no longer be a seed-frozen number. It is recomputed each run
from the current housing set: `popCap = Σ housing.count × POP_CENTRE_DENSITY` (the existing `POP_BASELINE_FLOOR`
stays wired at `0`). The population processor already reads `popCap`; it now reads a *live* one.

---

## Population coupling — migration, and death as the real sink

Two existing mechanisms already move population, and the distinction is load-bearing here:

- **Migration** (`lib/engine/migration.ts`) is **conserved** — it *relocates* people, never removes them — and
  it **already reads unrest**: appeal = `contentment (1 − unrest) + headroom`, so high-unrest systems repel
  (push) and calm, roomy ones attract (pull). Critically, a move is **capped by the destination's headroom**,
  so when the galaxy is full migration moves *nobody*. **Migration alone can only shuffle a shortage around — it
  can never reduce the universe's total population.**
- **Death** is the **non-conserved sink** — the `declineRate · pop · unrest` term in `populationDelta`
  subtracts population that goes *nowhere*. This is the concept that lets pops genuinely *disappear* from the
  game; it already exists, it simply hasn't been *named* as death. It is unrest-gated, so a violently failing
  system loses people outright, not merely to emigration. *(Game-facing term: **decline** — "death" is just
  the internal name for the non-conserved sink, distinguishing it from conserved migration. War, later, adds
  the other obvious source.)*

So the building blocks are present. What's missing is the **link from decayed housing to population**:
`populationDelta` floors population at `0` but **never clamps it down to `popCap`** — so if housing rots *below*
its occupants, they don't leave on their own; the lost headroom merely stops growth. We close that with one
focused displacement term:

> When `population > popCap` (housing has rotted below its occupants), the overshoot `population − popCap` is
> **displaced**, split between **migration** (they flee to systems with headroom) and **death** (they perish),
> **weighted by unrest**: an orderly contraction (low unrest — e.g. industry quietly downsized) is
> migration-dominant; a violent collapse (high unrest — the snowball channel) is death-dominant. Whatever
> migration can't place — because nowhere has headroom — falls to death, the sink of last resort.

This pairs with the **unrest-snowball** decay channel: in the gentle path housing simply follows population
*down* (no overshoot), but unrest decay can drop `popCap` *beneath* current population — which is exactly when
displacement fires, and exactly when unrest is high, so death dominates. The two mechanisms reinforce:
infrastructure torn down by unrest evicts people, and unrest decides how many escape versus die.

This is deliberately the **narrow** slice of SP4's booked *"Population ← economic viability"* phase — just the
housing link plus making death first-class. Food/water viability is **already** handled (shortage → unrest →
decline/death); the broader jobs-and-food *carrying-capacity* rework that makes economic support the *dominant*
growth/decline lever stays in **SP4**, where physical perturbations make conditions vary enough for it to read.
Pulling the full rework in here would reopen the freshly-locked substrate-v2 calibration — out of scope.

---

## Why growth is excluded (the layering decision)

The original brainstorm framed an *autonomic growth + decay* loop. Splitting it — **decay autonomic, growth
AI-directed** — is the central design decision of this sub-project, and resolves the layering concern the audit
was prompted by:

- **Decay is a natural process.** Unmaintained things fall apart regardless of intent. No actor, no money, no
  decision — it can run today, on the existing substrate.
- **Growth is a deliberate process.** *What* to build and *where* is the core of faction agency (vision §12.3
  build planner) and needs the **treasury** (audit gap G1) to fund it. It belongs to SP5.

And decay-only is *sufficient* for the goal — watching a seeded universe sort itself into viable and failing
systems — precisely because the equilibrium is **built = used**: a well-matched seeded system already sits
there and holds; only the mismatched ones drift. We don't need growth to see viability play out; we need decay
plus a stable equilibrium. Regrowth, colonisation, and rescue are then the AI's story, layered on a world that
already breathes. (The existing population logistic still fills seeded housing toward `popCap` on the way to
that equilibrium — that is population settling into pre-built capacity, not new infrastructure growth.)

---

## Industry panel rework (final phase)

The thread that started this sub-project: the Industry panel doesn't make the **available → built → staffed**
relationship legible. The data already flows through `useSystemIndustry` / `industry-panel.tsx`, but it's
scattered:

- **Available** appears only as the `max` on the Development progress bars (deposit / habitable / general land).
- **Built** is the bare `count` roster in *Industrial base*, grouped by tier.
- **Staffed/used** appears only as a single system-wide *Labour* bar, disconnected from the building rows it
  actually throttles — so the **built-vs-staffed gap the decay loop runs on is invisible per building.**

**Goal:** one at-a-glance view of the three quantities, per land-type and per building, plus a **decay/health
read** now that the substrate moves — is this system holding at equilibrium (built ≈ used), sitting on idle
capacity that will rot, or actively decaying under unrest? The panel should make "this world is thriving / coasting
/ falling apart" obvious without reading numbers.

**Shipped design** (collaborative, prototype-first — not an agent invoking `frontend-design` blind). The panel
groups buildings by the two physical land **pools** — **Deposit land** (extractors) and **General land**
(housing + factories, shared) — each with a stacked land bar whose free tail two-tones the **habitable** sub-cap
(housing-growable vs factory-only). A system **health strip** (thriving / coasting / declining via
`industryHealth`) carries a `stable · idle · collapsing` building tally and an info-icon legend popover. Each
building row shows **in-use vs built** as a health-coloured bar — green stable / amber idle / red collapsing,
green holding below 100% via the `IDLE_COASTING_FRACTION` deadband, red past `IDLE_COLLAPSING_FRACTION` or on
unrest-teardown / overshoot — with the % and decimal magnitude, the binding `cause`, and per-input `needs` chips
for producers. The read path surfaces per-building `used` + `idleReason` and a `buildingHealth` helper
(`lib/engine/industry.ts`, fed by live `outputUptake`); the trade balance (produces-vs-consumes) is kept as the
one secondary block. Honours the Foundry theme and reuses `components/ui` primitives. It landed **last**, so it
renders the finished, moving substrate.

---

## Build order (phases)

1. **Decay engine (pure).** `lib/engine/` functions: `used` per building class, disuse decay, unrest decay —
   pure, total, Vitest-tested in isolation (no DB import in the test graph).
2. **Tick wiring.** A decay step on the economy-shard cadence: read building set + `labourFulfillment` +
   market uptake, compute batched downward `count` deltas, apply them, recompute `popCap` live.
   The pure body runs against the in-memory world.
3. **Population coupling.** Housing-overshoot → unrest-weighted **migration ⊕ death** displacement term.
4. **Calibrate.** Run long seeds through `npm run simulate`; confirm the *coarse* behaviour — viable systems
   hold, nonviable ones visibly decay, no NaN/runaway/total collapse of the galaxy — and tune the rate knobs.
5. **Industry panel rework.** The at-a-glance available/built/staffed + health view.

Phases 1–4 are the economy-engine PR(s); phase 5 is the UI PR. Split per the 2–4-phase-PR convention.

---

## Scope boundaries

**In:** downward-only `WorldBuilding.count` mutation; disuse + unrest decay channels; `outputUptake` signal;
live `popCap` recompute; housing-overshoot population displacement (migration ⊕ death, naming the existing
decline term as the non-conserved death sink); Industry panel rework.

**Deferred (explicitly out):**
- **Autonomic / AI growth of infrastructure** and the **faction treasury** → SP5 (audit G1, G2-as-build-path).
- **Full "Population ← economic viability"** (food + jobs carrying capacity as the dominant lever) → SP4.
- **Faction `factionId` mutation**, and therefore the **`topology.ts getOpenEdges()` cache-invalidation**
  trap the audit logged → not touched here (no ownership change); a hard prerequisite for SP5 capture/rebellion.
- **War coupling**, directed logistics, military channel → SP5 / war-system.

---

## Open calibration knobs (all simulator-tunable)

- `disuseRate` (how fast idle capacity rots) and any smoothing window on `used`.
- `unrestRate` + `θ_decay` (unrest-decay onset and severity — the snowball's aggression).
- The `outputUptake` curve (how "chronically unsold" maps to a decay-eligible idle fraction).
- Housing-overshoot displacement rate and the unrest-weighted migration-vs-death split (low unrest → flee,
  high unrest → perish).
- Symmetry check against the population rates (`growthRate`/`declineRate` = 0.015): decay should be slow
  enough that infrastructure is "stickier" than population, so a brief dip doesn't strand a base.

Per the standing approach, calibrate to a **coarse** health bar (no NaN/runaway/galaxy-wide collapse; viable
holds, nonviable decays; dispersion across systems) — precise tuning is perishable and waits until SP4/SP5 land.

---

## Where this sits in the roadmap

- **Superseded** the converged brainstorm `docs/build-plans/autonomic-growth-decay-brainstorm.md` (now deleted).
- **Drew from** `docs/planned/sp5-war-layering-contract-audit.md` (deleted with the grand-strategy pivot;
  git history) — its SP5/war layering conclusions (treasury G1, runtime build-out as the *growth* path,
  labour priority, military channel, topology-cache invalidation) should be resurrected from git when the
  player-seat (pivot Phase 3) and war (Phase 6) specs are written.
- **Vision §13:** decay half of item 5 (autonomic) brought forward + narrow slice of item 4 (pop-viability).
  Full SP4 (events → physical perturbations + the dominant-lever pop-viability rework) and full SP5 (treasury,
  build planner, directed logistics, military ceiling) follow, in that order, on top of this moving substrate.
