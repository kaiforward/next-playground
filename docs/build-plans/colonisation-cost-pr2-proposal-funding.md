# Colonisation Cost — PR2: Proposal Layer + Value-Order Funding (builds only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the build planner's flat output into `Proposal` bundles (a `BuildProposal` = production + the academies/complex that gate it, carrying `value` and `work`), assemble the funding queue in descending **bundle-ROI** order (gate-first within each proposal), and keep `fundQueue` the decision-free front-first drainer — builds only, so the same builds land, now ROI-ordered.

**Architecture:** Three touched files, no new files.
1. `lib/engine/directed-build.ts` — the greedy planner now emits **bundles**. Its unchanged decision logic moves into an internal `planFactionBundles` (each bundle carries `value` = served demand covered and `work` = Σ level work). `planFactionBuilds` becomes a thin flat wrapper (so its ~30 existing tests stay green and prove the *same builds are proposed*). `planFactionQueue` → `planFactionProposals` (in-flight subtraction unchanged; returns `Proposal[]`). `DesiredProject` retires.
2. `lib/engine/construction.ts` — adds `proposalRoi` + `orderProposals` (housing leads, then descending ROI, deterministic tiebreak). `fundQueue` is **untouched** — the value ordering is a reorder of its *input*, so no ROI logic enters the drainer.
3. `lib/tick/processors/directed-build.ts` — the funding half is rewired: `planFactionProposals` → `orderProposals` → expand each proposal gate-first into minted `WorldConstructionProject` rows → `fundQueue([...existing, ...new], …)`. In-flight projects still lead all new proposals.

**Tech Stack:** TypeScript 5 (strict), Vitest 4. Pure engine functions (no `fs`/`process.env`/DB). Reuses `workCostPerLevel` (`lib/constants/construction.ts`), the existing planner internals, and `fundQueue`.

**Spec:** `docs/planned/economy-colonisation-cost.md` §4 (Value-order funding — ROI at the proposal, gate-first within). Builds on shipped PR1 (`lib/engine/colonisation-value.ts`, unused until PR3).

## Global Constraints

Every task's requirements implicitly include these (from `CLAUDE.md`):

- **No `as` type assertions** except `as const`. Fix types at the source, never cast at the consumer.
- **No `unknown`** anywhere. Use typed keys/unions. **Discriminated unions** use `{ kind: "build"; … }`-style tags (never a `boolean` flag with optional fields).
- Engine functions are **pure** — no `fs`/`process.env`/DB imports. Test with Vitest.
- **`Map`/`Set` are fine in transient engine params/returns** (never persisted). The JSON-serializable rule applies only to the `World` store; `Proposal` is transient (never stored) — and **no `Infinity`/`NaN`** may reach `World` state (only finite `WorldConstructionProject.workTotal`/`workDone` are persisted, unchanged by this PR).
- **Avoid postfix `!`** except `find(...)!` in tests (an accepted project idiom).
- **Never `.sort()` an input array in place** — sort a copy (`[...arr].sort(...)`).
- Tests live beside their module in `__tests__/*.test.ts`; the `unit` Vitest project picks them up automatically.
- **Behaviour-preserving where stated:** the *set of builds proposed* is unchanged (the planner's decision logic is byte-for-byte the same, only its output shape and the funding *order* change). Do not alter the settle gate, labour gate, capacity math, academy/complex lift, or in-flight subtraction.

---

## PR Roadmap (context — only PR2 is executable in this document)

Four sequential PRs on the shared `feat/economy-rework-base` branch. Each later PR gets its own plan, written against the shipped reality of the ones before it.

- **PR1 — Valuation engine (shipped, `a672da8`).** `lib/engine/colonisation-value.ts` + tests. Pure, unwired, behaviour-neutral.
- **PR2 — Proposal layer + value-order funding, builds only (this doc).** `Proposal = BuildProposal` bundles; funding queue assembled in descending bundle-ROI order, gate-first within; `fundQueue` unchanged. Same builds land, now ROI-ordered. Touches `directed-build.ts`, `construction.ts`, `processors/directed-build.ts`.
- **PR3 — Colony-establish mechanic (the second consumer).** Discriminate `WorldConstructionProject`, add `ColonyProposal` to the `Proposal` union (using PR1's `colonyValue`), emit it into PR2's pipeline (interleaving by ROI among the build bundles), retire `MAX_DEVELOPS_PER_PULSE`, extend `applyDevelopments` (land-sized seed + bundled housing). Add `lib/constants/colonisation.ts`.
- **PR4 — Simulator metric + sequenced calibration.** Extend `build-analysis.ts`; run the coarse L·σ-first calibration pass.

**PR2 explicitly does NOT:** add `ColonyProposal`, touch `colonisation-value.ts`, change `WorldConstructionProject`, touch save/load, or alter the claim/develop phases. Those are PR3.

---

## File Structure (PR2)

- **Modify:** `lib/engine/directed-build.ts` — add `ProposalItem`/`BuildProposal`/`Proposal` types; extract the planner body into internal `planFactionBundles`; make `planFactionBuilds` a flat wrapper; replace `planFactionQueue`/`DesiredProject` with `planFactionProposals`.
- **Modify:** `lib/engine/__tests__/directed-build.test.ts` — swap the `planFactionQueue` import/suite for `planFactionProposals`; add value/work/role/ROI-shape coverage.
- **Modify:** `lib/engine/construction.ts` — add `proposalRoi` + `orderProposals` (imports `type Proposal` from `directed-build.ts`; `fundQueue` untouched).
- **Modify:** `lib/engine/__tests__/construction.test.ts` — add `orderProposals`/`proposalRoi` coverage (housing-leads, ROI-desc, gate-first-preserved, determinism).
- **Modify:** `lib/tick/processors/directed-build.ts` — rewire the funding half; update the JSDoc.
- **Modify:** `lib/tick/processors/__tests__/directed-build.test.ts` — add wiring regressions (housing funds before industry; academy project precedes its production; ROI order under a scarce pool); confirm the existing suite stays green.

No files are created or deleted.

---

## Task 1: Proposal bundles in the planner (`directed-build.ts`)

Extract the planner's decision logic into internal `planFactionBundles` (emitting `BuildProposal`-shaped bundles with `value`/`work`), reduce `planFactionBuilds` to a flat wrapper over it, and replace `planFactionQueue`/`DesiredProject` with `planFactionProposals`.

**Files:**
- Modify: `lib/engine/directed-build.ts`
- Test: `lib/engine/__tests__/directed-build.test.ts`

**Interfaces:**
- Consumes: `workCostPerLevel` (`lib/constants/construction.ts`, `(buildingType: string) => number`), plus everything `planFactionBuilds`/`planFactionQueue` already consume (`BuildSystemState`, `RouteCost`, `WorldConstructionProject`, the industry constants, `isEconomicallyActive`).
- Produces:
  - `export interface ProposalItem { buildingType: string; levels: number }`
  - `export interface BuildProposal { kind: "build"; factionId: string; systemId: string; role: "housing" | "industry"; items: ProposalItem[]; value: number; work: number }`
  - `export type Proposal = BuildProposal` (PR3 widens to `| ColonyProposal`)
  - `export function planFactionBuilds(systems: BuildSystemState[], routeCost: RouteCost): PlannedBuild[]` (unchanged signature/behaviour — now a flat wrapper)
  - `export function planFactionProposals(systems: BuildSystemState[], routeCost: RouteCost, openProjects: WorldConstructionProject[]): Proposal[]`
  - **Removed:** `planFactionQueue`, `DesiredProject`.

- [ ] **Step 1: Rewrite the `planFactionQueue` test suite as `planFactionProposals`, and add bundle-shape tests**

In `lib/engine/__tests__/directed-build.test.ts`, change the top import (line 2) to drop `planFactionQueue` and add `planFactionProposals`, `type Proposal`, `type BuildProposal`:

```ts
import { findStructuralDeficits, buildableUnits, buildableOutput, planFactionBuilds, planFactionProposals, supplyDissatisfaction, fedAndCalm, habitableHousingHeadroom, plannedHousingUnits, hopRouteCost, type BuildSystemState, type PlannedBuild, type Proposal, type BuildProposal } from "@/lib/engine/directed-build";
```

Add `workCostPerLevel` to the construction-constants import at the top of the test file (add a new import line — the test file does not currently import from `lib/constants/construction`):

```ts
import { workCostPerLevel } from "@/lib/constants/construction";
```

Replace the entire `describe("planFactionQueue", () => { … })` block (lines ~896-937) with:

```ts
/** Flatten a proposal list to its ordered building items — the funding-queue expansion. */
function flatItems(proposals: Proposal[]): Array<{ systemId: string; buildingType: string; levels: number }> {
  return proposals.flatMap((p) => p.items.map((i) => ({ systemId: p.systemId, buildingType: i.buildingType, levels: i.levels })));
}

describe("planFactionProposals", () => {
  it("emits a housing proposal (role 'housing', value 0, work = levels × housing cost) at a fed-and-calm developed system", () => {
    const site = sysWith({
      control: "developed", population: 100, generalSpace: 50, habitableSpace: 50,
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5 }],
    });
    const proposals = planFactionProposals([site], () => 1, []);
    const housing = proposals.find((p) => p.role === "housing");
    expect(housing).toBeDefined();
    expect(housing!.kind).toBe("build");
    expect(housing!.factionId).toBe("f1");
    expect(housing!.value).toBe(0);                              // housing has no served-demand ROI
    expect(housing!.items).toHaveLength(1);
    const lvls = housing!.items[0].levels;
    expect(housing!.items[0].buildingType).toBe(HOUSING_TYPE);
    expect(Number.isInteger(lvls)).toBe(true);
    expect(lvls).toBeGreaterThanOrEqual(1);
    expect(housing!.work).toBeCloseTo(lvls * workCostPerLevel(HOUSING_TYPE), 6);
  });

  it("emits an industry proposal with value>0 (served demand) and work = Σ item level-work", () => {
    // A: structural food deficit; B: builder with arable slots + population, reachable from A.
    const slotCap = emptyResourceVector();
    for (const k of RESOURCE_TYPES) slotCap[k] = 10;
    const deficit: BuildSystemState = {
      systemId: "A", factionId: "f1", population: 100, unrest: 0, control: "unclaimed", buildings: {},
      slotCap: emptyResourceVector(), generalSpace: 0, habitableSpace: 0,
      goods: [{ goodId: "food", stock: 1, targetStock: 20, demand: 5 }],
    };
    const builder: BuildSystemState = {
      systemId: "B", factionId: "f1", population: 200, unrest: 0, control: "developed", buildings: {},
      slotCap, generalSpace: 50, habitableSpace: 0, goods: [], // no habitable land → isolate industry
    };
    const proposals = planFactionProposals([deficit, builder], () => 1, []);
    const food = proposals.find((p) => p.role === "industry" && p.items.some((i) => i.buildingType === "food"));
    expect(food).toBeDefined();
    expect(food!.value).toBeGreaterThan(0);                     // it serves real demand
    expect(food!.value).toBeLessThanOrEqual(5 + 1e-9);          // never more than the deficit it serves
    const expectedWork = food!.items.reduce((s, i) => s + i.levels * workCostPerLevel(i.buildingType), 0);
    expect(food!.work).toBeCloseTo(expectedWork, 6);
  });

  it("bundles a co-built academy INTO the production's proposal, gate-first (not as a separate proposal)", () => {
    const proposals = planFactionProposals(makeElectronicsDeficitWithCapableSite(), selfAndNeighbourRoute, []);
    const bundle = proposals.find((p) => p.items.some((i) => i.buildingType === "electronics"));
    expect(bundle).toBeDefined();
    const types = bundle!.items.map((i) => i.buildingType);
    expect(types).toContain(VOCATIONAL_SCHOOL_TYPE);
    expect(types).toContain(RESEARCH_INSTITUTE_TYPE);
    // Gate-first WITHIN the bundle: the academies precede the electronics they license.
    expect(types.indexOf(VOCATIONAL_SCHOOL_TYPE)).toBeLessThan(types.indexOf("electronics"));
    expect(types.indexOf(RESEARCH_INSTITUTE_TYPE)).toBeLessThan(types.indexOf("electronics"));
    // The academy is NOT a standalone proposal — it lives in the production's bundle (this is what
    // lets it inherit the production's ROI instead of sorting last at value ≈ 0).
    expect(proposals.some((p) => p.items.length === 1 && p.items[0].buildingType === VOCATIONAL_SCHOOL_TYPE)).toBe(false);
  });

  it("does not re-propose a level already in flight (subtracts open projects)", () => {
    const site = sysWith({
      control: "developed", population: 100, generalSpace: 50, habitableSpace: 50,
      goods: [{ goodId: "food", stock: 20, targetStock: 20, demand: 5 }],
    });
    // Ten housing levels already under construction cover the whole pace-ahead target → no new housing.
    const open: WorldConstructionProject[] = [
      { id: "h", factionId: "f1", systemId: "X", buildingType: HOUSING_TYPE, levels: 10, workTotal: 80, workDone: 0 },
    ];
    expect(planFactionProposals([site], () => 1, []).some((p) => p.role === "housing")).toBe(true);
    expect(planFactionProposals([site], () => 1, open).some((p) => p.role === "housing")).toBe(false);
  });

  it("flattening a proposal keeps its academy before the production it gates", () => {
    const flat = flatItems(planFactionProposals(makeElectronicsDeficitWithCapableSite(), selfAndNeighbourRoute, []));
    const schoolIdx = flat.findIndex((i) => i.buildingType === VOCATIONAL_SCHOOL_TYPE);
    const prodIdx = flat.findIndex((i) => i.buildingType === "electronics");
    expect(schoolIdx).toBeGreaterThanOrEqual(0);
    expect(prodIdx).toBeGreaterThanOrEqual(0);
    expect(schoolIdx).toBeLessThan(prodIdx);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts`
Expected: FAIL — `planFactionProposals` / `type Proposal` / `type BuildProposal` are not exported (and `planFactionQueue` no longer imported). Compile/import error.

- [ ] **Step 3: Add the `workCostPerLevel` import to `directed-build.ts`**

At the top of `lib/engine/directed-build.ts`, add to the imports (after the `GOOD_RECIPES` import, line ~23):

```ts
import { workCostPerLevel } from "@/lib/constants/construction";
```

- [ ] **Step 4: Add the proposal types above `planFactionBuilds`**

Insert this block immediately before the `planFactionBuilds` JSDoc (line ~355, just after `complexLift`):

```ts
/** One whole-level order within a proposal bundle: `levels` of `buildingType`. */
export interface ProposalItem {
  buildingType: string;
  levels: number;
}

/**
 * A funding proposal — the unit that carries an ROI (docs/planned/economy-colonisation-cost.md §4).
 * A BuildProposal BUNDLES a production level-set with the academies/complex that GATE it, in `items`
 * held gate-first (complex → schools → institutes → production); a housing proposal is a single
 * housing item. ROI = `value` (served demand-rate the production covers) ÷ `work` (the WHOLE bundle's
 * level work), so an enabler — an academy/complex with no served demand of its own — raises the
 * denominator without touching the numerator: the bundle funds gate-first at the production's ROI and
 * the school never ranks below the factory it staffs. (PR3 adds a single-item ColonyProposal.)
 */
export interface BuildProposal {
  kind: "build";
  factionId: string;
  systemId: string;
  /** Housing leads population (proactive substrate, no served-demand ROI); industry ranks by ROI. */
  role: "housing" | "industry";
  /** Whole-level orders in gate-first funding order. */
  items: ProposalItem[];
  /** Served demand-rate this bundle's production covers — the ROI numerator (0 for housing). */
  value: number;
  /** Σ over items of `levels × workCostPerLevel` — the ROI denominator. */
  work: number;
}

/** The proposal union the decision layer emits. PR3 widens it to `BuildProposal | ColonyProposal`. */
export type Proposal = BuildProposal;

/** A bundle before its faction is attached (the planner works per system; faction is a later join). */
interface PlannedBundle {
  systemId: string;
  role: "housing" | "industry";
  items: ProposalItem[];
  value: number;
  work: number;
}
```

- [ ] **Step 5: Rename the planner body to `planFactionBundles` and emit bundles**

Replace the whole `planFactionBuilds` function (its JSDoc + body, lines ~355-601 — from `/** Greedy demand-pulled build planner …` through the closing `return builds;\n}`) with the `planFactionBundles` core below **plus** the flat `planFactionBuilds` wrapper. The decision logic (settle gate, structural deficits, opportunity scoring, spare-labour gate, whole-level binary-search fit, academy/complex lift, deficit decrement) is **unchanged** — only the emission changes from flat `builds.push(PlannedBuild)` to grouped `bundles.push(PlannedBundle)`, and `value`/`work` are accumulated:

```ts
/**
 * Greedy demand-pulled build planner for ONE faction's systems, emitting funding BUNDLES. Same
 * decision logic as before — proposes builds toward the physical ceilings only (capacity, spare
 * labour, whole-level validity); the construction pool is the sole speed meter — but each committed
 * build now leaves as a `PlannedBundle` carrying its served demand (`value`) and total level work
 * (`work`) so the funding stage can rank bundles by ROI. A housing build is a one-item bundle; an
 * industry opportunity is a bundle of [complex?, schools?, institutes?, production], gate-first.
 *
 * Each (site, good) opportunity's route-cost-sorted reachable deficits are static, so they are
 * computed ONCE and committed in a single descending-score pass — never re-scanning every site×good
 * per build.
 */
function planFactionBundles(
  systems: BuildSystemState[],
  routeCost: RouteCost,
): PlannedBundle[] {
  // Mutable per-system working copy so capacity/labour reflect builds made this pass.
  // Only developed systems can host builds — unclaimed and controlled (outpost-tier)
  // systems are skipped here, gating both the housing and industry passes in one place.
  // Deficit/surplus detection below still reads all `systems`.
  const working = new Map<string, BuildSystemState>();
  for (const s of systems) {
    if (!isEconomicallyActive(s.control)) continue;
    working.set(s.systemId, { ...s, buildings: { ...s.buildings } });
  }

  const bundles: PlannedBundle[] = [];

  // ── Pass 1: proactive housing (housing leads population). ──
  // Build housing toward the habitable cap wherever a system is fed and calm, paced a
  // margin ahead of its current population. Housing draws general space, so it runs
  // before industry — habitable land is housing's by right; factories take what's left.
  for (const site of working.values()) {
    const want = plannedHousingUnits(site);
    if (want <= 0) continue;
    // Whole levels only: you commit a whole housing level or none. A sub-level want waits.
    const levels = Math.floor(want);
    if (levels < 1) continue;
    site.buildings[HOUSING_TYPE] = (site.buildings[HOUSING_TYPE] ?? 0) + levels;
    bundles.push({
      systemId: site.systemId,
      role: "housing",
      items: [{ buildingType: HOUSING_TYPE, levels }],
      value: 0, // proactive substrate — no served-demand ROI; the funding stage leads housing anyway
      work: levels * workCostPerLevel(HOUSING_TYPE),
    });
  }

  // ── Pass 2: labour-gated industry (industry follows the resident workforce). ──
  const structural = findStructuralDeficits(systems, routeCost);
  if (structural.length === 0) return bundles;

  // Surplus-holding systems per good — the input-supply side of the tier-1+ gate. A factory's
  // recipe inputs arrive via route-cost-bounded logistics, so the gate checks for a surplus
  // reachable FROM each candidate site (see inputsAvailable), not merely one somewhere in the faction.
  const surplusSystemsByGood = new Map<string, string[]>();
  for (const s of systems) {
    for (const g of s.goods) {
      if (surplusDrawable(g.stock, g.targetStock, g.demand, g.production ?? 0) > 0) {
        const list = surplusSystemsByGood.get(g.goodId) ?? [];
        list.push(s.systemId);
        surplusSystemsByGood.set(g.goodId, list);
      }
    }
  }

  // Remaining structural shortfall per (good → systemId → shortfall).
  const remainingByGood = new Map<string, Map<string, number>>();
  for (const d of structural) {
    const m = remainingByGood.get(d.goodId) ?? new Map<string, number>();
    m.set(d.systemId, (m.get(d.systemId) ?? 0) + d.rateDeficit);
    remainingByGood.set(d.goodId, m);
  }

  // Precompute every candidate (site, good) opportunity once — the reachable deficit
  // list depends only on static route costs, so building it here (not per-build) keeps
  // the planner near-linear in the faction's system count.
  const opportunities: BuildOpportunity[] = [];
  for (const [goodId, deficitMap] of remainingByGood) {
    const baseUnit = OUTPUT_PER_UNIT[goodId] ?? 0;
    if (baseUnit <= 0) continue;
    const isTier0 = GOOD_TIER_BY_KEY[goodId] === 0;
    const deficitSystemIds = [...deficitMap.keys()];

    for (const site of working.values()) {
      const capUnits = buildableUnits(site, goodId);
      if (capUnits <= 0) continue;
      if (!isTier0 && !inputsAvailable(goodId, site, surplusSystemsByGood, routeCost)) continue;

      const reachable = deficitSystemIds
        .map((sysId) => ({ sysId, cost: routeCost(site.systemId, sysId) }))
        .filter((r): r is { sysId: string; cost: number } => r.cost !== null && r.cost > 0)
        .sort((a, b) => a.cost - b.cost);
      if (reachable.length === 0) continue;

      // Score family goods at their buffed per-unit so a seeded-complex site already ranks
      // higher (the snowball): buffed output means more served demand per unit of capacity.
      const perUnit = baseUnit * familyAnchorBuff(site.buildings, goodId);

      // Score: allocate this site's output capacity to its reachable deficits,
      // nearest-first, summing served ÷ route cost (capacity + proximity). Ordering only.
      let capOutput = capUnits * perUnit;
      let score = 0;
      for (const r of reachable) {
        if (capOutput <= 0) break;
        const short = deficitMap.get(r.sysId) ?? 0;
        if (short <= 0) continue;
        const take = Math.min(capOutput, short);
        score += take / r.cost;
        capOutput -= take;
      }
      if (score <= 0) continue;

      opportunities.push({ systemId: site.systemId, goodId, perUnit, reachable, score });
    }
  }

  opportunities.sort((a, b) => b.score - a.score);

  for (const opp of opportunities) {
    const site = working.get(opp.systemId);
    if (!site) continue;

    const capUnits = buildableUnits(site, opp.goodId);
    if (capUnits <= 0) continue;

    const deficitMap = remainingByGood.get(opp.goodId);
    if (!deficitMap) continue;

    // Output we can usefully place = Σ over reachable remaining shortfalls, capped by capacity.
    let capOutput = capUnits * opp.perUnit;
    let servedOutput = 0;
    for (const r of opp.reachable) {
      if (capOutput <= 0) break;
      const short = deficitMap.get(r.sysId) ?? 0;
      if (short <= 0) continue;
      const take = Math.min(capOutput, short);
      servedOutput += take;
      capOutput -= take;
    }
    if (servedOutput <= 0) continue;

    // Buffed output per unit against the live working copy (reflects any complex already here) —
    // used to convert served demand into produced output when decrementing the deficit.
    const perUnit = (OUTPUT_PER_UNIT[opp.goodId] ?? 0) * familyAnchorBuff(site.buildings, opp.goodId);

    // Spare-LABOUR gate: a site may add only the production (+ any co-built academies) its
    // already-resident population can staff. Population is a single undifferentiated pool that
    // staffs ALL labour (unskilled + skill1 + skill2 heads) — skill1/skill2 are academy-licensed
    // CEILINGS on how much of that pool may work skilled roles, not separate head pools. Housing
    // built this cycle adds no labour now — population fills it over later ticks — so industry
    // follows the people who already live there, never population that doesn't yet exist.
    const spareLabour = Math.max(0, site.population - labourDemand(site.buildings));
    const remainingGeneral = site.generalSpace - generalSpaceUsed(site.buildings);
    // Tier-0 extractors sit on dedicated deposit slots, not general space (mirrors generalSpaceUsed).
    const prodSpacePerUnit = GOOD_TIER_BY_KEY[opp.goodId] === 0 ? 0 : effectiveSpaceCost(opp.goodId);
    // Full per-unit head count (unskilled + skill1 + skill2) — population staffs the WHOLE labour
    // draw of a production unit, not just its unskilled slice.
    const prodLabourPerUnit = labourTotal(BUILDING_TYPES[opp.goodId]?.labour ?? { unskilled: 0, skill1: 0, skill2: 0 });

    // Whole-level convergence: the desired production floored to whole levels (you commission whole
    // levels), then the academies and complex that GATE it rounded UP — a gate must fully exist to
    // license/anchor the production it serves (a fractional school licenses nobody). The largest
    // whole-level count whose production + gates fit the general space and spare labour is found by
    // binary search: the fit is monotone (more levels ⇒ more space + labour + academy/complex), so a
    // landed level is never unstaffable or over-footprint. Recomputing the lift per candidate level
    // mirrors the fractional planner's convergence on whole levels.
    // Round the served RATE deficit UP to whole levels: capacity is lumpy, so meeting a flow smaller
    // than one level's output still commits one level (the design's accepted overshoot — the excess
    // fills the passive buffer). Flooring here would build NOTHING whenever a system's per-tick demand
    // is below a single building's output, stranding every small consumer. Still capped by physical capacity.
    const maxLevels = Math.min(Math.floor(capUnits), Math.ceil(servedOutput / opp.perUnit));
    if (maxLevels < 1) continue;

    const fitFor = (levels: number) => {
      const a = academyLift(site, opp.goodId, levels);
      const c = complexLift(site, opp.goodId, levels);
      const schools = a.schools > 0 ? Math.ceil(a.schools) : 0;
      const institutes = a.institutes > 0 ? Math.ceil(a.institutes) : 0;
      const complexType = c.complexType;
      const complexLevels = c.count > 0 ? Math.ceil(c.count) : 0;
      const spaceTotal =
        levels * prodSpacePerUnit +
        schools * effectiveSpaceCost(VOCATIONAL_SCHOOL_TYPE) +
        institutes * effectiveSpaceCost(RESEARCH_INSTITUTE_TYPE) +
        (complexType ? complexLevels * effectiveSpaceCost(complexType) : 0);
      const labourNeeded =
        levels * prodLabourPerUnit +
        schools * unskilledPerUnit(VOCATIONAL_SCHOOL_TYPE) +
        institutes * unskilledPerUnit(RESEARCH_INSTITUTE_TYPE) +
        (complexType ? complexLevels * unskilledPerUnit(complexType) : 0);
      const fits = spaceTotal <= remainingGeneral && labourNeeded <= spareLabour;
      return { fits, schools, institutes, complexType, complexLevels };
    };

    let lo = 1;
    let hi = maxLevels;
    let prodLevels = 0;
    let schools = 0;
    let institutes = 0;
    let complexLevels = 0;
    let complexType: string | undefined;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const f = fitFor(mid);
      if (f.fits) {
        prodLevels = mid;
        schools = f.schools;
        institutes = f.institutes;
        complexType = f.complexType;
        complexLevels = f.complexLevels;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (prodLevels < 1) continue;

    // Apply the complex first (any later opportunity at this site sees the buff it grants), then
    // academies (raise the ceiling on the working copy), then the production — gate before production
    // in both the working copy and the bundle's item order, so the funding queue funds the gate first.
    const items: ProposalItem[] = [];
    let work = 0;
    if (complexType && complexLevels > 0) {
      site.buildings[complexType] = (site.buildings[complexType] ?? 0) + complexLevels;
      items.push({ buildingType: complexType, levels: complexLevels });
      work += complexLevels * workCostPerLevel(complexType);
    }

    for (const [type, count] of [
      [VOCATIONAL_SCHOOL_TYPE, schools] as const,
      [RESEARCH_INSTITUTE_TYPE, institutes] as const,
    ]) {
      if (count <= 0) continue;
      site.buildings[type] = (site.buildings[type] ?? 0) + count;
      items.push({ buildingType: type, levels: count });
      work += count * workCostPerLevel(type);
    }

    site.buildings[opp.goodId] = (site.buildings[opp.goodId] ?? 0) + prodLevels;
    items.push({ buildingType: opp.goodId, levels: prodLevels });
    work += prodLevels * workCostPerLevel(opp.goodId);

    // Decrement the served structural demand (nearest-first) so later opportunities don't re-target
    // it, and accumulate what this bundle actually serves — its ROI numerator (`value`).
    let producedOutput = prodLevels * perUnit;
    let value = 0;
    for (const r of opp.reachable) {
      if (producedOutput <= 0) break;
      const short = deficitMap.get(r.sysId) ?? 0;
      if (short <= 0) continue;
      const take = Math.min(producedOutput, short);
      deficitMap.set(r.sysId, short - take);
      producedOutput -= take;
      value += take;
    }

    bundles.push({ systemId: site.systemId, role: "industry", items, value, work });
  }

  return bundles;
}

/**
 * Flat build view of the planner — the same decisions `planFactionBundles` makes, ungrouped, in
 * emission order (housing pass, then industry opportunities by descending score). Kept as the stable
 * unit-test surface for the planner's *what-gets-built* logic, independent of funding order.
 */
export function planFactionBuilds(
  systems: BuildSystemState[],
  routeCost: RouteCost,
): PlannedBuild[] {
  return planFactionBundles(systems, routeCost).flatMap((b) =>
    b.items.map((i) => ({ systemId: b.systemId, buildingType: i.buildingType, count: i.levels })),
  );
}
```

- [ ] **Step 6: Replace `DesiredProject` + `planFactionQueue` with `planFactionProposals`**

Replace the whole tail of the file (the `DesiredProject` interface + `planFactionQueue` function, lines ~603-656) with:

```ts
/**
 * The auto queue policy: emit the whole-level PROPOSALS a faction should fund this pulse. It runs the
 * same ceiling logic as `planFactionBuilds` (proactive housing → labour-gated industry, with
 * academy/complex co-builds), but treats each system's **effective current** capacity as its built
 * levels PLUS the levels already in flight (`openProjects`) — so a level already under construction
 * counts as committed and is never proposed twice. Each returned `BuildProposal` bundles its
 * gate-first items with the served demand (`value`) and total work the funding stage ranks by; the
 * order here is the planner's natural one (housing, then industry by score) — the funding stage
 * (`orderProposals`) does the ROI re-ordering.
 *
 * The throughput pool (not this planner) meters how fast the queue drains; this only decides WHAT to
 * commit, bounded by the physical ceilings the effective-current capacity encodes.
 */
export function planFactionProposals(
  systems: BuildSystemState[],
  routeCost: RouteCost,
  openProjects: WorldConstructionProject[],
): Proposal[] {
  // In-flight levels per (system, buildingType) — the "already committed" capacity.
  const queuedBySystem = new Map<string, Record<string, number>>();
  for (const p of openProjects) {
    const rec = queuedBySystem.get(p.systemId) ?? {};
    rec[p.buildingType] = (rec[p.buildingType] ?? 0) + p.levels;
    queuedBySystem.set(p.systemId, rec);
  }

  // Effective-current systems: fold in-flight levels onto the built base so every capacity, space,
  // and labour gate sees the committed state and the planner only proposes what is NOT yet queued.
  const augmented = systems.map((s) => {
    const queued = queuedBySystem.get(s.systemId);
    if (!queued) return s;
    const buildings = { ...s.buildings };
    for (const [type, levels] of Object.entries(queued)) buildings[type] = (buildings[type] ?? 0) + levels;
    return { ...s, buildings };
  });

  const factionBySystem = new Map(systems.map((s) => [s.systemId, s.factionId]));
  const proposals: Proposal[] = [];
  for (const b of planFactionBundles(augmented, routeCost)) {
    const factionId = factionBySystem.get(b.systemId);
    // Only faction-owned systems can be developed (the build gate), so a bundle always has a faction;
    // the guard both narrows the type and skips the impossible independent-system case.
    if (factionId == null) continue;
    proposals.push({ kind: "build", factionId, systemId: b.systemId, role: b.role, items: b.items, value: b.value, work: b.work });
  }
  return proposals;
}
```

- [ ] **Step 7: Run the directed-build tests to verify they pass**

Run: `npx vitest run lib/engine/__tests__/directed-build.test.ts`
Expected: PASS — the new `planFactionProposals` suite **and** every pre-existing `planFactionBuilds`/`findStructuralDeficits`/… test (the flat wrapper preserves emission order, so the ~30 planner tests prove the same builds are still proposed).

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (note: `lib/tick/processors/directed-build.ts` still imports the removed `planFactionQueue` — it is fixed in Task 3, so a **processor** type error here is expected and acceptable until then; the *engine* module and its test must be clean). If you want a fully-green tsc at each task, do Task 3 before re-running `tsc`; otherwise proceed and rely on Task 3's gate.

- [ ] **Step 9: Commit**

```bash
git add lib/engine/directed-build.ts lib/engine/__tests__/directed-build.test.ts
git commit -m "refactor(colonisation): planner emits value/work proposal bundles"
```

---

## Task 2: ROI ordering — `proposalRoi` + `orderProposals` (`construction.ts`)

Add the funding-queue reorder: housing leads (proactive substrate), then descending bundle-ROI, with a deterministic tiebreak. `fundQueue` stays untouched.

**Files:**
- Modify: `lib/engine/construction.ts`
- Test: `lib/engine/__tests__/construction.test.ts`

**Interfaces:**
- Consumes: `type Proposal` (`lib/engine/directed-build.ts`).
- Produces:
  - `export function proposalRoi(p: Proposal): number` — `value ÷ work` (0 when `work ≤ 0`).
  - `export function orderProposals(proposals: Proposal[]): Proposal[]` — funding-priority order (pure; sorts a copy).

- [ ] **Step 1: Write the failing tests**

Append to `lib/engine/__tests__/construction.test.ts` (add `orderProposals`, `proposalRoi` to the existing `@/lib/engine/construction` import, and a `type Proposal` import from `@/lib/engine/directed-build`):

```ts
import { fundQueue, factionThroughputPool, proposalRoi, orderProposals } from "@/lib/engine/construction";
import type { Proposal } from "@/lib/engine/directed-build";

/** Build a proposal with explicit value/work; `role` defaults to industry. */
function proposal(
  systemId: string,
  items: Array<{ buildingType: string; levels: number }>,
  value: number,
  work: number,
  role: "housing" | "industry" = "industry",
): Proposal {
  return { kind: "build", factionId: "f1", systemId, role, items, value, work };
}

describe("proposalRoi", () => {
  it("is value ÷ whole-bundle work", () => {
    expect(proposalRoi(proposal("s", [{ buildingType: "food", levels: 1 }], 20, 8))).toBeCloseTo(2.5, 6);
  });

  it("is 0 for zero-work or housing (value 0) proposals", () => {
    expect(proposalRoi(proposal("s", [{ buildingType: "food", levels: 1 }], 20, 0))).toBe(0);
    expect(proposalRoi(proposal("s", [{ buildingType: "housing", levels: 1 }], 0, 8, "housing"))).toBe(0);
  });
});

describe("orderProposals", () => {
  it("funds housing ahead of all industry (the proactive substrate leads regardless of ROI)", () => {
    const housing = proposal("s1", [{ buildingType: "housing", levels: 1 }], 0, 8, "housing");
    const richIndustry = proposal("s2", [{ buildingType: "food", levels: 1 }], 100, 4); // ROI 25 ≫ anything
    const ordered = orderProposals([richIndustry, housing]);
    expect(ordered[0]).toBe(housing);
    expect(ordered[1]).toBe(richIndustry);
  });

  it("orders industry by descending ROI (value ÷ work)", () => {
    const lo = proposal("s1", [{ buildingType: "food", levels: 1 }], 10, 20);   // ROI 0.5
    const hi = proposal("s2", [{ buildingType: "ore", levels: 1 }], 30, 20);    // ROI 1.5
    const mid = proposal("s3", [{ buildingType: "gas", levels: 1 }], 20, 20);   // ROI 1.0
    expect(orderProposals([lo, hi, mid]).map((p) => p.systemId)).toEqual(["s2", "s3", "s1"]);
  });

  it("keeps a bundled academy ahead of its production after ordering (gate-first preserved)", () => {
    // A high-work, low-value-looking bundle whose FIRST item is the academy: ordering must not split
    // it — the academy rides the production's bundle ROI and stays in front of the production.
    const gated = proposal("s1", [
      { buildingType: "vocational_school", levels: 1 },
      { buildingType: "electronics", levels: 1 },
    ], 12, 45);
    const other = proposal("s2", [{ buildingType: "food", levels: 1 }], 8, 12);
    const flat = orderProposals([other, gated]).flatMap((p) => p.items.map((i) => i.buildingType));
    expect(flat.indexOf("vocational_school")).toBeLessThan(flat.indexOf("electronics"));
  });

  it("is deterministic under input reordering (stable total order via the systemId tiebreak)", () => {
    const a = proposal("s-a", [{ buildingType: "food", levels: 1 }], 20, 20); // ROI 1.0
    const b = proposal("s-b", [{ buildingType: "ore", levels: 1 }], 20, 20);  // ROI 1.0 (tie)
    const c = proposal("s-c", [{ buildingType: "gas", levels: 1 }], 40, 20);  // ROI 2.0
    const order1 = orderProposals([a, b, c]).map((p) => p.systemId);
    const order2 = orderProposals([c, b, a]).map((p) => p.systemId);
    expect(order1).toEqual(order2);
    expect(order1[0]).toBe("s-c"); // highest ROI first; a/b tie broken by systemId
  });

  it("does not mutate its input array", () => {
    const input = [
      proposal("s1", [{ buildingType: "food", levels: 1 }], 10, 20),
      proposal("s2", [{ buildingType: "ore", levels: 1 }], 30, 20),
    ];
    const snapshot = input.map((p) => p.systemId);
    orderProposals(input);
    expect(input.map((p) => p.systemId)).toEqual(snapshot);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/engine/__tests__/construction.test.ts`
Expected: FAIL — `proposalRoi` / `orderProposals` not exported.

- [ ] **Step 3: Add `proposalRoi` + `orderProposals` to `construction.ts`**

Add the import at the top of `lib/engine/construction.ts` (after the existing imports):

```ts
import type { Proposal } from "@/lib/engine/directed-build";
```

Append at the end of the file:

```ts
/** ROI of a proposal on the shared construction pool: served value ÷ whole-bundle work (0 if no work). */
export function proposalRoi(p: Proposal): number {
  return p.work > 0 ? p.value / p.work : 0;
}

/** Housing leads population — the proactive substrate funds ahead of ROI-ranked opportunities. */
function isHousing(p: Proposal): boolean {
  return p.kind === "build" && p.role === "housing";
}

/**
 * Order this pulse's new proposals into funding priority (front = funded first) — the reorder of
 * `fundQueue`'s input the value-order model prescribes (docs/planned/economy-colonisation-cost.md §4):
 *   1. housing — the proactive population substrate leads (no served-demand ROI of its own);
 *   2. everything else by descending ROI (value ÷ whole-bundle work).
 * Ties break by systemId then first-item type, a total order independent of input order (determinism).
 * A proposal is atomic — its gate-first `items` are never split, so a bundled academy stays ahead of
 * the production it gates. The caller expands each proposal into its item rows and prepends the
 * in-flight projects (already-committed work finishes first); `fundQueue` then drains front-first.
 * Pure: sorts a copy, never mutates the input.
 */
export function orderProposals(proposals: Proposal[]): Proposal[] {
  const tiebreak = (p: Proposal): string => `${p.systemId}|${p.items[0]?.buildingType ?? ""}`;
  return [...proposals].sort((a, b) => {
    const ah = isHousing(a);
    const bh = isHousing(b);
    if (ah !== bh) return ah ? -1 : 1; // housing first
    if (!ah) {
      const dRoi = proposalRoi(b) - proposalRoi(a); // then descending ROI
      if (Math.abs(dRoi) > 1e-12) return dRoi;
    }
    return tiebreak(a).localeCompare(tiebreak(b)); // deterministic within a tier / ROI tie
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/engine/__tests__/construction.test.ts`
Expected: PASS (new `proposalRoi`/`orderProposals` tests + the untouched `fundQueue`/`factionThroughputPool` tests).

- [ ] **Step 5: Typecheck the engine layer**

Run: `npx tsc --noEmit`
Expected: no NEW engine errors. (The processor still references `planFactionQueue` until Task 3 — that one error is expected; the engine files must be clean.)

- [ ] **Step 6: Commit**

```bash
git add lib/engine/construction.ts lib/engine/__tests__/construction.test.ts
git commit -m "feat(colonisation): value-order proposal ranking (housing-leads, ROI-desc)"
```

---

## Task 3: Rewire the processor's funding half (`processors/directed-build.ts`)

Feed `planFactionProposals` → `orderProposals` → expand gate-first into minted projects → `fundQueue([...existing, ...new])`. In-flight projects still lead all new proposals; housing still leads industry.

**Files:**
- Modify: `lib/tick/processors/directed-build.ts`
- Test: `lib/tick/processors/__tests__/directed-build.test.ts`

**Interfaces:**
- Consumes: `planFactionProposals` (`lib/engine/directed-build.ts`), `orderProposals` + `fundQueue` + `factionThroughputPool` (`lib/engine/construction.ts`), `workCostPerLevel` (already imported).
- Produces: no signature change — `runDirectedBuildProcessor` keeps its params and world-adapter contract. Only the internal build-funding block changes.

- [ ] **Step 1: Write the failing / regression tests**

Append to `lib/tick/processors/__tests__/directed-build.test.ts`:

```ts
describe("runDirectedBuildProcessor — value-order funding", () => {
  // The queue is [in-flight, ...new proposals in funding order]; with a tiny cap nothing lands, so
  // w.constructionProjects preserves that order and we can assert priority by index.
  function idx(w: MemoryDirectedBuildWorld, systemId: string, type: string): number {
    return w.constructionProjects.findIndex((p) => p.systemId === systemId && p.buildingType === type);
  }

  it("funds housing ahead of industry at the same builder (proactive substrate leads)", async () => {
    // scenario(0,0): A has a deep food deficit, B is a developed builder with habitable land →
    // B gets both a housing proposal and a food industry proposal. Housing must sort first.
    const w = new MemoryDirectedBuildWorld(scenario(0, 0));
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4) });
    const housingIdx = idx(w, "B", "housing");
    const foodIdx = idx(w, "B", "food");
    expect(housingIdx).toBeGreaterThanOrEqual(0);
    expect(foodIdx).toBeGreaterThanOrEqual(0);
    expect(housingIdx).toBeLessThan(foodIdx);
  });

  it("keeps in-flight projects ahead of newly proposed work", async () => {
    const existing: WorldConstructionProject = {
      id: "e", factionId: "f1", systemId: "B", buildingType: "food", levels: 2, workTotal: 24, workDone: 0,
    };
    const w = new MemoryDirectedBuildWorld(scenario(0, 0), [existing]);
    await runDirectedBuildProcessor(w, { tick: DUE_TICK }, { interval: INTERVAL, routeCost: reachable, construction: mkConstruction(4) });
    // The pre-existing project is at the front of the queue → it absorbs the (single-cap) pool first.
    expect(w.constructionProjects[0]?.id).toBe("e");
    expect(w.constructionProjects[0]?.workDone).toBe(4);
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail (or the file fails to compile)**

Run: `npx vitest run lib/tick/processors/__tests__/directed-build.test.ts`
Expected: FAIL to compile — the processor still imports the removed `planFactionQueue` (Task 1 deleted it), so the whole file errors. This is the signal to rewire the processor.

- [ ] **Step 3: Update the processor imports**

In `lib/tick/processors/directed-build.ts`, change the two engine imports (lines ~3-4):

```ts
import { planFactionProposals, type BuildSystemState } from "@/lib/engine/directed-build";
import { fundQueue, factionThroughputPool, orderProposals } from "@/lib/engine/construction";
```

- [ ] **Step 4: Rewire the per-faction funding block**

Replace the body of the `for (const [factionId, group] of byFaction)` loop (lines ~145-171 — from `const pool = …` through the closing `}` of the `for (const l of landed)` block) with:

```ts
    // The faction's per-pulse throughput pool: developed systems fund it (controlled/unclaimed
    // systems are inert with population 0). The pool drains the queue; it never enqueues.
    const pool = factionThroughputPool(group, params.construction.throughputPerPop);

    const existing = openByFaction.get(factionId) ?? [];
    // Auto policy proposes new whole-level PROPOSALS toward the ceilings, aware of what is in flight;
    // value-order ranking (housing-leads, then descending bundle-ROI) reorders them before funding.
    const proposals = planFactionProposals(group.map(toBuildState), params.routeCost, existing);
    const ordered = orderProposals(proposals);

    // Expand each proposal gate-first into its whole-level project rows (its `items` are already in
    // complex → academies → production order). fundQueue never sees the ROI — the ordering is done.
    const newProjects: WorldConstructionProject[] = [];
    for (const p of ordered) {
      for (const item of p.items) {
        newProjects.push({
          id: params.construction.mintId(),
          factionId: p.factionId,
          systemId: p.systemId,
          buildingType: item.buildingType,
          levels: item.levels,
          workTotal: item.levels * workCostPerLevel(item.buildingType),
          workDone: 0,
        });
      }
    }

    // Fund front-first: in-flight work finishes before new commitments; land completed levels.
    const { projects: fundedOpen, landed } = fundQueue([...existing, ...newProjects], pool, params.construction.cap);
    nextOpen.push(...fundedOpen);
    for (const l of landed) {
      const byType = landedBySystem.get(l.systemId) ?? new Map<string, number>();
      byType.set(l.buildingType, (byType.get(l.buildingType) ?? 0) + l.levels);
      landedBySystem.set(l.systemId, byType);
    }
```

- [ ] **Step 5: Update the processor JSDoc**

In the `runDirectedBuildProcessor` doc comment (lines ~71-82), replace the sentence beginning "Construction is committed and throughput-paced: each due faction's auto queue policy (`planFactionQueue`) proposes whole-level projects…" with:

```ts
 * Construction is committed and throughput-paced: each due faction's auto queue policy
 * (`planFactionProposals`) proposes whole-level bundles toward its ceilings (subtracting the levels
 * already in flight); `orderProposals` ranks them by value (housing leads, then descending bundle-ROI)
 * and each is expanded gate-first into project rows; the faction's per-pulse throughput pool funds the
 * front-first queue (`fundQueue`, in-flight first) at a per-build absorption cap, and only projects
 * whose work COMPLETES land — applied as whole-integer building-count increments. The open-project set
 * is persisted each pulse (funded, plus new commitments, minus what landed). Removal of levels stays
 * whole-level decay's job — this only adds.
```

- [ ] **Step 6: Run the processor tests to verify they pass**

Run: `npx vitest run lib/tick/processors/__tests__/directed-build.test.ts`
Expected: PASS — the two new value-order tests **and** all pre-existing processor tests (single-faction scenarios preserve housing-then-industry order, so nothing regresses).

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (the removed `planFactionQueue` reference is gone; the whole graph is consistent).

- [ ] **Step 8: Commit**

```bash
git add lib/tick/processors/directed-build.ts lib/tick/processors/__tests__/directed-build.test.ts
git commit -m "feat(colonisation): fund build proposals in value order (gate-first, in-flight-first)"
```

---

## Task 4: PR verification gate

**Files:** none (verification only).

- [ ] **Step 1: Full unit suite**

Run: `npx vitest run`
Expected: PASS — the whole suite green. The ~30 `planFactionBuilds` tests prove the same builds are proposed; the new proposal/ordering/wiring tests prove the value-order funding.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Production build gate**

Run: `npx next build --webpack`
Expected: build succeeds (the PR-gate build per `CLAUDE.md`).

- [ ] **Step 4: Simulator sanity (behaviour coherence, not exact parity)**

Run: `npm run simulate`
Expected: the run completes with **no NaN/Infinity and no crash**; the build loop still functions (homeworlds/colonies build out; colonisation metrics comparable to pre-PR2 — colonies are not added until PR3, so the metric surface is unchanged) and greedy ≫ random still holds. This confirms the ROI reorder did not destabilise pacing. Note (per `dev-coherence-over-parity`): funding *order* changed, so exact per-pulse counts may differ from the pre-PR2 run — verify intrinsic coherence, not bit-identical output.

- [ ] **Step 5: Confirm the removed symbols are gone and the new surface is wired**

Run: `git grep -n "planFactionQueue\|DesiredProject" -- lib`
Expected: no matches (both retired).

Run: `git grep -n "planFactionProposals\|orderProposals\|proposalRoi" -- lib`
Expected: matches only in `lib/engine/directed-build.ts`, `lib/engine/construction.ts`, `lib/tick/processors/directed-build.ts`, and their `__tests__`. `colonisation-value.ts` is still uncalled (that wiring is PR3).

---

## Self-Review

**1. Spec coverage (PR2 scope = §4 value-order funding, builds only):**
- Proposal is the ROI-carrying unit; `BuildProposal` bundles production + gating academies/complex → `BuildProposal` type + `planFactionBundles` emission (Task 1). ✓
- ROI on the bundle (production served value ÷ whole-bundle work) → `value`/`work` accumulation (Task 1) + `proposalRoi` (Task 2). ✓
- Funding orders proposals by descending ROI, expands gate-first; `fundQueue` stays the decision-free front-first drainer → `orderProposals` (Task 2, `fundQueue` untouched) + processor expansion (Task 3). ✓
- In-flight projects finish before equal-ROI newcomers → `[...existing, ...newProjects]` (Task 3) + regression test. ✓
- Regression: an academy/complex (standalone value ≈ 0) still funds before the production it gates rather than sorting last → bundling keeps it in the production's proposal; tested in Task 1 (bundle membership + gate-first items), Task 2 (`orderProposals` never splits a bundle), Task 3 (wired order). ✓
- **Deferred to PR3 (correctly out of scope):** `ColonyProposal` + the union widening, `colonyValue` wiring, `WorldConstructionProject` discrimination, save/load, retiring `MAX_DEVELOPS_PER_PULSE`, `applyDevelopments` extension, the `COLONISATION` constants. Each is named in the PR Roadmap.

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"write tests for the above" — every code step ships complete code, every run step an exact command + expected result. ✓

**3. Type consistency:** `ProposalItem`/`BuildProposal`/`Proposal` are defined in Task 1 and consumed unchanged by Task 2 (`proposalRoi`/`orderProposals` take `Proposal`) and Task 3 (`planFactionProposals` returns `Proposal[]`, processor reads `p.items`/`p.factionId`/`p.systemId`). `role`/`value`/`work`/`kind` names match across producer, orderer, and processor. `planFactionBuilds` keeps its exact prior signature (`(systems, routeCost) => PlannedBuild[]`), so the ~30 existing tests compile untouched. `workCostPerLevel(buildingType)` is used identically in the planner (`work` accrual) and the processor (`workTotal`), so a bundle's `work` equals the Σ of its minted rows' `workTotal` — the ROI denominator and the funded work agree. ✓

**4. Behaviour-preservation check:** `planFactionBundles` is the old `planFactionBuilds` body with only the emission changed (flat push → grouped push) and `value`/`work` accumulated; all decision math (gates, scoring, binary-search fit, deficit decrement, working-copy mutation order) is byte-identical, and `perUnit` for the deficit decrement is still computed before the complex is applied — so the *set of builds proposed* is unchanged and the flat wrapper's emission order matches the old function exactly. The only intended behaviour change is the *funding order* of new industry (descending ROI vs descending route-score); housing-leads and in-flight-first are preserved. ✓

**5. Determinism / serializability:** `orderProposals` uses an epsilon ROI compare + a `systemId|firstItemType` total-order tiebreak → identical output regardless of input order. `Proposal` is transient (never stored in `World`); only `WorldConstructionProject` rows reach `World`, with finite `workTotal`/`workDone` exactly as before — no `Infinity`/`NaN` path is introduced (`proposalRoi` guards `work ≤ 0`). ✓

**6. Import-cycle check:** `construction.ts` adds a **type-only** import of `Proposal` from `directed-build.ts`; `directed-build.ts` imports only the pure constant `workCostPerLevel` from `constants/construction.ts` (not the engine `construction.ts`), so no runtime cycle is created. ✓
