# Developed-Gate + Trade-Flow Removal — Design Spec

> **Status:** Design spec (transient build-plan — delete once the feature ships and the behaviour is
> reflected in the active docs + code). Follows the building-construction control-flag work
> (`docs/build-plans/building-construction-*`). Successor to PR #146 (control flag); assumes #146 is
> merged into the shared branch first.

## Problem

PR1 introduced the three-state ownership flag `control ∈ {unclaimed, controlled, developed}` and gated
the **build** layer on `control === "developed"`. But every *other* economy processor still treats a
`controlled`-but-undeveloped system as a live economy. Symptom the user hit: **controlled worlds with an
active population, market, and logistics but no industry** — population arriving in systems that have no
housing.

Confirmed root cause: a claimed system flips to `controlled` but keeps its substrate-derived `popCap > 0`
(world-gen zeroes population + buildings, not `popCap`) and its full seeded market rows. **Migration**
moves population toward any same-faction open-edge neighbour with positive headroom (`popCap −
population`), and a fresh controlled system (population 0, unrest 0, `popCap > 0`) is *maximally*
attractive — so migration seeds it, then normal growth compounds it. Normal growth can never *start*
population there (it needs both `popCap > 0` **and** `population > 0`), which is why growth-without-housing
looked impossible: the vector is migration, not growth.

## Goal

Only `developed` systems participate in the economy. `controlled` and `unclaimed` systems are
economically **inert** — their seeded market rows simply freeze; no population, migration, production,
consumption, or logistics. UI: a non-developed system shows only **Overview + Astrography**; the
Population/Industry/Logistics/Market tabs are hidden. Add a **tripwire invariant test** so any future
mechanic that leaks activity into a non-developed system fails loudly in CI.

Separately (and first, so we don't gate a doomed processor): **delete the trade-flow processor**. It does
continuous every-tick price-gradient diffusion between adjacent markets — a market-equilibration mechanic
with no place in the grand-strategy direction (the pricing model is being rewritten; goods-movement is
directed-logistics' job). This is a deliberate behaviour change, not a no-op: it removes price-diffusion
and empties the "Trade Flows" market overlay. The user has explicitly opted into that.

## Non-goals

- No change to the pricing model (that is a separate, later rework).
- No change to `directed-logistics`' mechanism (it stays the sole goods-mover).
- No compiler-enforced "developed system" type (branded type). The shared predicate + tripwire test is
  the chosen forget-proofing; a type-level upgrade is a future option if the economy grows enough to
  warrant it.
- No "goods transit through controlled space" routing model (YAGNI at this sparse early stage).

## Global constraints

Inherit the project conventions: no `as` (except `as const` / `lib/types/guards.ts`), no `unknown`
(except narrowed JSON.parse boundaries), no postfix `!` except `find(...)!` in tests, `World`
JSON-serializable (no `Map`/`Set`/`Date`/`Infinity`/`NaN`), seeded-determinism in tick bodies,
discriminated-union result types, present-tense active docs. Gates: `npx tsc --noEmit` + `npx vitest run`
green per task; PR boundary adds `npx next build --webpack` + `npm run simulate` (coarse: no
`NaN`/`Infinity`/runaway; controlled/unclaimed systems stay at population 0).

---

## Part 1 — Delete the trade-flow processor (do this first)

Three unrelated things share the `trade-flow` name; only the **processor** goes.

**DELETE (processor-exclusive):**
- `lib/tick/processors/trade-flow.ts` (`runTradeFlowProcessor`)
- `lib/tick/adapters/memory/trade-flow.ts` (`InMemoryTradeFlowWorld`)
- `lib/tick/world/trade-flow-world.ts` — **but relocate `EdgeView`** first: it is imported by the KEEP
  set (`trade-flow-topology.ts`, the migration adapter, `tick.ts`). Move `EdgeView` into
  `trade-flow-topology.ts` (or a neutral shared types module) so migration/topology/tick keep compiling.
- `lib/tick/processors/__tests__/trade-flow.test.ts`
- `lib/engine/__tests__/trade-flow-integration.test.ts`
- In `lib/world/tick.ts`: the `runTradeFlowProcessor` import (~:52), the `InMemoryTradeFlowWorld` import
  (~:63), the `TRADE_SIMULATION` import (~:31, only if unused after removal — verify), the trade-flow
  **stage block** (~:611-634), the `"trade-flow"` push into `processorsRun`, and the stage-order doc
  comments (~:9-11, ~:466-468). **Keep** the `openEdges` computation (~:597-598) and its import (~:39-40)
  — migration needs it; reword the "migration & trade-flow share one open-edges computation" comment.

**KEEP (shared / independent, despite the name):**
- `lib/tick/world/trade-flow-topology.ts` (`buildOpenEdges`) — migration uses it.
- `lib/services/trade-flow.ts` (`getTradeFlowEdges`, `getSystemLogistics`) — backs the Logistics panel +
  the flow-overlay endpoint; computes from world/market state, not the processor. (Its market-edge half
  reads processor-written `flowType:"market"` rows; with the processor gone those are always empty, so
  `marketEdges` becomes `[]` — no compile break; the logistics half is unaffected.)
- `lib/engine/trade-flow-edges.ts`, `lib/engine/system-trade-flow.ts` — overlay/panel aggregators (also
  serve logistics).
- `lib/tick/shard.ts`, `lib/engine/market-pricing`, the `flowEvents` array + `WorldFlowEvent.flowType`
  field — shared; directed-logistics writes `"logistics"` rows into `flowEvents`.
- Tests: `trade-flow-topology.test.ts`, `services/__tests__/trade-flow.test.ts`,
  `trade-flow-edges.test.ts`, `system-trade-flow.test.ts`.

**UPDATE:**
- `lib/world/__tests__/tick.test.ts` (~:162, "trade-flow/directed-logistics: produces flow events…") —
  revise the market-flow expectations to logistics-only.

**Strip the now-dead "Trade Flows" market overlay (UI cleanup — the market half only):**
- Remove the `tradeFlow` overlay key + its control row/legend (`use-map-overlays.ts`,
  `map-overlay-controls.tsx`, the market `TradeFlowLegend`).
- Simplify `useTradeFlow` to logistics-only (drop the market-active arg + `marketEdges`).
- Drop `flowEdges`/`tradeFlowEdges` from `use-map-data.ts` + the `MapData` type; keep
  `logisticsFlowEdges`.
- Drop the market `TradeFlowLayer` instance + `MARKET_FLOW_CONFIG` in `pixi-map-canvas.tsx` (keep the
  `TradeFlowLayer` class + `LOGISTICS_FLOW_CONFIG` for the logistics overlay).
- Optionally drop `TradeFlowEdges.marketEdges` from the API type + `getTradeFlowEdges`'s market branch.
- Keep `queryKeys.tradeFlow` + its `economyTick` invalidation (still backs the logistics overlay via the
  same hook).

---

## Part 2 — The developed-gate (economy processors)

**The rule, once.** New pure helper `lib/engine/control.ts`:
```ts
import type { SystemControl } from "@/lib/world/types";
/** A system participates in the economy (population, migration, market, logistics) only once developed.
 *  unclaimed + controlled systems are inert: their seeded markets freeze and no population settles. */
export function isEconomicallyActive(control: SystemControl): boolean {
  return control === "developed";
}
```
Takes a `SystemControl` value, so both the Sim-row processor bodies and the `WorldSystem`-based services
call the same predicate. Nothing hard-codes `=== "developed"` anymore (the build gate in
`directed-build.ts` may also adopt it for consistency).

**Gate the economy inputs in one region of `runWorldTick`.** After `systems`/`markets`/`openEdges` are
built, derive the active set once and feed the economy-family processors from it, while `directed-build`
keeps the full `systems` (it needs unclaimed/controlled for claim/develop):
- **Economy** ← developed systems only (+ their markets). Infrastructure-decay and population follow
  automatically — they key off economy's processed-system signal set, so gating economy cascades to both.
- **Migration** ← open-edges filtered so an edge is open only when **both** endpoints are developed. This
  plugs the leak (migration ignores markets; the edge set is the only lever).
- **Directed-logistics** ← developed participants only.

Exact wiring (pre-filter the rows/edges handed to each adapter vs. filter inside the adapter's selection
method) is settled in the implementation plan; the commitment here is: all three economy selection paths
gate through `isEconomicallyActive`, co-located in the tick body.

## Part 3 — UI: hide the four tabs for non-developed systems

- Panel tab bar (`app/(game)/@panel/system/[systemId]/layout.tsx`, driven by `SYSTEM_TABS`): show only
  Overview + Astrography when the selected system's `control !== "developed"`; hide Population, Industry,
  Logistics, Market. The tab-gate must read the system's **live** developed tier (from the
  tick-invalidated ownership read `useOwnership`, not the static universe), so a system that develops
  mid-session gains its tabs on the next pulse.
- **Defense-in-depth (direct URL):** gate the four backing services —
  `getSystemPopulation` / `getSystemIndustry` / `getSystemLogistics` / `getMarket` — to return the inert
  empty shape (`visibility:"unknown"`, mirroring `getSystemLogistics`' existing empty return; the
  population/industry data types already carry a `visibility` field) when `control !== "developed"`, so a
  hand-typed URL to a hidden tab renders gracefully rather than leaking data. Overview
  (`getSystemDetail`) + Astrography (`getSystemSubstrate`) are untouched.

## Part 4 — Tripwire invariant test (the forget-proofing)

One integration test (`lib/world/__tests__/`): generate a world, advance enough ticks that both claims
**and** developments fire, then assert the invariant across the run:
- every system with `control !== "developed"` has `population === 0`, **and**
- its market stock is unchanged from the initial seed (no production/consumption ran there), **and**
- no logistics/flow activity references it.

Any future processor that leaks activity into a non-developed system trips this test. This is the
"don't-forget" guarantee — stronger than a type, because it catches a leak regardless of how it arrived.

---

## Sequencing & scope

- **Merge #146 first** (control flag + live-ownership map fix — done + reviewed) into the shared branch
  `feat/substrate-reset`, then branch `feat/developed-economy-gate` off shared.
- One PR, ordered: **Part 1 (delete trade-flow) → Part 2 (developed-gate) → Part 3 (UI) → Part 4
  (tripwire)**. Part 1 first removes a processor we'd otherwise have to gate.
- Doc lifecycle at the end: fold the "developed = economically active; controlled/unclaimed inert"
  reality into the active gameplay docs (faction-system / economy-autonomic-agency / SPEC) present-tense;
  delete this build-plan doc when the feature ships.

## Interfaces produced

- `isEconomicallyActive(control: SystemControl): boolean` (`lib/engine/control.ts`) — the single
  economy-participation predicate, consumed by the tick body and the system-detail services.
