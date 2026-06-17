# Economy SP1 Part 2 — PR 2b: Cutover + UI Swap + Deletes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip the economy from economy-type rate tables to the physical-driver model that 2a built. The live + simulator adapters compute base production/consumption via the pure `physicalRates` engine fn; `getInitialStock` seeds from each market's net balance; the dead economy-type tables and self-sufficiency machinery are deleted; the economy-type classifier survives display-only; and the system Overview shows real per-system production/consumption. Engine and UI flip together — **no broken intermediate** (each commit typechecks and the suite passes with updated assertions).

**This is the behaviour change.** 2a was behaviour-preserving (old tables still drove the tick). 2b is the cutover: the economy now runs on physical drivers, so equilibria shift. The integration suite's value-agnostic invariants (determinism, non-negative credits, greedy > random) must still hold — that is the gate that the first-draft coeffs produce a *functioning* economy. **Fine balance is 2c**; 2b only needs a non-degenerate economy.

**Tech Stack:** TypeScript 5 (strict), Vitest 4. Pure engine functions (zero DB). Prisma 7 read in the service/adapter layers only.

## Locked decisions (this PR)

| Fork | Decision | Why |
|---|---|---|
| **Overview Produces / Consumes** | **Net partition** — Produces = goods this system is a net exporter of (production > consumption), Consumes = net importer (consumption > production), each showing the net rate. | Consumption is now universal (every good), so a raw two-list view is ~12 rows each. Net partition splits the 12 goods into two meaningful lists and previews the emergent geography. The richer magnitude bars / net indicators land on the Astrography tab in **2d**. |
| **`getInitialStock` mapping** | **Producer/consumer share** — `share = production / (production + consumption)`, seed = `eq.consumes + share × (eq.produces − eq.consumes)`; `getTargetStock` when no rates. | Honors the design's "sign + magnitude" with no magic scale: pure producer → `eq.produces` (cheap), pure consumer → `eq.consumes` (dear), balanced → midpoint. Magnitude refinement is 2c. |
| **Population display** | **Real magnitude** via `formatNumber(population)` (matches the Astrography teaser). | §8.1.5 — the faked economy-type+trait-count label is replaced with the real number. |
| **`balance-analysis.ts`** | **Delete** | It imports the deleted `ECONOMY_PRODUCTION`/`ECONOMY_CONSUMPTION` and its whole C/P-per-economy-type framing is obsolete. `npm run simulate` is the calibration harness for 2c; a fresh physical-model analysis script, if wanted, is authored there. |
| **`economy-shim.ts`** | **Rename → `economy-type.ts`** | The classifier survives as a display-only label source (badges + `Region.dominantEconomy`); nothing in the tick reads it. Drop the "SHIM / DELETED in Part 2" framing; function name `deriveEconomyTypeLabel` unchanged. |

## Global Constraints

Copied from `CLAUDE.md` + the locked design (`docs/planned/economy-simulation-substrate.md` §8.1):

- **No `as` casts** except `as const` and inside `lib/types/guards.ts`.
- **No `unknown`** / **no `Record<string, unknown>`**. Good-keyed maps use `Record<string, …>` (no `GoodId` union exists — do not invent one).
- **Engine functions are pure** — no DB/Prisma imports. A constants helper (`getInitialStock`) may import a pure engine fn (`physicalRates`); the reverse never happens (no cycle).
- **Code comments describe the code, never the PR/phase/plan.** No "PR 2b", "Part 2", "2c", "cutover" in code comments or commit messages. Say "first-draft values, calibrated via the simulator" where magnitudes are provisional.
- **TDD**: failing test first where there is a unit to pin (`getInitialStock`, the engine wiring is covered by existing tests). Mechanical deletes/renames are driven by typecheck + suite.
- **Commit messages** are clean conventional commits describing the code (`feat(economy): …`, `refactor(economy): …`).
- Test runner: `npx vitest run <path>` for one file; `npm run test:unit` for the whole unit project. Typecheck: `npx tsc --noEmit`. Lint: `npm run lint`. Simulator: `npm run simulate`.

---

## File inventory

**Cutover (rate source → `physicalRates`)**
- `lib/engine/simulator/types.ts` — `SimSystem`: replace `produces` / `consumes` with `aggregate: ResourceVector` + `population: number`.
- `lib/engine/simulator/world.ts` — set `aggregate` + `population` on each `SimSystem` from the generated substrate; drop the `ECONOMY_PRODUCTION` / `ECONOMY_CONSUMPTION` import; update the market-seed `getInitialStock` call (Task 3).
- `lib/tick/adapters/memory/economy.ts` — compute `baseProductionRate` / `baseConsumptionRate` via `physicalRates(goodId, sys.aggregate, sys.population)`; drop `sys.produces` / `sys.consumes`.
- `lib/tick/adapters/prisma/economy.ts` — build the system aggregate vector from the `agg*` columns (already loaded by the existing `include`) + read `population`; compute the two base rates via `physicalRates`; drop `getProductionRate` / `getConsumptionRate` / `toEconomyType`.

**Seeding rewrite**
- `lib/constants/market-economy.ts` — `getInitialStock(aggregate, population, goodId)`; drop `getConsumeEquilibrium` / `getProducedGoods` / `getConsumedGoods` / `EconomyType` imports; import `physicalRates` + `ResourceVector`.
- `prisma/seed.ts` — `getInitialStock(sys.aggregate, sys.population, goodKey)`.
- `lib/services/dev-tools.ts` — build the aggregate vector from system columns + read `population`; `getInitialStock(aggregate, population, goodKey)`; drop `toEconomyType` if now unused.
- `lib/test-utils/fixtures.ts` — give the three fixture systems representative `agg*` columns + `population`; `getInitialStock(aggregate, population, key)`.

**Deletes + rename**
- `lib/constants/universe.ts` — **delete** (entire file is the dead economy tables + helpers).
- `lib/constants/economy.ts` — remove `SELF_SUFFICIENCY` + `getConsumeEquilibrium` (keep `ECONOMY_CONSTANTS`, prosperity constants + `PROSPERITY_PARAMS`).
- `scripts/balance-analysis.ts` — **delete**.
- `lib/engine/economy-shim.ts` → **rename** `lib/engine/economy-type.ts` (header comment rewritten; function unchanged).
- `lib/engine/universe-gen.ts` — update the import path `./economy-shim` → `./economy-type`.

**Tests**
- `lib/constants/__tests__/economy.test.ts` — **delete** (entirely about deleted `SELF_SUFFICIENCY` / `getConsumeEquilibrium` / `ECONOMY_CONSUMPTION`).
- `lib/constants/__tests__/market-economy.test.ts` — rewrite the `getInitialStock` block for the new signature; `getTargetStock` / `getSpread` blocks untouched.
- `lib/engine/__tests__/economy-shim.test.ts` → rename `economy-type.test.ts`; update the import path only.

**UI**
- `app/(game)/@panel/system/[systemId]/page.tsx` — read substrate `goods[]` + `population`; net-partition Produces/Consumes; real population; drop `ECONOMY_PRODUCTION` / `ECONOMY_CONSUMPTION` + `getPopulationLabel` imports.
- `lib/utils/system.ts` — remove `getPopulationLabel` + `ECONOMY_POP_BASE` + `POP_LABELS` + the `EconomyType` import (keep `getDangerInfo`).

---

## Task 1 — Cutover the tick rate source to `physicalRates`

The `MarketView` shape is unchanged (`baseProductionRate?` / `baseConsumptionRate?` stay) — only how the adapters *compute* them changes. This is the "one-line rate-source swap" 2a de-risked.

**Rate-source rule (both adapters):** compute `const { production, consumption } = physicalRates(goodId, aggregate, population)` then set
```typescript
baseProductionRate: production > 0 ? production : undefined,
baseConsumptionRate: consumption > 0 ? consumption : undefined,
```
Passing `undefined` for a zero rate preserves the builder's "null = not a producer/consumer" contract (so a resource-driven good with no deposit is genuinely a non-producer, and a 0-population system never gets a phantom gov-boost consumption).

- [ ] **Step 1: `SimSystem` — swap produces/consumes → aggregate/population** (`lib/engine/simulator/types.ts`)

Replace the two `produces` / `consumes` fields:
```typescript
  /** System aggregate resource vector — drives substrate production rates. */
  aggregate: ResourceVector;
  /** Abstract population magnitude — drives labour + consumption. */
  population: number;
```
Add `ResourceVector` to the `@/lib/types/game` type import. Keep `economyType` (display label).

- [ ] **Step 2: Sim world builder** (`lib/engine/simulator/world.ts`)

Drop `import { ECONOMY_PRODUCTION, ECONOMY_CONSUMPTION } from "@/lib/constants/universe";`. In the `systems` map, replace the `produces` / `consumes` lines with:
```typescript
      aggregate: s.aggregate,
      population: s.population,
```
(`GeneratedSystem` already carries `aggregate` + `population`.) The `econ` local + `economyType: econ` stay.

- [ ] **Step 3: Memory adapter** (`lib/tick/adapters/memory/economy.ts`)

In `getMarketsForRegion`, replace the two `baseProductionRate` / `baseConsumptionRate` lines with a `physicalRates` call:
```typescript
      const { production, consumption } = physicalRates(m.goodId, sys.aggregate, sys.population);
      views.push({
        …
        baseProductionRate: production > 0 ? production : undefined,
        baseConsumptionRate: consumption > 0 ? consumption : undefined,
        …
      });
```
Import `physicalRates` from `@/lib/engine/physical-economy`.

- [ ] **Step 4: Prisma adapter** (`lib/tick/adapters/prisma/economy.ts`)

Drop `getProductionRate` / `getConsumptionRate` (and the whole `@/lib/constants/universe` import) and `toEconomyType`. Build the aggregate per system (cache by systemId so a 12-good system builds the vector once, not 12×), read `population`, and compute rates:
```typescript
import { physicalRates } from "@/lib/engine/physical-economy";
import { resourceVectorFromColumns } from "@/lib/engine/resources";
import type { ResourceVector } from "@/lib/types/game";
…
    const aggBySystem = new Map<string, ResourceVector>();
    return rows.map((m) => {
      const sys = m.station.system;
      let aggregate = aggBySystem.get(sys.id);
      if (!aggregate) {
        aggregate = resourceVectorFromColumns(
          { aggGas: sys.aggGas, aggMinerals: sys.aggMinerals, aggOre: sys.aggOre,
            aggBiomass: sys.aggBiomass, aggArable: sys.aggArable,
            aggWater: sys.aggWater, aggRadioactive: sys.aggRadioactive },
          "agg",
        );
        aggBySystem.set(sys.id, aggregate);
      }
      const goodKey = GOOD_NAME_TO_KEY.get(m.good.name) ?? m.good.name;
      const { production, consumption } = physicalRates(goodKey, aggregate, sys.population);
      const governmentType = sys.faction
        ? toGovernmentType(sys.faction.governmentType)
        : "frontier";
      return {
        id: m.id,
        systemId: sys.id,
        goodId: goodKey,
        basePrice: m.good.basePrice,
        stock: m.stock,
        governmentType,
        baseProductionRate: production > 0 ? production : undefined,
        baseConsumptionRate: consumption > 0 ? consumption : undefined,
        traits: sys.traits.map((t) => ({ traitId: toTraitId(t.traitId), quality: toQualityTier(t.quality) })),
      };
    });
```
The existing `include` returns all system scalar columns (`agg*`, `population`) — no query change needed. Drop the now-stale "Resolves economy-type derived fields" line from the class doc comment.

- [ ] **Step 5: Typecheck + the economy/tick tests still pass**

`npx tsc --noEmit` (expect the `getInitialStock` callers in `world.ts` to still typecheck — that call is rewritten in Task 3; if Task 1 is committed alone, `world.ts` line ~109 still uses the old `getInitialStock(sys.economyType, goodKey)` signature, which is fine until Task 3). The tick unit tests (`tick.test.ts`) are unaffected (they feed `MarketTickEntry` directly).

- [ ] **Step 6: Commit**
```bash
git add lib/engine/simulator/types.ts lib/engine/simulator/world.ts lib/tick/adapters/memory/economy.ts lib/tick/adapters/prisma/economy.ts
git commit -m "feat(economy): drive market tick production/consumption from the physical substrate"
```

---

## Task 2 — Rewrite `getInitialStock` to seed from net balance

- [ ] **Step 1: Rewrite the `getInitialStock` block in `market-economy.test.ts`**

Replace the `describe("getInitialStock")` block with the new signature + net-balance semantics:
```typescript
import { makeResourceVector } from "@/lib/engine/resources";

describe("getInitialStock", () => {
  it("seeds a producer high (toward produces -> cheap)", () => {
    // water-rich, low-pop system: strong net water producer.
    const seed = getInitialStock(makeResourceVector({ water: 12 }), 100, "water");
    expect(seed).toBeGreaterThan(getTargetStock("water"));
    expect(seed).toBeLessThanOrEqual(GOODS.water.equilibrium.produces);
  });

  it("seeds a consumer low (toward consumes -> dear)", () => {
    // water-poor, populous system: pure net water consumer.
    const seed = getInitialStock(makeResourceVector({ water: 0 }), 2000, "water");
    expect(seed).toBe(GOODS.water.equilibrium.consumes);
    expect(seed).toBeLessThan(getInitialStock(makeResourceVector({ water: 12 }), 100, "water"));
  });

  it("seeds at the target when the system has no production or consumption", () => {
    // zero population -> no rates on either axis -> anchor target.
    expect(getInitialStock(makeResourceVector({ water: 12 }), 0, "water")).toBe(getTargetStock("water"));
  });

  it("seeds an unknown good at its target", () => {
    expect(getInitialStock(makeResourceVector({}), 1000, "not_a_good")).toBe(getTargetStock("not_a_good"));
  });
});
```
Add `GOODS` to the imports (`from "../goods"`). Run `npx vitest run lib/constants/__tests__/market-economy.test.ts` — FAIL (old signature).

- [ ] **Step 2: Rewrite `getInitialStock` in `lib/constants/market-economy.ts`**

Swap the imports — drop `getConsumeEquilibrium`, `getProducedGoods`, `getConsumedGoods`, `EconomyType`; add:
```typescript
import { physicalRates } from "@/lib/engine/physical-economy";
import type { ResourceVector } from "@/lib/types/game";
```
Replace the function:
```typescript
/**
 * Initial stock for a market at seed/reset time, from the system's net balance
 * for the good. A net producer seeds high (toward the producer equilibrium →
 * reads cheap); a net consumer seeds low (toward the consumer equilibrium →
 * reads dear); a balanced or inert market seeds at the pricing anchor.
 */
export function getInitialStock(
  aggregate: ResourceVector,
  population: number,
  goodId: string,
): number {
  const eq = GOODS[goodId]?.equilibrium;
  if (!eq) return getTargetStock(goodId);
  const { production, consumption } = physicalRates(goodId, aggregate, population);
  const total = production + consumption;
  if (total <= 0) return getTargetStock(goodId);
  const producerShare = production / total; // 1 = pure producer, 0 = pure consumer
  return Math.round(eq.consumes + producerShare * (eq.produces - eq.consumes));
}
```

- [ ] **Step 3: Update the seeding callers**

- `prisma/seed.ts:198` → `stock: getInitialStock(sys.aggregate, sys.population, goodKey),`
- `lib/engine/simulator/world.ts:109` → `stock: getInitialStock(sys.aggregate, sys.population, goodKey),`
- `lib/services/dev-tools.ts` — build the aggregate from the loaded system columns and read population:
  ```typescript
  const aggregate = resourceVectorFromColumns(
    { aggGas: m.station.system.aggGas, aggMinerals: m.station.system.aggMinerals,
      aggOre: m.station.system.aggOre, aggBiomass: m.station.system.aggBiomass,
      aggArable: m.station.system.aggArable, aggWater: m.station.system.aggWater,
      aggRadioactive: m.station.system.aggRadioactive },
    "agg",
  );
  stocks.push(getInitialStock(aggregate, m.station.system.population, goodKey));
  ```
  Import `resourceVectorFromColumns`; drop `toEconomyType` + the `econ` local if now unused (grep the file first).
- `lib/test-utils/fixtures.ts` — give each fixture system representative `agg*` columns + `population` at creation (e.g. agri = arable/water-rich mid-pop; ind = ore/minerals-rich high-pop; tech = low-resource high-pop), then seed markets with `getInitialStock(aggregate, population, key)`. Build a small `{ aggregate, population }` per station to thread into the market loop, replacing the hardcoded `economyType` list. Import `makeResourceVector` + drop the `EconomyType` import if now unused.

- [ ] **Step 4: Green the seeding test + typecheck**

`npx vitest run lib/constants/__tests__/market-economy.test.ts` → PASS. `npx tsc --noEmit` → no errors.

- [ ] **Step 5: Commit**
```bash
git add lib/constants/market-economy.ts lib/constants/__tests__/market-economy.test.ts prisma/seed.ts lib/engine/simulator/world.ts lib/services/dev-tools.ts lib/test-utils/fixtures.ts
git commit -m "feat(economy): seed market stock from the substrate net balance"
```

---

## Task 3 — Delete the dead tables + rename the classifier

Nothing reads `ECONOMY_PRODUCTION` / `ECONOMY_CONSUMPTION` / `SELF_SUFFICIENCY` / `getConsumeEquilibrium` after Tasks 1–2. Verify, then delete.

- [ ] **Step 1: Confirm no live consumers remain**

`grep -rn "ECONOMY_PRODUCTION\|ECONOMY_CONSUMPTION\|getProducedGoods\|getConsumedGoods\|getProductionRate\|getConsumptionRate\|SELF_SUFFICIENCY\|getConsumeEquilibrium" lib app prisma scripts` — only the files being deleted/edited in this task should match.

- [ ] **Step 2: Delete files**
- `rm lib/constants/universe.ts`
- `rm scripts/balance-analysis.ts`
- `rm lib/constants/__tests__/economy.test.ts`

- [ ] **Step 3: Trim `lib/constants/economy.ts`**

Remove the `SELF_SUFFICIENCY` const, the `getConsumeEquilibrium` function, the now-unused `EconomyType` + `GoodEquilibrium` imports, and the "Self-sufficiency factors" section header. Keep `ECONOMY_CONSTANTS`, all prosperity constants, and `PROSPERITY_PARAMS` (`ProsperityParams` import stays).

- [ ] **Step 4: Rename the classifier `economy-shim.ts` → `economy-type.ts`**

`git mv lib/engine/economy-shim.ts lib/engine/economy-type.ts` and `git mv lib/engine/__tests__/economy-shim.test.ts lib/engine/__tests__/economy-type.test.ts`. Rewrite the module header comment to describe a display-only classifier (drop the "SHIM … DELETED in Part 2 … keeps `ECONOMY_PRODUCTION/CONSUMPTION` working" framing); keep `deriveEconomyTypeLabel` and its body unchanged. Update the test's import to `../economy-type`. Update `lib/engine/universe-gen.ts` import `./economy-shim` → `./economy-type`.

New header (suggested):
```typescript
/**
 * Economy-type classifier — maps a system's aggregate resource vector +
 * population to one of the six `EconomyType` labels. Display-only: it drives
 * UI badges and `Region.dominantEconomy`; nothing in the economy tick reads it
 * (production/consumption derive from the substrate directly). Thresholds are
 * tuned via the simulator.
 */
```

- [ ] **Step 5: Typecheck + unit suite**

`npx tsc --noEmit` → no errors. `npx vitest run lib/engine/__tests__/economy-type.test.ts` → PASS.

- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "refactor(economy): delete economy-type rate tables; classifier is display-only"
```

---

## Task 4 — Overview: net partition + real population

- [ ] **Step 1: Rewire `SystemOverviewContent`** (`app/(game)/@panel/system/[systemId]/page.tsx`)

- Drop `import { ECONOMY_PRODUCTION, ECONOMY_CONSUMPTION } from "@/lib/constants/universe";` and `import { getPopulationLabel } from "@/lib/utils/system";`.
- Read the substrate via `useSystemSubstrate(systemId)`. It is visibility-gated (`{ visibility: "unknown" }` for unsurveyed systems) and fetched in its own boundary today (the teaser). To keep the Overview resilient, derive the goods/population section from the substrate but render a graceful fallback when `visibility === "unknown"` (no Produces/Consumes data, population "—"). Keep the economy-type badge from `systemInfo.economyType` (unchanged).
- Replace `producedGoods` / `consumedGoods` with a net-partition memo over `substrate.goods`:
  ```typescript
  const { producedGoods, consumedGoods } = useMemo(() => {
    if (substrate.visibility !== "visible") return { producedGoods: [], consumedGoods: [] };
    const produced: { name: string; rate: number }[] = [];
    const consumed: { name: string; rate: number }[] = [];
    for (const g of substrate.goods) {
      const net = g.production - g.consumption;
      const name = GOODS[g.goodId]?.name ?? g.goodId;
      if (net > 0) produced.push({ name, rate: net });
      else if (net < 0) consumed.push({ name, rate: -net });
    }
    produced.sort((a, b) => b.rate - a.rate);
    consumed.sort((a, b) => b.rate - a.rate);
    return { producedGoods: produced, consumedGoods: consumed };
  }, [substrate]);
  ```
- `GoodsList` renders the net rate; show one decimal (`{g.rate.toFixed(1)}/t`) since physical rates are fractional.
- Replace the population stat: `getPopulationLabel(...)` → `formatNumber(population)` (import `formatNumber` from `@/lib/utils/format`), rendered in `font-mono` like the teaser, or "—" when unknown.

Mind the SSR/suspense guard: `useSystemSubstrate` is a suspense query. The Overview already nests boundaries; keep the substrate-dependent section inside a boundary (or accept that the whole Overview suspends on substrate — it is `staleTime: Infinity`, pre-warmed by the teaser, so this is cheap). Prefer not to regress the existing "teaser in its own boundary" resilience.

- [ ] **Step 2: Trim `lib/utils/system.ts`**

Remove `getPopulationLabel`, `ECONOMY_POP_BASE`, `POP_LABELS`, and the `EconomyType` import. Keep `getDangerInfo`.

- [ ] **Step 3: Typecheck + lint + manual sanity**

`npx tsc --noEmit` → no errors. `npm run lint` → clean on touched files. (Manual: `npm run dev`, open a system Overview — Produces/Consumes show net exporters/importers, population shows the real magnitude. Deferred to the final verification.)

- [ ] **Step 4: Commit**
```bash
git add "app/(game)/@panel/system/[systemId]/page.tsx" lib/utils/system.ts
git commit -m "feat(economy): system Overview shows real substrate net trade + population"
```

---

## Final verification

- [ ] **Typecheck + lint + full unit suite**

`npx tsc --noEmit` → no errors. `npm run lint` → clean. `npm run test:unit` → PASS, **including `lib/engine/__tests__/simulator-integration.test.ts`** (determinism, non-negative credits, greedy > random, volatility, gov-boost). Green here proves the first-draft physical economy is *functioning*, not just compiling.

- [ ] **Simulator non-degeneracy check**

`npm run simulate` → completes; stocks stay inside `[5, 200]`; prices disperse across systems (trade opportunity exists); bots earn. If the economy is **degenerate** (e.g. all stock pinned at a bound, no dispersion, greedy ≈ random), apply a **minimal** coeff / `LABOUR_HALF_POP` nudge in `lib/constants/physical-economy.ts` to restore a functioning trading economy — *not* fine balance, which is 2c. Document any nudge as "first-draft, calibrated via the simulator".

## Self-review checklist (before opening the PR)

- [ ] **Spec coverage (§8.1.7 item 2):** adapters wired to `physicalRates` ✔; Overview lists + population swapped ✔; `ECONOMY_PRODUCTION`/`ECONOMY_CONSUMPTION`/`SELF_SUFFICIENCY`/`getConsumeEquilibrium` deleted ✔; shim role retired (classifier display-only) ✔; `getInitialStock` rewritten ✔. Engine + UI flipped together, no broken intermediate ✔.
- [ ] **No `as` / `unknown`** introduced.
- [ ] **No dead code / orphan imports:** `grep` confirms no surviving references to the deleted symbols; `economy-shim` path gone everywhere.
- [ ] **No comment references** to PR/phase/plan.
- [ ] **Out of scope untouched:** `getTargetStock` / `CALIBRATED_TARGET_STOCK` (re-measured in 2c, deleted in Part 3), the slippage/spread guard, days-of-supply pricing (Part 3), population dynamics (SP2), the 26-good roster / facilities (SP3), Astrography net bars (2d).

## What this sets up (not built here)

- **2c** recalibrates the first-draft coeffs / needs / `LABOUR_HALF_POP` and re-measures the pricing anchors via `npm run simulate`; updates `economy.md` + `system-traits.md` + `SPEC.md`; marks Part 2 done.
- **2d** adds net import/export indicators + per-good production/consumption bars on the Astrography substrate tab, consuming the `goods[]` field.
