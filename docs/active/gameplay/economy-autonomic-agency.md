# Economy Simulation SP5 — Autonomic-Light Agency (Directed Logistics + Autonomic Build)

> **Status: Active (shipped)** — economy sub-project SP5, the *autonomic-light* slice (shipped #114).
> The **recovery** half of the §13-item-5 autonomic mechanism, paired with SP3.5
> [infrastructure decay](./economy-infrastructure-decay.md) (the **erosion** half): decay tears unused
> capacity down, agency builds viable capacity back and moves goods to where they are needed. Sits *on*
> the substrate-v2 available-space model and the SP3.5 decay loop (both unchanged) and *beside*
> migration on the shared intra-faction [open-edge topology](./trade-simulation.md). Roadmap home:
> [economy-simulation-vision.md](../../planned/economy-simulation-vision.md) §13 item 5.
> North-star constraint: [negative-space-economy.md](../../planned/negative-space-economy.md).
>
> **Scope note.** This is *autonomic-light*: free (capacity-bounded, no treasury), needs-driven, no
> embodied agents. The full treasury-funded faction brain is a later slice — now the *player's control
> surface* under the grand-strategy pivot ([grand-strategy-vision.md](../../planned/grand-strategy-vision.md)
> Phase 3). The personal trade-logistics layer (marketplace arbitrage, bounties) is retired with the pivot.

---

## Key mechanics (the headline)

A seeded galaxy left to SP3.5 decay alone is a **one-way ratchet down**: things rot, nothing recovers.
Most of the map also can't feed itself locally — a same-faction food surplus often sits a couple of hops
away, and nothing moves goods between systems on its own. Autonomic-light is the faction
**deliberately acting on its own territory** to counter both: it **moves its surplus to its deficits**, and
it **builds viable systems up toward their potential**. Two mechanisms, one slow agency clock, one shared
"what does this system have vs need" reading.

**Two rules:**

> **Directed logistics:** a faction moves its own surplus to its own deficits — the sole goods-mover
> between systems — on a slow clock, silently, within a capacity budget set *below* total need.
>
> **Autonomic build:** a faction builds its systems up toward viable potential — housing leads,
> population fills it, industry follows the resident workforce.

Both are **needs-driven, free, and capacity-bounded** in this slice (no money, no treasury). The budget is
deliberately smaller than total need, so a permanent residual remains — the **negative space**, and the
standing player opportunity the later scaling/bounty rework turns into contestable trade.

The two halves reinforce each other and are why **logistics-first** was the correct sequencing: logistics
delivers supply → a system becomes *fed and calm* → a fed, calm system is what the build planner grows.
Supply makes a system viable; a viable system builds.

---

## How it composes with the existing flows

Directed logistics is the **sole goods-mover** between systems — there is no passive price-gradient
diffusion. It shares the intra-faction edge substrate with population migration (the only other flow):

| Flow | Driver | Funded | Legibility |
|---|---|---|---|
| **Migration** | unrest + headroom | n/a | ambient |
| **Directed logistics** (this slice) | faction need / surplus | free (v1) | map "Logistics" overlay |

Both act only on **developed** systems: migration's open edges are gated to developed-both endpoints and
directed logistics only routes between developed participants, so an unclaimed or controlled system neither
sends nor receives goods or population (its seeded market is frozen). Logistics draws only from
market stock **above** a donor's own days-of-supply anchor, so a donor is never pulled below its comfort
target and locals keep their supply (the v1 form of civilian crowd-out — emergent, target-protected).

---

## The shared reading: market state per good

Both halves run off one per-system, per-good classification against the **days-of-supply price anchor**
(`targetStock = TARGET_COVER × demandRate`, where `demandRate` = civilian consumption + industrial input
draw — the same number the supply/demand UI shows). One definition, so logistics and build agree on what a
deficit or surplus *is*:

- **Deficit** — `stock < targetStock × DEFICIT_FRACTION` (below the anchor, with a dead-band). Severity =
  shortfall × demand.
- **Surplus** — a source of drawable stock by either path, always donating only `stock − targetStock`
  (never below the anchor): **(a)** `stock ≥ targetStock × SURPLUS_MARGIN` — any holder of excess
  inventory (margin > 1 leaves the deliberate residual); or **(b)** a **structural producer**
  (`production > demand`) holding stock above its anchor. Path (b) mirrors the deficit-side self-supply
  gate and is required because the economy's production throttle caps a producer at
  `HOLD_COVER × targetStock` (~1.3×), *below* the 1.4× margin — without it a structural exporter could
  never form a surplus, and directed logistics went dead for every good its producers also consume
  (food, water, biomass).
- **Balanced** — the dead-band between, and anything with no demand anchor.

**Self-supply gate.** A system that produces at least its own demand for a good (`production ≥ demand`) is
**never** a deficit sink for it — its low standing stock is *throughput*, not need. Importing into it only
piles stock toward the storage ceiling, where SP3.5 decay reads the producer as not-selling and tears down
its own extractors. Net-negative producers (make some, need more) are still sinks.

---

## Directed logistics (moves goods)

### The logistics budget

Each system generates a per-cycle **logistics work-budget** (a simple function of its population), and
these **sum to a faction-wide pool** — the total work the matcher may spend. Per-system-generates /
faction-spends means a strong hub can fund a haul to a struggling neighbour, while capacity stays grounded
in the systems that produce it. Free and population-scaled in this slice; treasury-funded and
upgrade-multiplied later. It is a **rate, not a stock** — a fresh pool each cycle, no carry-over.

**Work = quantity × route cost**, where route cost combines hop count and total fuel cost along the path.
This one choice does triple duty:

1. **Limiter** — match until the pool is spent, then stop. Pool < total need ⇒ residual ⇒ negative space.
2. **Logistics unit** — free + population-scaled now; treasury-funded later.
3. **Distance-as-cost** — near deficits are cheap, distant ones expensive, so the matcher feeds nearby
   suppliable systems and leaves the stranded few unfed, exactly as designed, with no money model.

### The matching engine

Per faction, per cycle: rank deficits worst-first (shortfall × demand), and for each, find the nearest
same-faction surplus of that good within a hop budget. Allocate
`transfer = min(deficit shortfall, surplus drawable, remaining pool / route cost)`, spend the pool, advance,
and stop when it's exhausted. The donor never drops below its own anchor, so moving goods never creates a
new deficit. Deficits left unserved — pool spent, or no surplus in reach — are the residual.

### Silent application

A matched transfer applies its stock deltas on the cycle boundary (`from −= q`, `to += q`, both
band-clamped) and appends a **`TradeFlow` row tagged `flowType: "logistics"`**. There is no business
object, no claimable mission, no money — the visible artifact is the flow arc on the map. (The earlier
"expose a fraction as claimable Contracts" design was built then **ditched** before merge: discrete
claimable trade missions are the wrong primitive for multiplayer. The player layer is being reworked into
a bounty / surfaced-marketplace model after a global economy scale-up — see the scaling-rework doc.)

Routes are derived on demand and respect *current* topology — if a lane on the path is severed, the
transfer fails. Only matched transfers are pathed (bounded by the pool), never all-pairs.

---

## Autonomic build (grows infrastructure)

SP3.5 decay only ever moves `WorldBuilding.count` **down**, toward what is used. *What* to build and
*where* is a faction decision, not an automatic erosion — so growth is this slice. A system's **potential**
is set by its physical substrate and gated by viability, in a strict physical chain:

```
habitable land  →  housing  →  population  →  industry
   (caps)            (caps)       (caps)
```

A barren, metal-rich world with almost no habitable land houses almost no one, so it can staff almost no
industry — no matter how many ore deposit slots it has. Industry is bounded by labour, labour by habitable
land, so the planner can never place capacity nobody can staff. A system already at its potential has
nothing left to build, so the build loop is **idle at potential** — visible only where a system is actually
growing. Three mechanisms, in causal order:

1. **Proactive housing.** Where a system is *fed and calm* (`dissatisfaction ≤ D_settle` and
   `unrest ≤ unrest_settle`) and has habitable land not yet built out, build housing **ahead** of
   population, toward the habitable cap — creating the headroom population needs to grow. Housing is paced
   to keep `popCap` only a small margin (`settleMargin`) ahead of current population, so population (which
   grows ~3× faster than housing decays) fills it before disuse decay can erode it. A system short on food
   or unsettled does not grow — food supply is therefore the natural ceiling on how full a system becomes,
   with no magic population cap.
2. **Population growth** fills the new housing — the existing logistic, untouched; `popCap` recomputes live
   from the housing count (SP3.5).
3. **Labour-gated industry.** Build production only where there is genuine **spare labour**
   (`population − labourDemand`) *and* a reachable structural deficit (a deficit with no reachable surplus)
   it can serve with available inputs. Each build is capped to what the already-resident population can
   staff (`spareLabour / labourPerUnit`, fractional), decremented per placement within a cycle. Industry
   follows the people who already live there; it is never built for population that does not yet exist.

The faction build budget is pooled the same way as logistics (`Σ population × generation rate`) and funds
**both** housing and industry. No explicit cross-mechanism priority is needed — the gates sequence the work
on their own: a system with no spare labour spends budget only on housing (and only if fed and calm), and
industry draws budget only where spare labour already exists. A per-system per-cycle pacing cap keeps one
system from absorbing a disproportionate share of the pool in a single run.

---

## Build and decay share one equilibrium (they don't churn)

Build and SP3.5 decay are independent autonomic forces, not opposites. Build grows a system toward
potential; decay erodes capacity that has fallen out of use. They share **one** equilibrium — occupied
housing, staffed-and-selling industry — so a viable system sits at potential with **both ≈ 0**, and neither
churns the other. That shared equilibrium is the whole point of the labour gate: the build never creates
capacity above what can be staffed or sold, so decay has nothing to immediately liquidate. Growth is the
main dynamic; decay only bites on a real supply or unrest shock. Decay rates and thresholds are untouched
by this slice.

---

## Cadence

Both halves run on a slow **agency clock** — `INTERVAL = 2 × ECONOMY_UPDATE_INTERVAL` (= 48 ticks; the
economy clock is 24) — a big, predictable current, per the "nothing vanishes while you watch" legibility
requirement. Each is a **per-faction shard**: a contiguous window of the stable faction-key order runs each
tick, so every faction is swept exactly once per interval at any universe scale, with a catch-up factor
scaling moved/built volume to wall-clock. Two processors join the tick pipeline:

- **`directedLogistics`** (`dependsOn: economy`) — classify markets, match surplus→deficit, apply silent
  stock deltas + `logistics` flow rows.
- **`directedBuild`** (`dependsOn: directed-logistics`) — on the same monthly pulse, before its build
  step, each faction runs one **claim** and one **develop** step to grow its territory (see the
  [faction-system](./faction-system.md#territorial-expansion-claim-and-develop) control-flag model):
  claim scores in-reach unclaimed systems (substrate × proximity, absolute so factions compare
  directly) and proposes one per faction, with cross-faction conflicts resolved deterministically
  (highest score, seeded-RNG tiebreak); develop ranks a faction's own controlled systems by substrate
  and flips its best one to `developed`, seeding a conserved colony population from the nearest
  same-faction developed system. Only after these two steps does the build step run — the develop-gate
  everywhere is `system.control === "developed"`, so a system claimed this pulse is build-eligible only
  once it has also been developed. Builds are applied as upward `WorldBuilding.count` increments
  (continuous Float; removal stays decay's job).

Both reuse the existing fixed-interval shard machinery and the shared market-state derivation. See the
[tick engine](../engineering/tick-engine.md) for the full processor order.

---

## Map legibility

Directed hauls surface as a dedicated **"Logistics" map overlay**: tier-coloured curved arcs that lift off
the straight lane network, arrow-headed toward the importing system. The overlay is pure visualisation of
the `logistics` `TradeFlow` rows — see the [Universe & Map spec](./universe.md) for the rendering detail.

---

## Success criteria (coarse, audit-grounded)

On a multi-thousand-tick run the decay-only ratchet visibly **bends for the suppliable middle of the
galaxy**: pop decline arrested rather than trending down, striking-system count plateauing instead of
climbing, fed systems climbing toward potential (housing → population → industry) and asymptoting there,
barren/low-habitable worlds staying small — while the self-sufficient core and the stranded fringe are
untouched. Coarse health-bar, not precision (per the calibrate-to-shape stance): no NaN / runaway / pinning;
logistics never draws a donor below its anchor; build never exceeds habitable land or staffable labour;
budget < need leaves a visible residual. Validated in the simulator first, then live observation.

---

## Scope boundaries

**In:** the logistics work-budget (per-system generation → faction pool, work = qty × route cost); the
shared deficit/surplus/self-supply classification; greedy surplus→deficit matching with silent stock moves
+ `logistics` flow rows; proactive housing (fed-and-calm, paced ahead of population, capped at habitable
land); labour-gated industry builds (fractional spare-labour gate); both builds funded from the pooled
faction budget with per-system pacing; both processors on the 48-tick agency clock.

**Deferred (explicitly out):**
- **Player trade layer** — the ditched claimable-Contract design; **retired entirely by the grand-strategy
  pivot** (personal trading is cut; the deleted scaling-rework doc's bounty/marketplace fork is moot).
- **Treasury & money** — the budget is a physical work allowance, not a cost; treasury funding, the
  logistics-efficiency band, and the "faction prefers a player did it" payout asymmetry → SP5-full.
- **Route consequences** — per-system transit cost, event/revolt blocking, cargo damage, visible
  raidable convoys → SP5-full / war.
- **Strategic bottleneck-relief weighting** — faction-wide chokepoint targeting + doctrine bias (the
  demand *term* is in v1; the prioritisation strategy on top is deferred).
- **Full "Population ← economic viability"** (food + jobs carrying capacity as the dominant growth lever)
  → SP4; the "fed and calm" gate is a deliberately narrow slice of it.
- **Habitat / terraforming** that *raises* a world's habitable ceiling → later.
- **Faction `factionId` mutation** (capture/rebellion) and the `topology.ts getOpenEdges()` cache-
  invalidation it would force → SP5-full / war.

---

## Open calibration knobs (all simulator-tunable)

- Logistics: the budget generation rate; surplus/deficit margins; hop budget / max logistics distance; the
  hop-vs-fuel blend in route cost.
- Build: `settleMargin` (housing headroom ahead of population); `D_settle` / `unrest_settle` (the
  fed-and-calm gate); the per-system budget pace; the budget generation rate.

Per the standing approach, calibrate to a **coarse** health bar — precise tuning is perishable and waits
until SP4 / SP5-full land.

---

## Where this sits in the roadmap

- **Pairs with** SP3.5 [infrastructure decay](./economy-infrastructure-decay.md) — decay erodes unused
  capacity, agency recovers viable capacity and supplies the suppliable middle. The two are the down/up of
  one moving substrate.
- **Builds on** substrate-v2 available-space and the SP3 input-gating cascade (both unchanged).
- **Vision §13:** the autonomic (item 5) half, logistics-first, with a narrow slice of item 4
  (pop-viability) as the "fed and calm" build gate. Full SP4 (events + the dominant-lever pop-viability
  rework), the player-facing scaling/bounty rework, full faction agency (treasury, military ceiling), and
  the war capstone follow on top of this substrate.
