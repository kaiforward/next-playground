# SP5 Re-sequencing — Seed-Coherence Foundation (RESUME POINT, 2026-06-26)

> **⚠ ABANDONED (2026-06-28) — this Stage-1/Stage-2 "seed-coherence" re-sequencing was NOT taken.**
> #114 shipped the simpler housing-led seed plus the reactive autonomic-build slice
> (`lib/engine/directed-build.ts`), and the directed-logistics track resumed directly. Canonical sequence:
> [economy-simulation-vision.md](../planned/economy-simulation-vision.md) §13 "CURRENT SEQUENCE (2026-06-28)".
> Kept for historical/design reference only; safe to delete.

> Working note: the resolved direction for SP5 autonomic-light agency, after the Phase-1 logistics
> outcome. Supersedes `sp5-logistics-phase1-outcome.md` (deleted — the A/B/C fork is now resolved).
> Canonical roadmap lives in `economy-simulation-vision.md` §13 (2026-06-26 callout) +
> `negative-space-economy.md`. Delete once Stage 1 ships and the design moves to an active spec.

## TL;DR
The Phase-1 logistics A/B/C fork is **resolved** by a deeper realisation: the recurring "seed bug"
pain has one root — **the seeder is a lossy second implementation of faction agency.** It
hand-authors a mature industrial base no agency actually built, so it over-produces raws and starves
manufactured goods, and we keep debugging the artifacts. Fix: **stop hand-authoring the mature
galaxy.** Seed small self-sufficient cores; let the *live agency* grow the mature state via an
age-forward harness. This re-sequences SP5 autonomic-light into **Stage 1 (seed-coherence
foundation)** then **Stage 2 (emergent territory)**, and makes build-recovery load-bearing for
generation itself.

## Banked (not in question)
- **`main`**: seed-staffing fix shipped (`263aea8`). Independent, done.
- **`feat/sp5-logistics`** (HEAD ≈ `5b01fa9`): logistics Phase 1 (engine + processor + wiring +
  anchor-relative surplus/deficit). Tested, tsc-clean, **unmerged**. Kept as the silent workhorse
  engine — the harness needs it. Phases 2–4 (Contracts/UI) **deferred** until the world model settles
  (the map is about to become dynamic).

## Why the pivot (the investigation, condensed)
- **Bifurcated economy:** raws over-produced 2.5–4.4× (deposit-maxed extraction); manufactured goods
  P/C 0.08–0.77 (genuinely scarce).
- **Root = the seed allocator** (`lib/engine/industry-seed.ts`): tier-0 extractors sized to *deposit
  caps* with output overridden up 4–8× (`industry.ts` `OUTPUT_OVERRIDES`); tier-1+ factories a flat
  ~2 (`MANUFACTURER_BASE_COUNT`), gated on **local input self-sufficiency**
  (`inputsLocal = every recipe input locally produced`). Manufactured scarcity tracks **recipe
  depth** almost perfectly (targeting_arrays 0.08 needs the whole vertical stack local;
  chemicals/polymers 0.77/0.70 need only two raws) — the input-consistency gate is the dominant
  driver.
- **The agency-allocator insight:** the seeder places industry where the *ground + local inputs*
  permit, not where a *deciding faction* would (a faction builds an import-fed forge world; the gate
  forbids seeding that). A faction wouldn't build assuming imports — it would *know*. So either the
  seeder becomes the agency model (duplication) or it stops making agency decisions. We choose the
  latter.
- **Tier-0 glut is mostly a symptom:** industrial-raw gluts (minerals 4.4, ore 3.3, gas 2.9) are the
  missing-manufacturing-draw — raise manufacturing and they shrink. Civilian-raw surplus (food/water
  2.5×) is partly the *intended* export logistics carries (negative space). So **don't recalibrate
  tier-0 in isolation** (symptom + negative-space guardrail).
- **Hop-cap finding:** logistics `MAX_HOPS = 4` (`constants/directed-logistics.ts`) is partly a real
  BFS-precompute bound (`computeBoundedHopDistances`, cost ~`V × branching^maxHops`), but it silently
  under-serves manufactured goods (a lone producer is often 6–10 hops away). The cost model
  (`qty × distance`) is the better limiter; raise the hard cap as perf allows. Revisit in Stage 1.

## The decision
- **Seeder shrinks** to placing a few (≤5) **self-sufficient subsistence cores** per faction on an
  otherwise **inert frontier** (no pop, no industry). Self-sufficiency is the rule-free base case — a
  closed local loop needs no agency judgment, so the seeder never makes an agency decision. New
  start-point: between "mostly empty" and today, leaning emptier.
- **Build planner owns industry-allocation** (moved out of the seeder). Demand-driven where the
  seeder was deposit-driven; it's the live agency, used both to grow live *and* to age the seed.
- **Age-forward snapshot harness:** extend the simulator (it already runs economy / logistics / decay
  / migration in-memory) to run the full agency stack N-thousand ticks, then **snapshot the matured
  state back as the canonical seed.** Deterministic (seeded RNG). The mature galaxy is *grown by the
  rules*, not hand-authored → guaranteed coherent, inspectable, and the test instrument for
  everything.
- **Build-recovery is load-bearing for generation itself** — pays off twice (live durable-core
  recovery + the galaxy-aging engine). This resolves the original A/B/C fork onto build-recovery.

## Stage plan (within SP5 autonomic-light)
**Stage 1 — seed-coherence foundation.** Minimal subsistence-core seeder + inert owned frontier ·
age-forward snapshot harness (simulator extension + snapshot-back write path) · autonomic-light
**build-up** — the up-arrow to SP3.5 decay's down-arrow: free, capacity-bounded, **2 priorities**
[subsistence: build what you chronically lack and *can* make locally; develop-deposits: build out
rich unexploited resource bases], builds industry + housing together (staffing-consistent,
`labourDemand ≤ popCap`). Removal stays disuse-decay. **Validate:** age a minimal-core seed forward →
the galaxy grows into a coherent mature state (no collapse / runaway / phantom industry) AND logistics
demonstrably moves surplus→deficit so the suppliable middle survives as it develops.

**Stage 2 — emergent territory.** Faction-gen leaves space **un-owned** (un-owned systems don't exist
today — every system is partitioned at seed; this is a gen change, and it's what makes the galaxy
emptier / more interesting) · a **dynamic-`factionId` membership primitive** (shared with future
capture / rebellion; the layering-audit `getOpenEdges()` cache-invalidation concern lands here) ·
**colonisation** of un-owned systems (decision: which adjacent un-owned system by resource value /
fills-a-need / distance; bootstrap = the same subsistence-core logic) · validate via the harness
(factions spread sanely, borders emerge).

## Explicitly OUT (the stop line)
Deliberate demolish-for-redeployment · treasury / money / construction-input gating · build-planner
priorities 3–4 (bottleneck relief, strategic / military) · doctrine / government weighting · logistics
Contracts/UI (P2–4) · military ceiling · events · war. All ride with full faction agency or later.

## Canonical re-sequenced order
SP1 ✅ · SP2 ✅ · SP3 ✅ · SP3.5 ✅ · seed-fix ✅ · logistics P1 ✅ → **Stage 1 → Stage 2** →
logistics P2–4 → SP4 viability → full faction agency (treasury, planner priorities 3–4 incl.
deliberate demolish, doctrine, military ceiling) → events → war capstone → Layer 3+ resumes.

## Open questions for the Stage 1 design doc (next)
- **Build target (the crux):** what does a system build toward — local demand, deposit potential,
  faction-wide demand, or a blend? This single definition *is* the planner; everything else is
  plumbing + the decay-mirror.
- **How small the core:** literally one system, or a small self-supporting cluster (lean: a few, ≤5)?
  Cluster is cooler, but each core must be self-sufficient (not specialised) to stay rule-free.
- **Age-forward harness:** determinism + 10K-scale runtime of the snapshot run; how many ticks to a
  "good" maturity; reuse of the simulator tick loop + the snapshot-back write path.
- **Build rate / cadence** and the interaction with staffing self-consistency (build housing +
  industry together).
- **Hop cap:** raise `MAX_HOPS` / lean on the cost model; measure the BFS precompute at 10K.
- **(Stage 2 preview)** how faction-gen leaves space un-owned without breaking region / map / render
  assumptions.

## Next action
Design doc (`sp5-stage1-seed-coherence-design.md`) and the first implementation plan
(`sp5-stage1-build-engine-impl-plan.md` — the pure engine, 5 TDD tasks) are **written + committed** on
`feat/sp5-autonomic-light` (renamed from `feat/sp5-logistics`). **Resume = subagent-execute the
build-engine plan.** Then the follow-on plans, in order: processor body + in-memory adapter + sim wiring
→ live Prisma adapter + registry → minimal-core seeder → age-forward harness → validation pass. UI is
deferred + display-only (a small Industry-tab direction cue — developing/stable/declining — once build
goes live; no construction queue, `count` is a continuous Float).
