# Colony Bootstrapping — Build Plan

> Transient build plan for the colony-bootstrapping redesign. Implements
> [`docs/planned/economy-colony-bootstrapping.md`](../planned/economy-colony-bootstrapping.md) (design +
> the resolved §7 decisions). **Delete when the feature ships** — the functional spec moves to `docs/active/`
> and the code becomes the source of truth.

## Success criteria — the whole stream is "done when"

1. Colonies form and build **sensible first industries** (not import-everything).
2. Colonies **don't build things that immediately fail** because pops migrate away.
3. Colonies get a **reasonable, steady** stream of construction points.
4. The **local-industry-vs-imports spread is more even** — building beats importing-everything-and-stagnating.

Validated via the simulator (the real tick) plus unit tests per PR; final calibration (PR4) tunes coefficients
to hit all four at once. Coarse health bar only until PR4 — no premature precision.

## Approach

The **roadmap and sequencing are fixed here now; code-level detail is written just-in-time** — each PR's
detailed section is filled in immediately before we build it, so it reflects what actually shipped before it
(later PRs depend on the exact shapes earlier ones land). **PR1 is detailed now; PR2–PR4 are outlined.**

Work lands on the shared feature branch `feat/economy-rework-base`; each PR is a phase branch squash/ff-merged
in (per the workflow conventions).

## Roadmap

- **PR1** — Build correctness + the development stat (+ development map mode)
- **PR2** — Job-aware population
- **PR3** — Colony seeding, pricing & budget fairness (may split 3a/3b)
- **PR4** — Calibration
- *(+ end-of-stream UI surfacing: migration statistics, employment state, pool-floor readouts, map polish)*

---

## PR1 — Build correctness + the development stat (+ dev map mode)

**Goal / outcomes:** colonies build sensible first industries instead of importing everything (outcomes 1 & 4);
introduce the per-system **development** primitive that PR3's pool floor also depends on; ship a development map
mode as the visual sanity-check on the new stat.

### 1. Per-system development stat (new primitive)

- New pure function `systemDevelopment(system): number` → `0..1` (0 = raw frontier, ~1 = maxed-out). Home in
  `lib/engine/development.ts`.
- **Formula (built): an ABSOLUTE magnitude — how much a system has actually built and worked —
  soft-saturated against a FIXED reference, NOT a fill fraction of the system's own potential.** This follows
  how EU4 / EU5 (Project Caesar) / Victoria 3 all quantify development: magnitude and fill are *separate*
  signals, and development is always the absolute one; a self-normalised fill makes a tiny "full" colony read
  as developed (the naïve bug this replaced). Housing is excluded from both terms, so shells built ahead of
  population never inflate the reading.

  ```
  popTerm     = 1 − exp(−population / POP_REF)                     // absolute resident pop, soft-saturated
  indTerm     = 1 − exp(−staffedIndustry / INDUSTRY_REF)          // absolute STAFFED industry (used, not built), soft-saturated
  development = w_pop · popTerm  +  w_ind · indTerm                // w_pop + w_ind = 1; default 0.5/0.5, PR4-tuned
  ```

  where `staffedIndustry = (extractorLevels·footprint + non-housing general-space used) × labourFulfil`.

- **Design intents baked in:**
  - *Absolute, not relative.* A small colony has little in absolute terms → reads low → prioritised; a large
    capital reads high regardless of its own headroom. Soft-saturation is most sensitive at the low end (so it
    discriminates among colonies) and compresses the top (capitals sit high, not trivially at 1).
  - *Used, not built.* Industry is discounted by headcount staffing (`labourFulfil`), so idle-because-
    understaffed capacity is not development — an over-built colony reads low until pop staffs it.
  - *Housing-immune.* `popTerm` uses actual `population`, not built housing; housing is netted out of industry.
- **Barren-world edge case:** when there is no habitable land (`habitableSpace ≤ 0`, no population possible),
  drop the pop term and let `indTerm` carry the whole reading — a barren extraction colony's development *is*
  its extraction.
- **Reference constants** (`lib/constants/development.ts`, PR4-tunable): `POP_REF` / `INDUSTRY_REF` are the
  "fully developed system" magnitudes (grounded in observed sim p90s: homeworld pop ≈ 240 / industry ≈ 22),
  plus the `w_pop` / `w_ind` weights (per-doctrine-ready, §4 rubric; default 50/50). Potential
  (slotCap / generalSpace) is deliberately *not* an input — reserved for a future saturation / growth-headroom
  signal, per the EU5 split of "how developed" (absolute) from "how crowded" (fill).
- The map mode (§4 below) is the validation surface — this is why it's in PR1. It reads systemDevelopment as
  an ABSOLUTE 0..1 value (no relative-to-visible-max normalisation).
- **Distinct from `SystemControl`.** `developed` is a one-way ownership gate; `systemDevelopment` is the
  continuous magnitude the redesign needs (§7.7b).

### 2. Flow-aware deficit cancellation (§3.1)

- Change `findStructuralDeficits` (`lib/engine/directed-build.ts:177-205`): replace the existence test
  (`exporters.some(reachable)`) with **coverage netting**.
- First cut, per good: `coveredFraction = min(1, Σ reachable-exporter-spare / Σ reachable-deficit)`; residual
  demand `= deficit·(1 − coveredFraction)` is structural → buildable locally. Use `surplusDrawable` (already
  used at `:459`) for exporter spare. `exporterSystemsByGood` gains a spare magnitude alongside `systemId`.
- Keep it O(goods·systems) — cheap enough for the per-pulse planner.

### 3. Development-scaled speculative local-industry nudge (§3.2)

- In the build planner, add a **bounded** impulse for undeveloped systems to stand up tier-0 local extraction
  from their **own deposits**, scaled by `(1 − systemDevelopment)` — strong when young, fading as it matures.
  Bounded (a floor, not autarky) so specialisation survives.
- Bias toward **un-repurposable basics** (food/water) per §7.7 — importing a basic you have a deposit for is
  pure waste.

### 4. Development map mode (UI)

- New map mode colouring systems by `systemDevelopment` (a sequential colour ramp + legend).
- **Data path: dynamic, tick-invalidated — not the static atlas.** Development changes as systems grow, so it
  rides a dynamic read path / tick-keyed query, consistent with visibility/dynamic map data. Verify against
  `docs/active/engineering/map-data-loading.md` at build start.
- Add the mode to the existing map-mode enum/toggle scaffolding; no bespoke map surface.

### Tests

- **Unit:** flow-aware cancellation leaves a residual structural deficit when exporter surplus only partly
  covers demand, and none when fully covered; the speculative nudge scales down as development rises;
  `systemDevelopment` is monotonic in population/industry and stays in `[0,1]`.
- **Sim (real tick):** mean colony industry-level floor rises vs baseline; the zero-industry-colony count
  drops; the import-everything share falls (outcomes 1 & 4).
- **Manual:** the dev map mode renders a sane gradient (homeworlds hot, frontier cold, colonies warming as
  they grow).

### Done when

Colonies build a sensible first-industry floor in the sim; the dev map mode is visually sane; unit + sim green;
`tsc` clean; `npx next build --webpack` clean.

---

## PR2 — Job-aware population *(outline — detail JIT)*

- **Surface a real job-openings signal** per system (labour demand vs employed pop). Today
  `computeLabourAllocation` (`industry.ts`) is display-only; promote the openings/shortage number into a value
  migration and population dynamics can read.
- **Jobs into `migrationAttractiveness`** (§7.5) so a jobless colony isn't a magnet; **target-side throttle**
  (§7.4) so flow is capped by the target's absorptive capacity, not just source size + absolute headroom;
  **jobless colonists drift out** toward openings.
- Files: `lib/engine/migration.ts` (attractiveness + throttle), `lib/constants/population.ts` (weights),
  `lib/engine/industry.ts` (expose openings), `lib/tick/processors/migration.ts`.
- Tests: a big source no longer floods a small attractive colony; a jobless colony scores lower than a jobbed
  one; unemployed pop migrates toward openings. Sim: no roller-coaster (colony pop doesn't overshoot then
  collapse). Outcome 2.

## PR3 — Colony seeding, pricing & budget fairness *(outline — detail JIT; may split 3a/3b)*

- **Seeding (3a):** small deliberate seed (≈1–2 pops) drawn from the source's **unemployed** first; seed
  model C (tiny seed + job-aware migration grows it). Adjust `COLONY_SEED_POP` + `applyDevelopments` seed
  sizing (`lib/world/tick.ts`).
- **Pricing (3a):** seed-pop opportunity cost = the source's forgone output, netted into colony value on the
  **benefit** side (§7.3), in `colonisation-value.ts` / `directed-build.ts`.
- **Budget fairness (3b):** **development-scaled pool floor** (§3.4 / §7.9) in `construction.ts` `fundQueue`
  — a guaranteed minimum slice for colonies-with-proposals, biggest for the youngest, self-weaning as they
  develop. **Player-directed founding** (§3.5, EU5-style): player picks in the shared queue fund ahead of the
  marginal AI pick; automation is a toggle.
- Tests: seed sized to source unemployed; seed-pop cost shifts colony-vs-build ordering under a scarce pool;
  the floor guarantees a colony ≥ its development-scaled minimum; a player pick funds ahead of the marginal AI
  pick. Outcomes 2 & 3.

## PR4 — Calibration *(outline — detail JIT)*

- Tune coefficients (development blend, speculative floor size, seed-pop weight, pool-floor generosity,
  migration weights + throttle) against the sim to hit all four success criteria simultaneously. Add a sim
  metric when a symptom hides in aggregate (e.g. local-vs-import share, colony pop stability/variance). Coarse
  health bar per the calibration convention — precision tuning is perishable and deferred.
