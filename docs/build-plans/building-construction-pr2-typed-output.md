# Building & Construction Model — PR2: Typed-Output Building Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement
> each task (failing test → code → green). Steps use checkbox (`- [ ]`) syntax for tracking. Overview
> & PR sequence: `docs/build-plans/building-construction-model-plan.md`. Design spec:
> `docs/planned/building-construction-model.md`.

**Goal:** Give every building type a single typed `output` discriminated union
(`market_good | capacity | modifier | none`) and collapse the per-type "used" branching that is
duplicated across the decay engine and the industry-read service into **one** dispatch function keyed
off `output.kind`. Abstract outputs (housing pop-cap, academy skill-licences, complex %-buff) become a
first-class **capacity/modifier** category with no market/price/stock coupling. **Counts stay
fractional; no `World`-shape change; no save bump.** This is a green refactor that dissolves the
special-cases PR3 would otherwise carry into the discrete-level teardown, and produces the
`computeUtilization(...) → [0,1]` primitive PR3's whole-level decay reads.

**Architecture:** Today the "how much of this building is actually in use" quantity is computed twice,
by two functions that branch on building type:
- `computeSystemDecay` (`lib/engine/infrastructure-decay.ts`) — the decay-relevant `used`, five
  branches (housing occupancy / vocational licence-draw / research licence-draw / complex family-draw /
  producer staffed-and-selling).
- `buildIndustryReadout` (`lib/engine/industry.ts`) — the display `used`, three branches (housing /
  complex / everything-else-as-producer). **Note the pre-existing divergence:** the readout has no
  academy branch, so it treats academies as tier-0 producers (`used = count × labourFulfil`), whereas
  decay measures them by licence-draw. PR2 removes the divergence by routing both through one function.

PR2 introduces `buildingUsed(type, count, ctx)` in `lib/engine/industry.ts` — the single per-`output.kind`
dispatch returning the absolute in-use amount (housing can exceed its own count → the occupancy
overshoot the readout's health colour already keys off) — and `computeUtilization(type, count, ctx)`
= `count > 0 ? min(1, buildingUsed / count) : 0`, the `[0,1]` ratio PR3 consumes. Both existing call
sites build a small `UtilizationContext` (they already compute every field) and call `buildingUsed`;
the surrounding display-only derivations (staffedFraction, idleReason, the real production rate) stay
where they are.

**What is *not* touched (deliberately):** the production formula `buildingProduction`
(`count × outputPerUnit × effectiveFulfilment × yield × familyAnchorBuff`) is left exactly as-is —
`outputUptake` remains a selling/decay signal, never a production multiplier (see the comment in
`lib/tick/processors/economy.ts`). "Unify the economy read" here means the **industry read service**
(`buildIndustryReadout`), not the production math. Folding uptake into production would be a behaviour
change PR2 forbids.

**Tech Stack:** TypeScript 5 (strict), Vitest 4, Next.js 16. Pure engine (`lib/engine/*`) + one
constant catalog (`lib/constants/industry.ts`). No adapter, world, or save change.

## Global Constraints

Inherit **all** constraints from `building-construction-model-plan.md → Global Constraints` (no `as` /
no `unknown` / no postfix `!` except `find(...)!` in tests / JSON-serializable `World` / seeded
determinism / discriminated unions / coarse-calibration-only / present-tense docs / branch & commit
rules). PR2-specific:

- **`output` is a required field** on `BuildingTypeDef` — no optional `?`. Every catalog entry
  (production, complex, housing, both academies) sets it; `tsc --noEmit` is the backstop.
- **Discriminated union, not a `{ kind: string; …optional }` bag** — `BuildingOutput` is a true
  discriminated union; consumers `switch`/dispatch on `output.kind` with exhaustive handling.
- **No `World`-shape change, no save bump.** `output` lives in the constant catalog, not world state.
  `WorldBuilding.count` stays fractional. Saves are unaffected.
- **Behaviour preservation is asserted, not assumed.** Every unified branch has a test that pins
  `buildingUsed` to the *old* per-type formula's value on the same input (coherence witness). The one
  intentional exception is the academy readout row (see Task 4 / the decision below), which is a
  display-only coherence fix, flagged and test-updated explicitly.

---

## File-by-file map

| File | Change |
|---|---|
| `lib/constants/industry.ts` | **+** `CapacityKind`, `BuildingOutput` unions; **+** required `BuildingTypeDef.output`; populate it in `buildProductionTypes` (market_good), `buildComplexTypes` (modifier), housing (capacity `pop_cap`), vocational (capacity `skill1_licence`), research (capacity `skill2_licence`). `outputGood` stays (additive; unchanged readers). |
| `lib/engine/industry.ts` | **+** `UtilizationContext`; **+** `buildingUsed(type, count, ctx)` (single per-`output.kind` dispatch, absolute used); **+** `computeUtilization(type, count, ctx)` (`[0,1]`); move `housingUsed` here; `buildIndustryReadout` routes its three `used` computations through `buildingUsed`. |
| `lib/engine/infrastructure-decay.ts` | `computeSystemDecay`'s five-branch `if/else` collapses to one `buildingUsed` call per building; build the `UtilizationContext` once. Re-export `housingUsed` (or update its test import). `productionUsed`/`decayedCount`/`disuseDecay`/`unrestDecay` unchanged. |
| `lib/engine/__tests__/industry.test.ts` | **+** `buildingUsed`/`computeUtilization` coherence witnesses (one per kind, incl. housing overshoot → util 1); update the academy readout-row expectation (Task 4 decision). |
| `lib/engine/__tests__/infrastructure-decay.test.ts` | Stays green (decay identical); **+** a mixed-base witness that the unified path equals the old per-type values. |
| `lib/constants/__tests__/industry.test.ts` | **+** every catalog entry has an `output`; kinds map correctly (market_good.goodId === outputGood; housing/academies → capacity kinds; complexes → modifier). |
| Active docs | Only if a doc now misdescribes the code. `economy-infrastructure-decay.md` describes "used" per role — light touch to name the unified typed-output dispatch if needed; no behaviour prose changes. Full doc promotion is PR4. |

---

## The `BuildingOutput` shape (Interface PR2 produces)

```ts
export type CapacityKind = "pop_cap" | "skill1_licence" | "skill2_licence";

export type BuildingOutput =
  | { kind: "market_good"; goodId: string }   // extractors, factories — priced, sold (today's behaviour)
  | { kind: "capacity"; capacity: CapacityKind } // housing pop-cap, academy skill licences — un-priced balance
  | { kind: "modifier"; family: string }       // specialisation complex — `family` = its complexType id
  | { kind: "none" };                          // employment/holding only — no current type; default body
```

```ts
export interface UtilizationContext {
  buildings: Record<string, number>;   // the whole built base (for familyThroughput)
  population: number;
  parts: LabourParts;                  // headcount + skill demand/cap totals (one pass)
  state: LabourState;                  // the three fulfilment ratios
  outputUptake: (goodId: string) => number; // seller-side ∈ [0,1]; missing ⇒ 1
}
```

`buildingUsed` dispatch (each body === today's formula, so decay stays byte-identical):

| `output.kind` | `buildingUsed(type, count, ctx)` |
|---|---|
| `market_good` | `productionUsed(count, effectiveFulfilment(state, tier(goodId)), ctx.outputUptake(goodId))` |
| `capacity` · `pop_cap` | `housingUsed(population)` = `max(0, population) / POP_CENTRE_DENSITY` (may exceed count → overshoot) |
| `capacity` · `skill1_licence` | `count × (parts.skill1Cap > 0 ? min(1, parts.skill1Demand / parts.skill1Cap) : 0)` |
| `capacity` · `skill2_licence` | `count × (parts.skill2Cap > 0 ? min(1, parts.skill2Demand / parts.skill2Cap) : 0)` |
| `modifier` | `complexUsed(count, familyThroughput(buildings, COMPLEX_BY_TYPE[output.family]), ANCHOR_RATED_COVERAGE)` |
| `none` | `count × state.labourFulfil` (unexercised — no `none` type exists post-PR1) |

`computeUtilization(type, count, ctx) = count > 0 ? Math.min(1, buildingUsed(type, count, ctx) / count) : 0`.
Decay's disuse gap `max(0, count − used)` is identical whether it reads raw `buildingUsed` or
`count × computeUtilization`, because both floor the idle gap at 0 — so decay reads raw `buildingUsed`
(exact preservation) and `computeUtilization` is the clamped projection PR3 will consume.

---

## Tasks

### Task 1 — Typed `output` union + populate the catalog

- [ ] **Test** (`lib/constants/__tests__/industry.test.ts`): every value of `BUILDING_TYPES` has an
  `output`; `buildProductionTypes` entries are `{kind:"market_good", goodId}` with `goodId === outputGood`;
  `housing` → `{kind:"capacity", capacity:"pop_cap"}`; `vocational_school` → `skill1_licence`;
  `research_institute` → `skill2_licence`; each complex → `{kind:"modifier", family: <its complexType>}`.
- [ ] Add `CapacityKind` + `BuildingOutput` types; add required `output: BuildingOutput` to
  `BuildingTypeDef`; populate in the two builders + the three literal entries. `outputGood` stays.
- [ ] **Verify:** `npx vitest run lib/constants/__tests__/industry.test.ts` green; `npx tsc --noEmit`
  lists any unset entry.
- [ ] Commit: `feat(industry): typed building output discriminant`.

### Task 2 — `UtilizationContext` + `buildingUsed` + `computeUtilization`

- [ ] **Test** (`lib/engine/__tests__/industry.test.ts`): for a mixed base, `buildingUsed` equals the
  old per-type formula for each kind — producer `count × min(effectiveFulfilment, uptake)`, housing
  `population / POP_CENTRE_DENSITY` (incl. an overshoot case where it exceeds count), vocational
  `count × min(1, s1Demand/s1Cap)`, research analogous, complex `complexUsed(...)`. Assert
  `computeUtilization` = `min(1, buildingUsed/count)` and that housing overshoot → util `1` while
  `buildingUsed > count`.
- [ ] Move `housingUsed` into `lib/engine/industry.ts` (it needs only `POP_CENTRE_DENSITY`, already
  imported); add `UtilizationContext`, `buildingUsed` (dispatch table above, reusing `productionUsed`,
  `complexUsed`, `familyThroughput`, `effectiveFulfilment`), and `computeUtilization`.
- [ ] **Verify:** `npx vitest run lib/engine/__tests__/industry.test.ts`; `npx tsc --noEmit`.
- [ ] Commit: `feat(industry): unified buildingUsed + computeUtilization dispatch`.

### Task 3 — `computeSystemDecay` consumes `buildingUsed` (decay unification)

- [ ] **Test** (`lib/engine/__tests__/infrastructure-decay.test.ts`): existing suite stays green; add a
  mixed-base witness asserting the post-refactor `newCounts` equal the pre-refactor per-type values
  (housing + both academies + a complex + producers in one system).
- [ ] Replace the `for` loop's five-branch `used` selection in `computeSystemDecay` with: build
  `ctx: UtilizationContext` once (`{ buildings, population, parts, state, outputUptake: input.outputUptake }`),
  then `const used = buildingUsed(type, count, ctx)`. Keep `decayedCount`, the `next < count` guard, and
  the `popCap` recompute unchanged. Re-export `housingUsed` from this module for its existing test import
  (or update the import).
- [ ] **Verify:** `npx vitest run lib/engine/__tests__/infrastructure-decay.test.ts
  lib/tick/processors/__tests__/infrastructure-decay.test.ts`; `npx tsc --noEmit`.
- [ ] Commit: `refactor(decay): route computeSystemDecay through buildingUsed`.

### Task 4 — `buildIndustryReadout` consumes `buildingUsed` (read-service unification)

**Decision to confirm before coding (see below):** unifying the readout makes the academy row's `used`
read as **licence-draw** (matching decay + the typed model) instead of today's tier-0-producer staffing
proxy. This is a display-only coherence fix — the one intentional behaviour change in PR2.

- [ ] **Test** (`lib/engine/__tests__/industry.test.ts`): readout housing/complex/producer rows stay
  identical; housing overshoot still yields `used > count` (→ `buildingHealth` "declining"). Update the
  academy row expectation to licence-draw `used`; `staffedFraction` stays `labourFulfil` (the staffing
  bar), matching the producer pattern (staffedFraction = staffing, used = utilisation).
- [ ] In `buildIndustryReadout`, build the `UtilizationContext` once (with an `outputUptake` closure
  reproducing the inline band-derived uptake: `maxStockOf?.(g) !== undefined ? outputUptake(stockOf(g),
  minStockOf(g), maxStock) : 1`), and replace the three inline `used` computations with `buildingUsed`.
  Keep `staffedFraction`, `idleReason`, and the real-production `output` derivations. The academy now
  routes through the capacity branch rather than the producer `else`.
- [ ] **Verify:** `npx vitest run lib/engine/__tests__/industry.test.ts lib/engine/__tests__/tick.test.ts`;
  `npx tsc --noEmit`.
- [ ] Commit: `refactor(industry): route buildIndustryReadout through buildingUsed`.

### Task 5 — Full verification gate + doc touch

- [ ] `npx vitest run` (all green), `npx tsc --noEmit` (clean), `npx next build --webpack` (succeeds),
  `npm run simulate` (completes, no `NaN`/`Infinity`/runaway — coarse sanity only).
- [ ] Doc touch only if a doc now misdescribes the code (present-tense; no change-history). Candidate:
  `economy-infrastructure-decay.md` "used depends on the building's role" prose — reword to the typed
  `output`-kind dispatch if it reads as per-type branches. No behaviour prose changes. Full promotion is PR4.
- [ ] Commit (if docs touched): `docs(economy): describe typed-output utilization dispatch`.

---

## Open decision (raise with the human before Task 4)

**Should PR2 unify the industry read service too, accepting the academy display coherence fix?**

- **Unify both (recommended).** Decay + readout route through one `buildingUsed`; the academy row's
  `used` becomes licence-draw, matching decay and the typed model (academy output = `capacity` ·
  `skill_licence`, utilised by licensed skilled work, not by unskilled staffing). Fixes a real
  pre-existing incoherence and leaves PR3 with a single "used" source. Cost: one display-only expectation
  change on the academy readout row.
- **Decay-only.** Unify just `computeSystemDecay`; leave `buildIndustryReadout` as-is (academy stays a
  tier-0-producer proxy). Zero display change, but the readout keeps its own `used` branches and the
  academy divergence persists into PR3.
