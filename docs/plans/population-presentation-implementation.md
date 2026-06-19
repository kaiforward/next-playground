# Population Presentation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Present the abstract `population` Float as a realistic, live-ticking headcount across the Overview, Astrography, and Population system screens, via one shared display component, sourcing population from the live tick-invalidated read everywhere.

**Architecture:** Push all numeric formatting into pure, unit-tested helpers in `lib/utils/format.ts` (1 abstract unit = 1,000,000 people). Add an opt-in label formatter to the shared `ProgressBar` primitive. Build one bare `PopulationSummary` content component (no Card) that both the Population and Astrography tabs frame themselves. Route every population/capacity readout through the live `useSystemPopulation` hook (the static substrate read is `staleTime: Infinity` and shows frozen values). Delete the now-redundant `AstrographyTeaser`.

**Tech Stack:** Next.js 16 (App Router) + React 19, TypeScript 5 strict, Tailwind v4 + tailwind-variants, Vitest 4. Design source of truth: `docs/plans/population-presentation.md`.

## Global Constraints

Every task's requirements implicitly include this section.

- **No `as` casts** except `as const` and inside `lib/types/guards.ts`. If TS can't infer a type, fix it at the source.
- **No `unknown`** anywhere (no `Record<string, unknown>`, no untyped maps). Narrow discriminated unions explicitly.
- **Type at the boundary, trust downstream** — components/hooks never re-validate types the service already validated.
- **Foundry theme:** no rounded corners on cards/buttons/badges. `font-mono` (Geist Mono) for numeric values, `font-display` for headings. Use existing UI components (`Card`, `StatList`/`StatRow`, `ProgressBar`, `EmptyState`, `SectionHeader`) — never raw markup that duplicates a component.
- **`"use client"` only where needed** — a component with no hooks/state/handlers must not declare it.
- **DRY / YAGNI / KISS** — extract on the second occurrence; no abstraction for hypothetical needs.
- **Headcount values are display-only.** A scaled headcount (`pop × 1_000_000`) exceeds int32 and must NEVER be written to Prisma. Formatters produce strings for rendering only.
- **Commit messages** are conventional-commit style and end with the repo trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Branch:** all work lands on `feat/economy-sp2-part1-pr4` (the existing PR4 phase branch). One commit per task.

## Gate commands (every task)

- Types: `npx tsc --noEmit` → expected: no output (clean exit).
- Focused unit test (Task 1 only): `npx vitest run --project unit lib/utils/__tests__/format.test.ts`
- Whole-branch final gate (after Task 6): `npx vitest run` → all files pass.

UI consumer tasks (3–6) have **no automated render test**: the unit project has no jsdom/DOM harness, so React rendering is not unit-tested in this repo (matches the existing PR4 UI tasks). All display logic lives in the Task 1 formatters, which ARE unit-tested. Consumer tasks are gated by `tsc` + the manual visual check below. This is intentional, not a gap.

## File Structure

- `lib/utils/format.ts` — **modify.** Pure formatters. Add `PEOPLE_PER_UNIT`, `formatHeadcount`, `formatHeadcountShort`. Existing `formatNumber`/`formatCredits`/`formatRelativeTime` untouched.
- `lib/utils/__tests__/format.test.ts` — **modify.** Add `describe` blocks for the two new formatters.
- `components/ui/progress-bar.tsx` — **modify.** Add optional `formatValue` prop (default identity). Shared primitive; backward-compatible.
- `components/system/population-summary.tsx` — **create.** Bare content component (no Card): Population + Capacity rows + Utilisation bar. One responsibility: render a system's population magnitude block consistently.
- `components/system/population-panel.tsx` — **modify.** Population tab. Use `PopulationSummary`; revert the `round2` hack; keep Stability + Demand cards.
- `app/(game)/@panel/system/[systemId]/astrography/page.tsx` — **modify.** Astrography tab. Source population from `useSystemPopulation` (live); use `PopulationSummary`; keep `useSystemSubstrate` for sun/bodies/resources/goods.
- `app/(game)/@panel/system/[systemId]/page.tsx` — **modify.** Overview. Delete the `AstrographyTeaser` block; add Sun + Bodies rows; switch the Population row to live headcount.
- `components/system/astrography-teaser.tsx` — **delete.** No remaining consumer once Overview drops it.

---

## Task 1: Headcount formatters

**Files:**
- Modify: `lib/utils/format.ts`
- Test: `lib/utils/__tests__/format.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `export const PEOPLE_PER_UNIT = 1_000_000;`
  - `export function formatHeadcount(pop: number): string` — full grouped headcount, e.g. `141.763123 → "141,763,123"`.
  - `export function formatHeadcountShort(pop: number): string` — compact, unit-rounded, e.g. `141.8 → "142M"`, `3400 → "3.4B"`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/utils/__tests__/format.test.ts` (keep the existing `formatNumber` describe block; add a new import and two new describe blocks):

```typescript
import { describe, it, expect } from "vitest";
import { formatNumber, formatHeadcount, formatHeadcountShort } from "../format";

// ... existing formatNumber describe block stays ...

describe("formatHeadcount", () => {
  it("scales abstract units to a realistic headcount", () => {
    // 1 unit = 1,000,000 people; the Float's fraction supplies the low digits.
    expect(formatHeadcount(141.763123).replace(/\D/g, "")).toBe("141763123");
  });
  it("groups thousands with separators", () => {
    expect(formatHeadcount(141.763123)).toMatch(/^141\D763\D123$/);
  });
  it("renders zero for an empty system", () => {
    expect(formatHeadcount(0)).toBe("0");
  });
  it("handles large (billions) values — display-only, never written to Prisma", () => {
    expect(formatHeadcount(3400).replace(/\D/g, "")).toBe("3400000000");
  });
});

describe("formatHeadcountShort", () => {
  it("rounds to a whole unit before scaling (141.8 -> 142M)", () => {
    expect(formatHeadcountShort(141.8)).toBe("142M");
  });
  it("formats billions with at most one fractional digit", () => {
    expect(formatHeadcountShort(3400)).toBe("3.4B");
  });
  it("renders zero", () => {
    expect(formatHeadcountShort(0)).toBe("0");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project unit lib/utils/__tests__/format.test.ts`
Expected: FAIL — `formatHeadcount`/`formatHeadcountShort` are not exported (import error / "is not a function").

- [ ] **Step 3: Implement the formatters**

Append to `lib/utils/format.ts` (below `formatNumber`):

```typescript
/** People represented by one abstract population unit. */
export const PEOPLE_PER_UNIT = 1_000_000;

/**
 * Full grouped headcount from the abstract population Float. 1 abstract unit =
 * 1,000,000 people, so 141.763123 -> "141,763,123"; the Float's fractional part
 * supplies the live-ticking low digits.
 *
 * Display-only: the scaled value exceeds int32 and must never be written to Prisma.
 */
export function formatHeadcount(pop: number): string {
  return Math.round(pop * PEOPLE_PER_UNIT).toLocaleString();
}

/**
 * Compact headcount for tight labels (e.g. the utilisation bar). Rounds to a
 * whole abstract unit first so 141.8 -> "142M" (not "141.8M"), then formats with
 * Intl compact notation: "142M", "3.4B".
 */
export function formatHeadcountShort(pop: number): string {
  const people = Math.round(pop) * PEOPLE_PER_UNIT;
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(people);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project unit lib/utils/__tests__/format.test.ts`
Expected: PASS — all `formatHeadcount` and `formatHeadcountShort` cases green, existing `formatNumber` cases still green.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add lib/utils/format.ts lib/utils/__tests__/format.test.ts
git commit -m "$(cat <<'EOF'
feat(ui): headcount formatters (1 unit = 1M people)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: ProgressBar gains an optional label formatter

**Files:**
- Modify: `components/ui/progress-bar.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `ProgressBar` accepts a new optional prop `formatValue?: (n: number) => string`. Default is identity (`String(n)`), so every existing call site is byte-for-byte unchanged. The `value / max` label and the default `aria-label` both run each endpoint through `formatValue`.

**Why no test:** the unit project has no DOM harness; this component has no existing test. The change is a backward-compatible additive prop whose default preserves current output exactly — covered by `tsc` + the manual visual check. The formatting logic itself is unit-tested in Task 1.

- [ ] **Step 1: Add the prop and thread it through the labels**

Replace the props interface and component body in `components/ui/progress-bar.tsx` (keep the `progressBarVariants` block above unchanged):

```typescript
interface ProgressBarProps extends ProgressBarVariants {
  label: string;
  value: number;
  max: number;
  className?: string;
  ariaLabel?: string;
  /** Formats the "value / max" label endpoints. Default: identity (numbers as-is). */
  formatValue?: (n: number) => string;
}

export function ProgressBar({
  label,
  value,
  max,
  color,
  size,
  className,
  ariaLabel,
  formatValue = (n) => String(n),
}: ProgressBarProps) {
  const percent = max > 0 ? (value / max) * 100 : 0;
  const styles = progressBarVariants({ size, color });
  const valueLabel = formatValue(value);
  const maxLabel = formatValue(max);

  return (
    <div className={className}>
      <div className={styles.labelRow()}>
        <span>{label}</span>
        <span>{valueLabel} / {maxLabel}</span>
      </div>
      <div
        className={styles.track()}
        role="progressbar"
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={ariaLabel ?? `${label}: ${valueLabel} / ${maxLabel}`}
      >
        <div
          className={styles.fill()}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output. (Every existing `<ProgressBar>` call still type-checks — `formatValue` is optional.)

- [ ] **Step 3: Commit**

```bash
git add components/ui/progress-bar.tsx
git commit -m "$(cat <<'EOF'
feat(ui): optional formatValue label formatter on ProgressBar

Default identity keeps every existing call site's labels unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Shared `PopulationSummary` component

**Files:**
- Create: `components/system/population-summary.tsx`

**Interfaces:**
- Consumes: `formatHeadcount`, `formatHeadcountShort` (Task 1); `ProgressBar` `formatValue` (Task 2); `StatList`/`StatRow` (`@/components/ui/stat-row`).
- Produces: `export function PopulationSummary({ population, popCap }: { population: number; popCap: number }): JSX.Element` — renders **bare inner content** (a `<div className="space-y-3">`, no `Card`, no section header): a `StatList` with "Population" and "Capacity" rows (both `formatHeadcount`) and a "Utilisation" `ProgressBar` (`value={population}`, `max={Math.max(1, popCap)}`, `formatValue={formatHeadcountShort}`). The caller owns the `useSystemPopulation` visibility gate and passes the already-narrowed visible values.

**Why no `"use client"`:** the component uses no hooks, state, or handlers, so it must not declare the directive (Global Constraints). It is imported into client trees, which is fine.

**Why no test:** pure wiring of tested formatters into JSX; no DOM harness. Covered by `tsc` + manual visual.

- [ ] **Step 1: Create the component**

Create `components/system/population-summary.tsx`:

```typescript
import { StatList, StatRow } from "@/components/ui/stat-row";
import { ProgressBar } from "@/components/ui/progress-bar";
import { formatHeadcount, formatHeadcountShort } from "@/lib/utils/format";

/**
 * Population / Capacity / Utilisation block as bare inner content (no Card or
 * section header — each consumer frames it). Values are realistic headcounts
 * derived from the abstract population Float. Callers pass the already-narrowed
 * visible values from useSystemPopulation.
 */
export function PopulationSummary({
  population,
  popCap,
}: {
  population: number;
  popCap: number;
}) {
  return (
    <div className="space-y-3">
      <StatList>
        <StatRow label="Population">
          <span className="font-mono text-sm text-text-primary">
            {formatHeadcount(population)}
          </span>
        </StatRow>
        <StatRow label="Capacity">
          <span className="font-mono text-sm text-text-primary">
            {formatHeadcount(popCap)}
          </span>
        </StatRow>
      </StatList>
      <ProgressBar
        label="Utilisation"
        value={population}
        max={Math.max(1, popCap)}
        color="copper"
        formatValue={formatHeadcountShort}
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add components/system/population-summary.tsx
git commit -m "$(cat <<'EOF'
feat(system): shared PopulationSummary headcount block

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Population tab uses `PopulationSummary`; revert `round2`

**Files:**
- Modify: `components/system/population-panel.tsx`

**Interfaces:**
- Consumes: `PopulationSummary` (Task 3); `ProgressBar` `formatValue` (Task 2).
- Produces: nothing downstream.

**Design notes (from the spec):**
- The magnitude card now frames `PopulationSummary` in its bordered `Card` with **no** `SectionHeader` — `PopulationSummary`'s first row is already labeled "Population", and dropping the header makes this block render identically to the Astrography tab (the shared-consistency goal). The Stability and Demand cards keep their headers.
- The `round2` hack (commit `5336057`) is **removed**. The Unrest bar keeps legible labels via the new `formatValue` prop (`(n) => n.toFixed(2)`), replacing the round-at-call-site helper. This preserves the prior fix (no raw floats like `0.0943265…/1`) through the generic mechanism.

- [ ] **Step 1: Replace the file contents**

Replace all of `components/system/population-panel.tsx`:

```typescript
"use client";

import { useSystemPopulation } from "@/lib/hooks/use-system-population";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { EmptyState } from "@/components/ui/empty-state";
import { StabilityBadge } from "@/components/ui/stability-badge";
import { PopulationSummary } from "@/components/system/population-summary";

export function PopulationPanel({ systemId }: { systemId: string }) {
  const pop = useSystemPopulation(systemId);

  if (pop.visibility === "unknown") {
    return (
      <EmptyState message="Scan this system with a ship in range to assess its population." />
    );
  }

  const { population, popCap, unrest, striking, demand } = pop;

  return (
    <div className="space-y-6">
      <Card variant="bordered" padding="md">
        <PopulationSummary population={population} popCap={popCap} />
      </Card>

      <Card variant="bordered" padding="md">
        <div className="mb-3 flex items-center justify-between">
          <SectionHeader as="h4">Stability</SectionHeader>
          <StabilityBadge unrest={unrest} />
        </div>
        <ProgressBar
          label="Unrest"
          value={unrest}
          max={1}
          color="copper"
          formatValue={(n) => n.toFixed(2)}
        />
        {striking && (
          <p className="mt-2 text-sm text-amber-300">Production suppressed — workers are striking.</p>
        )}
      </Card>

      <Card variant="bordered" padding="md">
        <SectionHeader as="h4" className="mb-1">Demand footprint</SectionHeader>
        <p className="mb-3 text-xs text-text-tertiary">
          What these inhabitants consume each tick — this is what drives the system&apos;s market demand.
        </p>
        {demand.length === 0 ? (
          <EmptyState message="No demand." />
        ) : (
          <ul className="space-y-1.5">
            {demand.map((d) => (
              <li key={d.goodId} className="flex items-center justify-between py-1.5 px-3 bg-surface">
                <span className="text-sm text-text-primary">{d.goodName}</span>
                <span className="text-sm font-mono text-text-secondary">{d.demandRate.toFixed(2)}/t</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
```

Note: `StatList`, `StatRow`, and `formatNumber` are no longer imported here (moved into `PopulationSummary`); `popCapInt` and `round2` are gone.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (no unused-import or unused-variable errors).

- [ ] **Step 3: Commit**

```bash
git add components/system/population-panel.tsx
git commit -m "$(cat <<'EOF'
refactor(system): Population tab uses shared PopulationSummary; drop round2

Unrest bar keeps 2dp labels via ProgressBar formatValue, superseding the
round-at-call-site hack.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Astrography tab — live population + `PopulationSummary`

**Files:**
- Modify: `app/(game)/@panel/system/[systemId]/astrography/page.tsx`

**Interfaces:**
- Consumes: `PopulationSummary` (Task 3); `useSystemPopulation` (`@/lib/hooks/use-system-population`).
- Produces: nothing downstream.

**Design notes (from the spec):** the population block must come from the **live** `useSystemPopulation` (tick-invalidated), not `substrate.population` (which is `staleTime: Infinity` → frozen). Keep `useSystemSubstrate` for sun/bodies/resources/goods. Replace the inline Population/Capacity/Utilisation block (which also had a raw-Float Utilisation bar) with `PopulationSummary` in the header card's left grid column. `population`, `popCap`, `popCapInt`, and the `formatNumber`/`StatList`/`StatRow`/`ProgressBar` imports are removed from this file.

- [ ] **Step 1: Replace the file contents**

Replace all of `app/(game)/@panel/system/[systemId]/astrography/page.tsx`:

```typescript
"use client";

import { use } from "react";
import { useSystemSubstrate } from "@/lib/hooks/use-system-substrate";
import { useSystemPopulation } from "@/lib/hooks/use-system-population";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { StarGlyph } from "@/components/system/star-glyph";
import { ResourceVectorBars } from "@/components/system/resource-vector-bars";
import { SubstrateTradeBars } from "@/components/system/substrate-trade-bars";
import { BodyCard } from "@/components/system/body-card";
import { PopulationSummary } from "@/components/system/population-summary";
import { SUN_CLASSES } from "@/lib/constants/bodies";

function AstrographyContent({ systemId }: { systemId: string }) {
  const substrate = useSystemSubstrate(systemId);
  const populationState = useSystemPopulation(systemId);

  if (substrate.visibility === "unknown") {
    return (
      <EmptyState message="Scan this system with a ship in range to survey its astrography." />
    );
  }

  const { sunClass, aggregate, bodies, goods } = substrate;

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card variant="bordered" padding="md">
        <div className="mb-4 flex items-center gap-3">
          <StarGlyph sunClass={sunClass} />
          <h3 className="font-display text-lg font-semibold text-text-primary">
            {SUN_CLASSES[sunClass].name}
          </h3>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {populationState.visibility === "visible" ? (
            <PopulationSummary
              population={populationState.population}
              popCap={populationState.popCap}
            />
          ) : (
            <EmptyState message="Scan this system with a ship in range to assess its population." />
          )}
          <div>
            <SectionHeader as="h4" className="mb-1">
              Resource profile · system aggregate
            </SectionHeader>
            <p className="mb-2 text-xs text-text-tertiary">Development potential</p>
            <ResourceVectorBars vector={aggregate} />
          </div>
        </div>
      </Card>

      {/* Trade profile — per-good production vs consumption from the substrate */}
      <Card variant="bordered" padding="md">
        <SectionHeader as="h4" className="mb-1">
          Trade profile · net production
        </SectionHeader>
        <p className="mb-3 text-xs text-text-tertiary">
          What this system&apos;s resources and population produce against what they consume
        </p>
        <SubstrateTradeBars goods={goods} />
      </Card>

      {/* Bodies */}
      <div>
        <SectionHeader className="mb-3">System Bodies · {bodies.length}</SectionHeader>
        {bodies.length === 0 ? (
          <EmptyState message="No charted bodies in this system." />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {bodies.map((b) => (
              <BodyCard key={b.id} body={b} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AstrographyPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);
  return (
    <QueryBoundary>
      <AstrographyContent systemId={systemId} />
    </QueryBoundary>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (no unused-import errors for the removed `formatNumber`/`StatList`/`StatRow`/`ProgressBar`).

- [ ] **Step 3: Commit**

```bash
git add "app/(game)/@panel/system/[systemId]/astrography/page.tsx"
git commit -m "$(cat <<'EOF'
fix(system): Astrography sources live headcount via PopulationSummary

Population block now reads the tick-invalidated useSystemPopulation instead of
the frozen substrate value; shares the PopulationSummary block.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Overview — Sun/Bodies rows, live Population row, drop the teaser

**Files:**
- Modify: `app/(game)/@panel/system/[systemId]/page.tsx`
- Delete: `components/system/astrography-teaser.tsx`

**Interfaces:**
- Consumes: `formatHeadcount` (Task 1); `StarGlyph` (`@/components/system/star-glyph`); `SUN_CLASSES` (`@/lib/constants/bodies`); `substrate` (`useSystemSubstrate`) and `populationState` (`useSystemPopulation`) — both already in scope in `SystemOverviewContent`.
- Produces: nothing downstream.

**Design notes (from the spec):**
- **Remove** the `AstrographyTeaser` import (line ~20) and its rendered block (the `{/* Astrography teaser … */}` `<div className="mb-6"><QueryBoundary>…</QueryBoundary></div>`, lines ~268–274). The tab nav covers navigation and the data now lives in the summary.
- **Add** two rows to the System Summary left-column `StatList`, immediately before the existing Population row: **"Sun"** = small `StarGlyph` + `SUN_CLASSES[sunClass].name`, **"Bodies"** = `bodies.length`. Both render `—` when `substrate.visibility !== "visible"`.
- **Switch** the Population row source from `formatNumber(substrate.population)` (frozen) to `formatHeadcount(populationState.population)` (live), `—` when `populationState.visibility !== "visible"`.
- `formatNumber` is no longer used in this file — drop it from the import (keep `formatCredits`). `QueryBoundary` stays (still used by the page boundary and the Trade Activity boundary).

- [ ] **Step 1: Fix imports**

In `app/(game)/@panel/system/[systemId]/page.tsx`:

Remove the `AstrographyTeaser` import line:

```typescript
import { AstrographyTeaser } from "@/components/system/astrography-teaser";
```

Change the format import from:

```typescript
import { formatCredits, formatNumber } from "@/lib/utils/format";
```

to:

```typescript
import { formatCredits, formatHeadcount } from "@/lib/utils/format";
```

Add these two imports (next to the other `@/components/system` / `@/lib/constants` imports):

```typescript
import { StarGlyph } from "@/components/system/star-glyph";
import { SUN_CLASSES } from "@/lib/constants/bodies";
```

- [ ] **Step 2: Switch the Population label to the live headcount source**

Replace the `populationLabel` const (currently `substrate.visibility === "visible" ? formatNumber(substrate.population) : "—"`):

```typescript
  // Population — realistic headcount from the LIVE tick-invalidated read (the
  // static substrate value is staleTime:Infinity and would show a frozen number).
  const populationLabel =
    populationState.visibility === "visible"
      ? formatHeadcount(populationState.population)
      : "—";
```

- [ ] **Step 3: Add the Sun and Bodies rows before the Population row**

In the left-column `<StatList>`, insert these two rows immediately **before** the existing `<StatRow label="Population">`:

```tsx
              <StatRow label="Sun">
                {substrate.visibility === "visible" ? (
                  <span className="inline-flex items-center gap-2">
                    <StarGlyph sunClass={substrate.sunClass} size="sm" />
                    <span className="text-sm text-text-primary">
                      {SUN_CLASSES[substrate.sunClass].name}
                    </span>
                  </span>
                ) : (
                  <span className="text-sm text-text-tertiary">—</span>
                )}
              </StatRow>
              <StatRow label="Bodies">
                {substrate.visibility === "visible" ? (
                  <span className="text-sm text-text-primary">{substrate.bodies.length}</span>
                ) : (
                  <span className="text-sm text-text-tertiary">—</span>
                )}
              </StatRow>
```

The existing Population row stays as-is (it now reads the updated `populationLabel`):

```tsx
              <StatRow label="Population">
                <span className="text-sm font-mono text-text-primary">{populationLabel}</span>
              </StatRow>
```

- [ ] **Step 4: Remove the Astrography teaser block**

Delete this block (between the System Summary `Card` and the Market row):

```tsx
      {/* Astrography teaser — own boundary so its substrate fetch never blocks
          the overview, and pre-warms the Astrography tab's cache. */}
      <div className="mb-6">
        <QueryBoundary>
          <AstrographyTeaser systemId={systemId} />
        </QueryBoundary>
      </div>
```

- [ ] **Step 5: Confirm the teaser has no other consumer, then delete it**

Run: `git grep -n "AstrographyTeaser"`
Expected: matches ONLY in `docs/plans/population-presentation.md` (the design spec) and `components/system/astrography-teaser.tsx` (the file itself) — no `.tsx` consumer remains.

Then delete the file:

```bash
git rm components/system/astrography-teaser.tsx
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output (no unused `formatNumber`/`AstrographyTeaser`, no dangling reference to the deleted file).

- [ ] **Step 7: Commit**

```bash
git add "app/(game)/@panel/system/[systemId]/page.tsx"
git commit -m "$(cat <<'EOF'
feat(system): Overview shows Sun/Bodies rows and live headcount; drop teaser

Population row now reads the tick-invalidated useSystemPopulation; Sun and
Bodies rows added from the substrate; AstrographyTeaser removed (tab nav covers
navigation, data now lives in the summary).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final gate (after Task 6)

- [ ] Types: `npx tsc --noEmit` → no output.
- [ ] Full suite: `npx vitest run` → all files pass (the only new automated tests are the Task 1 formatter cases; the rest is tsc-gated UI wiring).
- [ ] **Manual visual check** (dev server — `npm run dev`): for a surveyed system, confirm across all three screens that the headcount is a realistic grouped number and ticks each economy tick:
  - **Overview:** System Summary shows Sun (glyph + name), Bodies (count), Population (live headcount), Stability — and the old one-line Astrography teaser is gone.
  - **Astrography:** header card's left column shows the shared Population/Capacity/Utilisation block with live, grouped numbers and a compact `… M / … B` utilisation label; labels read "Population"/"Capacity" (not "Inhabitants").
  - **Population tab:** same shared block, plus Stability (Unrest bar shows 2dp, e.g. `0.09 / 1`) and Demand footprint.
  - Confirm the headcount reads **identically** across the three tabs for the same system.

## Self-Review (checked against the spec)

- **Spec coverage:** Formatter (§1) → Task 1. ProgressBar `formatValue` (§2) → Task 2. Shared component (§3) → Task 3. Consumers (§4): Population tab → Task 4, Astrography → Task 5, Overview → Task 6. Cleanup (§5, delete teaser) → Task 6. Correctness note (live source everywhere) → Tasks 5 & 6 switch to `useSystemPopulation`; Task 4 already used it. ✔ all covered.
- **Out of scope (respected):** no "Units" readout; substrate type/read keeps its `population`/`popCap` fields (just stops displaying them); no engine/processor/calibration change.
- **Type consistency:** `formatHeadcount`/`formatHeadcountShort`/`PEOPLE_PER_UNIT` names identical across Tasks 1, 3, 6. `PopulationSummary` prop shape `{ population, popCap }` identical across Tasks 3, 4, 5. `formatValue` prop name identical across Tasks 2, 3, 4. Union narrowing (`visibility === "visible"`) used before every `.population`/`.popCap`/`.sunClass`/`.bodies` access.
- **One deliberate design call to flag at review:** the Population tab's magnitude `Card` drops its "Population" `SectionHeader` (the shared block self-labels and this matches Astrography). If the user prefers a titled card, re-adding the header is a one-line change.
