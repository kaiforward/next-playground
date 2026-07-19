# Needs Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface per-good pop satisfaction (the variable that actually drives unrest) on three approved
UI surfaces, replacing the confusing demand-footprint chart and its "market minimum" tail.

**Architecture:** One new pure engine function (`computePopNeeds`) recomputes per-good satisfaction
read-side from stored market rows (stock vs the market band — the same `selfLimitingFactor` signal the
unrest maths uses; no tick changes). Two services thread it to the client; three component surfaces
render it: (1) the Population tab's needs ledger (replaces the demand chart), (2) a pop-pressure chip
on the Industry health strip, (3) exception-only problem lines on Industry producer rows (the
always-green input list demotes to the row tooltip). Approved wireframe:
`needs-visibility-wireframes.html` (scratchpad, V2 section — copied nowhere; this doc is the record).

**Tech Stack:** Existing stack only — pure engine fn + services + React components, Vitest.

## Global Constraints

- No `as` casts, no `unknown`, no `!` (except `find(...)!` in tests). Typed union keys.
- Engine functions pure — no `fs`/`process.env`/store imports in `lib/engine/`.
- Severity thresholds (design-approved): `met` ≥ 0.95, `short` ≥ 0.5, `critical` < 0.5. Glyphs ✓ / ⚠ / ▼
  (shape-first, never colour alone), colours = existing `text-status-green-light` / `-amber-light` / `-red-light`.
- Sort = pressure descending (`demandShare × (1 − satisfaction)²`, matching `dissatisfaction()` in
  `lib/engine/population.ts:34`), ties by want descending. Met goods collapse behind one expandable row.
- Tooltip language: figures + the single sentence "Higher-pressure needs create more unrest." — no
  other prose (final language waits for the nested-tooltip pass).
- Column label is the full word "Delivered". If it visibly squashes at real width, widen the detail
  sidebar slightly (Kai pre-approved) — never abbreviate.
- The `MIN_DEMAND` pricing floor stays in the engine untouched — only its UI representation dies.
- Build gate: `npx next build --webpack`. Tests: `npx vitest run`.

---

### Task 1: Pure engine `computePopNeeds`

**Files:**
- Create: `lib/engine/pop-needs.ts`
- Test: `lib/engine/__tests__/pop-needs.test.ts`

**Interfaces:**
- Consumes: `consumptionRate`, `consumptionBreakdown`, `CivilianDemandBasis`, `ConsumptionBreakdown`
  (`lib/engine/physical-economy.ts`); `marketBandForRow` (`lib/engine/market-pricing.ts`);
  `selfLimitingFactor` (`lib/engine/tick.ts`); `GOOD_CONSUMPTION`, `SKILL1_CONSUMPTION`,
  `SKILL2_CONSUMPTION` (`lib/constants/physical-economy.ts`); `GOODS` (`lib/constants/goods.ts`).
- Produces:
  ```ts
  export interface PopNeed {
    goodId: string;
    want: number;          // civilian consumptionRate (unfloored — NOT the MIN_DEMAND-floored figure)
    satisfaction: number;  // [0,1] — selfLimitingFactor(stock, band.minStock, band.targetStock, "consume")
    delivered: number;     // want × satisfaction
    pressure: number;      // demandShare × (1 − satisfaction)²
    breakdown: ConsumptionBreakdown;
  }
  export interface PopNeedsMarketRow {
    goodId: string; stock: number; demandRate: number; storageCapacity: number; anchorMult: number;
  }
  export function computePopNeeds(basis: CivilianDemandBasis, markets: PopNeedsMarketRow[]): PopNeed[]
  ```

- [ ] **Step 1: Write the failing test**

```ts
// lib/engine/__tests__/pop-needs.test.ts
import { describe, expect, it } from "vitest";
import { computePopNeeds, type PopNeedsMarketRow } from "@/lib/engine/pop-needs";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import { consumptionRate } from "@/lib/engine/physical-economy";
import { GOOD_CONSUMPTION } from "@/lib/constants/physical-economy";
import { GOODS } from "@/lib/constants/goods";

const basis = { population: 1000, technicians: 50, engineers: 10 };

/** Two consumed goods with a real per-capita need, one big one small (by base rate). */
const consumedIds = Object.keys(GOOD_CONSUMPTION)
  .filter((id) => GOOD_CONSUMPTION[id] > 0 && GOODS[id])
  .sort((a, b) => GOOD_CONSUMPTION[b] - GOOD_CONSUMPTION[a]);
const bigGood = consumedIds[0];
const smallGood = consumedIds[consumedIds.length - 1];

function row(goodId: string, stockAt: "min" | "target" | "mid"): PopNeedsMarketRow {
  const demandRate = consumptionRate(goodId, basis);
  const base = { goodId, demandRate, storageCapacity: 0, anchorMult: 1 };
  const band = marketBandForRow(base, GOODS[goodId]);
  const stock =
    stockAt === "min" ? band.minStock : stockAt === "target" ? band.targetStock : (band.minStock + band.targetStock) / 2;
  return { ...base, stock };
}

describe("computePopNeeds", () => {
  it("satisfaction is 1 at target stock, 0 at the band floor, delivered = want × satisfaction", () => {
    const needs = computePopNeeds(basis, [row(bigGood, "target"), row(smallGood, "min")]);
    const fed = needs.find((n) => n.goodId === bigGood)!;
    const starved = needs.find((n) => n.goodId === smallGood)!;
    expect(fed.satisfaction).toBeCloseTo(1, 5);
    expect(fed.delivered).toBeCloseTo(fed.want, 5);
    expect(starved.satisfaction).toBe(0);
    expect(starved.delivered).toBe(0);
    expect(fed.want).toBeCloseTo(consumptionRate(bigGood, basis), 5);
  });

  it("pressure weights by demand share: a big-demand moderate shortage outranks a small-demand deep one", () => {
    const needs = computePopNeeds(basis, [row(bigGood, "mid"), row(smallGood, "min")]);
    const big = needs.find((n) => n.goodId === bigGood)!;
    const small = needs.find((n) => n.goodId === smallGood)!;
    // big: huge share × moderate gap² ; small: tiny share × gap²=1 — the share term must dominate.
    expect(big.pressure).toBeGreaterThan(small.pressure);
  });

  it("pressures use demand shares (sum over goods of share = 1 when all fully starved)", () => {
    const needs = computePopNeeds(basis, consumedIds.map((id) => row(id, "min")));
    const total = needs.reduce((s, n) => s + n.pressure, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it("excludes goods this basis does not want, and treats a missing market row as satisfaction 0", () => {
    const zeroBasis = { population: 0, technicians: 0, engineers: 0 };
    expect(computePopNeeds(zeroBasis, [row(bigGood, "target")])).toEqual([]);
    const needs = computePopNeeds(basis, []); // wanted goods, no market rows at all
    const anyNeed = needs.find((n) => n.goodId === bigGood)!;
    expect(anyNeed.satisfaction).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/engine/__tests__/pop-needs.test.ts`
Expected: FAIL — `Cannot find module '@/lib/engine/pop-needs'`

- [ ] **Step 3: Write the implementation**

```ts
// lib/engine/pop-needs.ts
/**
 * Read-side per-good pop-needs snapshot — the display projection of the exact
 * signal the unrest spine integrates. Satisfaction is the consume-direction
 * self-limiting factor on the market band (what the economy pulse applies as
 * the consumption gate); pressure is the same demand-share × gap² term
 * `dissatisfaction()` sums. Pure — callers pass market rows and a demand basis.
 */
import { consumptionBreakdown, consumptionRate, type CivilianDemandBasis, type ConsumptionBreakdown } from "@/lib/engine/physical-economy";
import { marketBandForRow } from "@/lib/engine/market-pricing";
import { selfLimitingFactor } from "@/lib/engine/tick";
import { GOOD_CONSUMPTION, SKILL1_CONSUMPTION, SKILL2_CONSUMPTION } from "@/lib/constants/physical-economy";
import { GOODS } from "@/lib/constants/goods";

export interface PopNeed {
  goodId: string;
  /** Civilian want (unfloored consumptionRate — NOT the MIN_DEMAND-floored pricing figure). */
  want: number;
  /** [0,1] — the consume gate at current stock; 1 = fully met. */
  satisfaction: number;
  /** want × satisfaction. */
  delivered: number;
  /** demandShare × (1 − satisfaction)² — this good's term in the system's dissatisfaction sum. */
  pressure: number;
  breakdown: ConsumptionBreakdown;
}

/** The market-row fields needed to place stock on its band. */
export interface PopNeedsMarketRow {
  goodId: string;
  stock: number;
  demandRate: number;
  storageCapacity: number;
  anchorMult: number;
}

/** Every good either tier of the basis consumes (union of the three basket catalogues). */
function consumedGoodIds(): string[] {
  const ids = new Set<string>([
    ...Object.keys(GOOD_CONSUMPTION),
    ...Object.keys(SKILL1_CONSUMPTION),
    ...Object.keys(SKILL2_CONSUMPTION),
  ]);
  return [...ids].filter((id) => GOODS[id] !== undefined);
}

/**
 * Per-good needs for one system, pressure-sorted descending (ties by want).
 * A wanted good with no market row reads satisfaction 0 (nothing to draw from).
 */
export function computePopNeeds(basis: CivilianDemandBasis, markets: PopNeedsMarketRow[]): PopNeed[] {
  const rowByGood = new Map(markets.map((m) => [m.goodId, m]));
  const wanted = consumedGoodIds()
    .map((goodId) => ({ goodId, want: consumptionRate(goodId, basis) }))
    .filter((g) => g.want > 0);
  const totalWant = wanted.reduce((s, g) => s + g.want, 0);
  if (totalWant <= 0) return [];

  return wanted
    .map(({ goodId, want }) => {
      const row = rowByGood.get(goodId);
      let satisfaction = 0;
      if (row) {
        const band = marketBandForRow(row, GOODS[goodId]);
        satisfaction = selfLimitingFactor(row.stock, band.minStock, band.targetStock, "consume");
      }
      const gap = 1 - satisfaction;
      return {
        goodId,
        want,
        satisfaction,
        delivered: want * satisfaction,
        pressure: (want / totalWant) * gap * gap,
        breakdown: consumptionBreakdown(goodId, basis),
      };
    })
    .sort((a, b) => b.pressure - a.pressure || b.want - a.want);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/engine/__tests__/pop-needs.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/engine/pop-needs.ts lib/engine/__tests__/pop-needs.test.ts
git commit -m "feat(needs): pure per-good pop-needs snapshot (want/satisfaction/delivered/pressure)"
```

---

### Task 2: Population service returns needs; retire the floored footprint

**Files:**
- Modify: `lib/services/system-population.ts`
- Modify: `lib/types/api.ts:150-174` (PopulationDemandEntry → PopNeedData; `demand` → `needs`)
- Modify: `lib/constants/market-economy.ts:87-101` (delete `demandFootprint` — sole consumer was this service; verify with `rg "demandFootprint"` first and abort the deletion if other callers exist)
- Test: existing `npx vitest run lib/services` must stay green (no service test exists for this file today; the engine test covers the maths)

**Interfaces:**
- Consumes: `computePopNeeds`, `PopNeed` (Task 1); `marketsBySystem` (`lib/services/world-index.ts:23`).
- Produces (client-facing):
  ```ts
  export interface PopNeedData {
    goodId: string; goodName: string;
    want: number; delivered: number; satisfaction: number; pressure: number;
    breakdown: ConsumptionBreakdown;
  }
  // SystemPopulationData "visible" arm: demand: PopulationDemandEntry[] → needs: PopNeedData[]
  ```

- [ ] **Step 1: Update `lib/types/api.ts`** — replace `PopulationDemandEntry` (lines 151-159) with `PopNeedData` as above (keep the doc comments style: `want` = civilian want/cyc unfloored; `satisfaction` = delivered ÷ want in [0,1]); in `SystemPopulationData` replace `demand: PopulationDemandEntry[]` with `needs: PopNeedData[]` (comment: "Pop needs, pressure-sorted descending — the goods the population consumes and how met each want is.").

- [ ] **Step 2: Rewrite the service mapping** in `lib/services/system-population.ts` — replace the `demandFootprint` import + `demand` mapping (lines 5, 27-33, 41) with:

```ts
import { computePopNeeds } from "@/lib/engine/pop-needs";
import { marketsBySystem } from "@/lib/services/world-index";
// (drop the demandFootprint and consumptionBreakdown imports)

  const needs = computePopNeeds(basis, marketsBySystem().get(systemId) ?? []).map((n) => ({
    ...n,
    goodName: GOODS[n.goodId]?.name ?? n.goodId,
  }));

  return { visibility: "visible", population: system.population, popCap: system.popCap, unrest: system.unrest, striking: system.unrest >= STRIKE_PARAMS.threshold, needs };
```

(`WorldMarket` rows satisfy `PopNeedsMarketRow` structurally — `systemId` is an extra field, which TS allows.)

- [ ] **Step 3: Delete `demandFootprint`** from `lib/constants/market-economy.ts` after `rg "demandFootprint" --files-with-matches` shows only `market-economy.ts` itself (and its test if one names it — update `lib/constants/__tests__/market-economy.test.ts` accordingly).

- [ ] **Step 4: Typecheck + tests** — `npx tsc --noEmit` will now flag every consumer of the old shape (`use-system-population.ts` typing flows through `SystemPopulationData` automatically; `population-panel.tsx` + `demand-chart.ts` break — expected, they're Task 3's job; leave them red only if executing Tasks 2+3 in one sitting, otherwise stub the panel to compile by rendering nothing for needs). Prefer: do Tasks 2 and 3 back-to-back, then run checks.

- [ ] **Step 5: Commit** (with Task 3, or alone if the panel was stubbed compilable)

```bash
git add -A && git commit -m "feat(needs): population service serves pressure-sorted needs; retire floored demand footprint"
```

---

### Task 3: Population panel — the needs ledger

**Files:**
- Create: `components/system/needs-view.ts` (shared view-model: severity, glyphs, ledger split)
- Rewrite: `components/system/demand-chart.ts` → delete (its floor series and bars die with it)
- Modify: `components/system/population-panel.tsx`
- Test: `components/system/needs-view.test.ts`

**Interfaces:**
- Consumes: `PopNeedData` (Task 2).
- Produces (used again in Task 4):
  ```ts
  export type NeedSeverity = "met" | "short" | "critical";
  export function needSeverity(satisfaction: number): NeedSeverity; // ≥0.95 met, ≥0.5 short, else critical
  export const SEVERITY_GLYPH: Record<NeedSeverity, string>;        // met "✓", short "⚠", critical "▼"
  export const SEVERITY_TEXT: Record<NeedSeverity, string>;         // text-status-{green,amber,red}-light
  export interface NeedsLedgerRows<T extends { satisfaction: number }> { problems: T[]; met: T[] }
  export function splitNeedsLedger<T extends { satisfaction: number }>(needs: T[]): NeedsLedgerRows<T>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// components/system/needs-view.test.ts
import { describe, expect, it } from "vitest";
import { needSeverity, splitNeedsLedger, SEVERITY_GLYPH } from "@/components/system/needs-view";

describe("needs view-model", () => {
  it("classifies severity at the approved thresholds", () => {
    expect(needSeverity(1)).toBe("met");
    expect(needSeverity(0.95)).toBe("met");
    expect(needSeverity(0.949)).toBe("short");
    expect(needSeverity(0.5)).toBe("short");
    expect(needSeverity(0.499)).toBe("critical");
  });
  it("splits problems from met, preserving input (pressure) order", () => {
    const rows = [{ satisfaction: 0.6 }, { satisfaction: 1 }, { satisfaction: 0.4 }, { satisfaction: 0.99 }];
    const { problems, met } = splitNeedsLedger(rows);
    expect(problems.map((r) => r.satisfaction)).toEqual([0.6, 0.4]);
    expect(met.map((r) => r.satisfaction)).toEqual([1, 0.99]);
  });
  it("glyphs are shape-distinct", () => {
    expect(new Set(Object.values(SEVERITY_GLYPH)).size).toBe(3);
  });
});
```

- [ ] **Step 2: Run to fail** — `npx vitest run components/system/needs-view.test.ts` → FAIL (module missing)

- [ ] **Step 3: Implement `needs-view.ts`**

```ts
// components/system/needs-view.ts
/** Shared needs view-model — severity thresholds, glyphs, ledger split. No DOM, no React. */
export type NeedSeverity = "met" | "short" | "critical";

export function needSeverity(satisfaction: number): NeedSeverity {
  if (satisfaction >= 0.95) return "met";
  if (satisfaction >= 0.5) return "short";
  return "critical";
}

/** Shape-first (colourblind-safe) severity glyphs. */
export const SEVERITY_GLYPH: Record<NeedSeverity, string> = { met: "✓", short: "⚠", critical: "▼" };
export const SEVERITY_TEXT: Record<NeedSeverity, string> = {
  met: "text-status-green-light",
  short: "text-status-amber-light",
  critical: "text-status-red-light",
};

export interface NeedsLedgerRows<T extends { satisfaction: number }> { problems: T[]; met: T[] }

/** Split pressure-sorted needs into inline problem rows and the collapsed met tail (order preserved). */
export function splitNeedsLedger<T extends { satisfaction: number }>(needs: T[]): NeedsLedgerRows<T> {
  return {
    problems: needs.filter((n) => needSeverity(n.satisfaction) !== "met"),
    met: needs.filter((n) => needSeverity(n.satisfaction) === "met"),
  };
}
```

- [ ] **Step 4: Run to pass** — `npx vitest run components/system/needs-view.test.ts` → PASS

- [ ] **Step 5: Rewrite the panel section.** Delete `components/system/demand-chart.ts`. In
`population-panel.tsx`, remove `DemandSwatch`/`DemandLegend`/`DemandTooltip`/`DemandBarRow`/`DemandChart`
and the `FLOOR_HATCH` constant; replace the "Demand footprint" card with a "Needs" card rendering
`NeedsLedger`:

```tsx
// population-panel.tsx — new pieces (tier swatch colours: base #d06a42 / technicians #0891b2 / engineers #a855f7)
const TIER_META = [
  { key: "base", label: "Base population", color: "#d06a42" },
  { key: "technicians", label: "Technicians", color: "#0891b2" },
  { key: "engineers", label: "Engineers", color: "#a855f7" },
] as const;

function NeedTooltip({ n }: { n: PopNeedData }) {
  const sev = needSeverity(n.satisfaction);
  return (
    <div className="space-y-1 text-xs">
      <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1">
        <span className="font-display text-text-primary">{n.goodName}</span>
        <span className={`font-mono ${SEVERITY_TEXT[sev]}`}>{SEVERITY_GLYPH[sev]} {Math.round(n.satisfaction * 100)}% met</span>
      </div>
      <p className="font-mono text-text-secondary">
        want {n.want.toFixed(2)}/cyc · delivered {n.delivered.toFixed(2)}/cyc · pressure {n.pressure.toFixed(2)}
      </p>
      <div className="space-y-0.5 border-t border-border/60 pt-1">
        {TIER_META.map((t) => (
          <div key={t.key} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-text-secondary">
              <span aria-hidden className="inline-block h-2 w-2" style={{ backgroundColor: t.color }} /> {t.label}
            </span>
            <span className="font-mono text-text-primary">{n.breakdown[t.key].toFixed(2)}/cyc</span>
          </div>
        ))}
      </div>
      <p className="border-t border-border/60 pt-1 text-text-secondary">Higher-pressure needs create more unrest.</p>
    </div>
  );
}

function NeedRow({ n }: { n: PopNeedData }) {
  const sev = needSeverity(n.satisfaction);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <tr tabIndex={0} className="border-b border-border/40 outline-none last:border-b-0 focus-visible:ring-1 focus-visible:ring-accent">
          <td className="px-1.5 py-1 text-xs text-text-primary">
            <span aria-label={sev} className={`mr-1.5 font-mono text-[10px] ${SEVERITY_TEXT[sev]}`}>{SEVERITY_GLYPH[sev]}</span>
            {n.goodName}
          </td>
          <td className={`px-1.5 py-1 text-right font-mono text-[11px] ${SEVERITY_TEXT[sev]}`}>{Math.round(n.satisfaction * 100)}%</td>
          <td className="px-1.5 py-1 text-right font-mono text-[11px] text-text-secondary">{n.want.toFixed(1)}</td>
          <td className="px-1.5 py-1 text-right font-mono text-[11px] text-text-secondary">{n.delivered.toFixed(1)}</td>
        </tr>
      </TooltipTrigger>
      <TooltipContent className="w-64"><NeedTooltip n={n} /></TooltipContent>
    </Tooltip>
  );
}

function NeedsLedger({ needs }: { needs: PopNeedData[] }) {
  const [expanded, setExpanded] = useState(false);
  const { problems, met } = splitNeedsLedger(needs);
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          {["Need", "Met", "Want", "Delivered"].map((h, i) => (
            <th key={h} className={`border-b border-border-strong px-1.5 py-1 font-display text-[10px] font-semibold uppercase tracking-wider text-text-tertiary ${i > 0 ? "text-right" : "text-left"}`}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {problems.map((n) => <NeedRow key={n.goodId} n={n} />)}
        {met.length > 0 && !expanded && (
          <tr>
            <td colSpan={4} className="px-1.5 py-1.5 text-xs text-text-tertiary">
              <button type="button" onClick={() => setExpanded(true)} className="inline-flex items-center gap-1.5 hover:text-text-secondary">
                <span aria-hidden className="font-mono text-[10px] text-status-green-light">✓</span>
                {met.length} needs met <span className="font-mono text-[10px]">▸ expand</span>
              </button>
            </td>
          </tr>
        )}
        {expanded && met.map((n) => <NeedRow key={n.goodId} n={n} />)}
      </tbody>
    </table>
  );
}
```

Card copy: header "Needs", sub-line `"What the population consumes and how well each want is met — unmet needs drive unrest."` Empty state unchanged. `demand.length === 0` check becomes `needs.length === 0`.

- [ ] **Step 6: Checks** — `npx tsc --noEmit` clean; `npx vitest run` clean.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(needs): population needs ledger replaces the demand chart (market-minimum tail removed)"
```

---

### Task 4: Industry surfaces — pop-pressure chip + exception-only problem lines

**Files:**
- Modify: `lib/types/api.ts` (add `popNeeds: PopNeedData[]` to the visible arm of `SystemIndustryData`)
- Modify: `lib/services/universe.ts:172-229` (`getSystemIndustry`: compute + return `popNeeds`)
- Modify: `components/system/industry-panel.tsx` (chip; `NeedsLine` → exception-only `ProblemLine`; inputs into `BuildingTooltipBody`)
- Test: extend `components/system/needs-view.test.ts` with the problem-line builder; add the builder to `needs-view.ts`

**Interfaces:**
- Consumes: `computePopNeeds` (Task 1), `PopNeedData` (Task 2), `needSeverity`/`SEVERITY_*`/`splitNeedsLedger` (Task 3), existing `supplyChain` entries `{ goodId, inputGate, throttledBy }`.
- Produces (view-model, in `needs-view.ts`):
  ```ts
  export interface ProblemItem { kind: "input" | "pops"; label: string; severity: NeedSeverity }
  export function buildProblems(
    supply: { inputGate: number; throttledBy: string[] } | undefined,
    popNeed: { satisfaction: number } | undefined,
    inputLabel: (goodId: string) => string,
  ): ProblemItem[]; // [] for a healthy row — the render-nothing signal
  ```

- [ ] **Step 1: Service.** In `getSystemIndustry`, after the market loop, add:

```ts
import { computePopNeeds } from "@/lib/engine/pop-needs";
import { computeSystemLabourSnapshot } from "@/lib/engine/industry"; // add to existing import list

  const basis = computeSystemLabourSnapshot(buildings, system.population).basis;
  const popNeeds = computePopNeeds(basis, marketsBySystem().get(systemId) ?? []).map((n) => ({
    ...n,
    goodName: GOODS[n.goodId]?.name ?? n.goodId,
  }));
```

and include `popNeeds` in the returned object; mirror the field in `SystemIndustryData` ("Pop needs,
pressure-sorted — drives the strip chip and per-row pop-short markers.").

- [ ] **Step 2: Failing view-model test** (append to `needs-view.test.ts`):

```ts
import { buildProblems } from "@/components/system/needs-view";

describe("buildProblems", () => {
  const label = (id: string) => id;
  it("healthy row → empty (renders nothing)", () => {
    expect(buildProblems({ inputGate: 1, throttledBy: [] }, { satisfaction: 1 }, label)).toEqual([]);
    expect(buildProblems(undefined, undefined, label)).toEqual([]);
  });
  it("input throttle and pop shortage each produce an item; both can coexist", () => {
    const items = buildProblems({ inputGate: 0.62, throttledBy: ["gas"] }, { satisfaction: 0.41 }, label);
    expect(items).toEqual([
      { kind: "input", label: "gas 62%", severity: "short" },
      { kind: "pops", label: "pops short 41%", severity: "critical" },
    ]);
  });
});
```

- [ ] **Step 3: Run to fail**, then implement in `needs-view.ts`:

```ts
export interface ProblemItem { kind: "input" | "pops"; label: string; severity: NeedSeverity }

/** Exception-reporting: items exist only for actual problems; a healthy row returns []. */
export function buildProblems(
  supply: { inputGate: number; throttledBy: string[] } | undefined,
  popNeed: { satisfaction: number } | undefined,
  inputLabel: (goodId: string) => string,
): ProblemItem[] {
  const items: ProblemItem[] = [];
  if (supply && supply.throttledBy.length > 0) {
    const sev = needSeverity(supply.inputGate);
    for (const input of supply.throttledBy) {
      items.push({ kind: "input", label: `${inputLabel(input)} ${Math.round(supply.inputGate * 100)}%`, severity: sev === "met" ? "short" : sev });
    }
  }
  if (popNeed) {
    const sev = needSeverity(popNeed.satisfaction);
    if (sev !== "met") items.push({ kind: "pops", label: `pops short ${Math.round(popNeed.satisfaction * 100)}%`, severity: sev });
  }
  return items;
}
```

- [ ] **Step 4: Run to pass** — `npx vitest run components/system/needs-view.test.ts`

- [ ] **Step 5: Panel wiring** in `industry-panel.tsx`:
  - Destructure `popNeeds` from the readout; `const popNeedByGood = new Map(popNeeds.map((n) => [n.goodId, n]))`.
  - **Chip** (health strip, after the Badge): unmet = `popNeeds.filter((n) => needSeverity(n.satisfaction) !== "met")` (already pressure-sorted). Render nothing when empty; else:

```tsx
{unmet.length > 0 && (
  <Tooltip>
    <TooltipTriggerLabel className="inline-flex items-center gap-1.5 border border-border bg-surface-active px-2 py-0.5 text-[11px]">
      <span aria-hidden className={`font-mono text-[10px] ${SEVERITY_TEXT[needSeverity(unmet[0].satisfaction)]}`}>{SEVERITY_GLYPH[needSeverity(unmet[0].satisfaction)]}</span>
      Pops short: <strong>{unmet[0].goodName}</strong>
      {unmet[1] && <> · {unmet[1].goodName}</>}
      {unmet.length > 2 && <span className="text-text-tertiary">+{unmet.length - 2}</span>}
    </TooltipTriggerLabel>
    <TooltipContent className="w-64">{/* per-good figures lines: goodName — n% met · want · delivered, then the standard sentence */}</TooltipContent>
  </Tooltip>
)}
```

  - **`NeedsLine` → `ProblemLine`**: replace its body — `const items = buildProblems(supply, popNeedByGood.get(outputGood), label); if (items.length === 0) return null;` render `items` as the mock's single sub-line (`⚠ gas 62% · ▼ pops short 41%`, glyph+text in `SEVERITY_TEXT[item.severity]`, separated by `·`). `BuildingRow`'s `hasNeeds` becomes `items.length > 0` (compute once and pass down — don't call `buildProblems` twice).
  - **Tooltip demotion**: in `BuildingTooltipBody`, add an "inputs" section for producer rows with a recipe: each input from `Object.keys(GOOD_RECIPES[b.outputGood] ?? {})` rendered `✓ label` (green) or `⚠ label gate%` (amber) using the row's `supply` — thread `supply` in as a new optional prop from `BuildingRow`.
  - Pop-short tooltip on the problem line (wrap the `pops` item in a Tooltip): goodName + `SEVERITY_GLYPH n% met` header, figures line `want · delivered · gap · pressure`, sentence. Reuse `NeedTooltip` from Task 3 if trivially exportable — else duplicate the three lines (small enough).

- [ ] **Step 6: Checks** — `npx tsc --noEmit`; `npx vitest run`.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(needs): industry pop-pressure chip + exception-only problem lines (inputs demoted to tooltip)"
```

---

### Task 5: Verify against the live app + build gate

- [ ] **Step 1:** `npx next build --webpack` — must pass (the PR build gate).
- [ ] **Step 2:** With the dev server running, open a Tense system's Population tab: ledger shows
problem rows on top (pressure order — a staple should outrank a worse-% luxury), met rows collapsed,
no "Market minimum" anywhere, "Delivered" header not squashed (if it is: widen the detail sidebar
container slightly — locate the width class on the system detail panel layout — rather than abbreviate).
- [ ] **Step 3:** Industry tab, same system: healthy producer rows have NO sub-line; rows with input
throttles/pop shortages show the single problem line; hovering a building name shows the inputs list
in the tooltip; the chip names the top unmet goods and disappears on a fully-fed system.
- [ ] **Step 4:** Commit any width fix; push branch; open the PR (needs-visibility, single PR);
run `/uber-review` on it after Kai's visual pass.
- [ ] **Step 5:** Doc lifecycle on this branch before merge: delete this build plan; the surfaces are
self-describing UI (no new active doc needed — add a line to `docs/active/gameplay/economy.md`'s UI
notes only if one exists for the demand chart; update `docs/SPEC.md` if it references the demand
footprint chart or "market minimum").
