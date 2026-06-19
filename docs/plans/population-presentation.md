# Population presentation — realistic headcount (PR4 follow-on)

**Status:** design approved 2026-06-19. Folds onto the existing PR4 branch
(`feat/economy-sp2-part1-pr4`) — it supersedes the interim `round2` rounding commit.
Transient build plan; delete when this work ships (per the `docs/plans/` convention).

## Goal

Present the abstract `population` Float as a **realistic, live-ticking headcount**
across the system UI (Overview, Astrography, Population tabs), with **one shared
display component** so the three screens use identical content and labels.

## The model

- The engine's `population` is an abstract `Float`. **1 abstract unit = 1,000,000
  people.** Headcount = `population × 1_000_000`.
- Because `population` is a Float that `populationDelta` nudges every tick, its
  fractional part supplies the low digits — `141.763123 → 141,763,123` — so the
  displayed headcount visibly breathes each economy tick. **No new tracking, no
  schema change.**
- "Unit" stays the *conceptual* scale only; it is **not** surfaced as its own
  readout for now.

## Correctness note — population must come from the live read everywhere

`population` changes every tick, but it is also a field on the **static** substrate
read (`useSystemSubstrate`, `staleTime: Infinity`). Anything that renders
`substrate.population` shows a **frozen first-load value**. Today that is the
Astrography tab's population block, the Astrography teaser, and the Overview's
Population row. The tick-invalidated `useSystemPopulation` (added in PR4) is the
correct source.

**Decision:** every population/capacity readout sources from `useSystemPopulation`
(live, tick-invalidated). The static substrate read keeps `sunClass`, `bodies`,
`aggregate`, `goods` (genuinely static); its `population`/`popCap` fields simply
stop being *displayed* (left in the type — removing them is out of scope here).

## Pieces

### 1. Formatter — `lib/utils/format.ts` (pure, unit-tested)

```typescript
export const PEOPLE_PER_UNIT = 1_000_000;

// Full grouped headcount: 141.763123 -> "141,763,123".
// Display-only: these values exceed int32 and must never be written to Prisma.
export function formatHeadcount(pop: number): string;        // Math.round(pop * PEOPLE_PER_UNIT).toLocaleString()

// Compact, unit-rounded: rounds to whole Units first (so 141.8M -> "142M"),
// then Intl compact notation. -> "142M", "3.4B".
export function formatHeadcountShort(pop: number): string;
```

`formatHeadcountShort` rounds `pop` to a whole Unit before scaling, then formats
with `Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 })`.

### 2. `ProgressBar` gains an optional label formatter — `components/ui/progress-bar.tsx`

Add `formatValue?: (n: number) => string` (default: identity → current behavior,
fully backward-compatible). The `value / max` label runs each endpoint through it.
This lets the Utilisation bar render `142M / 2.0B` instead of raw Floats, and
**supersedes the `round2` hack** in `population-panel.tsx` (revert it).

### 3. Shared display component — `components/system/population-summary.tsx`

The Population / Capacity / Utilisation block, data-source-agnostic:

- Props: `{ population: number; popCap: number }` (the already-narrowed visible
  values — the caller owns the `useSystemPopulation` visibility gate).
- Renders **only** the inner content — a `StatList` with **"Population"**
  (`formatHeadcount`) and **"Capacity"** (`formatHeadcount`) rows, plus a
  **"Utilisation"** `ProgressBar` (`value={population}`, `max={Math.max(1, popCap)}`,
  `formatValue={formatHeadcountShort}`). **No `Card` or section-header wrapper** —
  each consumer frames it (the Population tab in its bordered `Card`; Astrography
  in its header card's left grid column). Sharing the rows + bar + labels is what
  makes the two tabs consistent.
- Consistent labels ("Population", not "Inhabitants").

### 4. Consumers

- **Population tab** (`components/system/population-panel.tsx`): replace its inline
  magnitude card body with `<PopulationSummary population={...} popCap={...} />`;
  keep the Stability and Demand-footprint cards around it. Revert `round2`.
- **Astrography tab** (`app/(game)/@panel/system/[systemId]/astrography/page.tsx`):
  call `useSystemPopulation` for the population block (keep `useSystemSubstrate`
  for sun/bodies/resources/goods); replace its inline Population/Capacity/Utilisation
  block with `<PopulationSummary />`. Its `popCapInt`/`formatNumber(population)`
  block goes away (this fixes its stale-population + raw-Float-bar bugs).
- **Overview** (`app/(game)/@panel/system/[systemId]/page.tsx`):
  - **Remove** the `AstrographyTeaser` (sun · bodies · pop link) and its boundary —
    the tab nav already covers navigation and the data now lives in the summary.
  - **Add two rows** to the System Summary `StatList`, from the substrate hook
    already in use: **"Sun"** = `StarGlyph` (small) + `SUN_CLASSES[sunClass].name`,
    **"Bodies"** = `bodies.length`. Both render `—` when substrate visibility is
    `unknown`, matching the existing Population row.
  - Switch the existing **Population** row from `formatNumber(substrate.population)`
    to `formatHeadcount(populationState.population)` (live source — `populationState`
    is already in scope from PR4's stability row), `—` when unknown.

### 5. Cleanup

- Delete `components/system/astrography-teaser.tsx` (no other consumer).

## Files

- Modify: `lib/utils/format.ts`, `components/ui/progress-bar.tsx`,
  `app/(game)/@panel/system/[systemId]/page.tsx`,
  `app/(game)/@panel/system/[systemId]/astrography/page.tsx`,
  `components/system/population-panel.tsx`
- Create: `components/system/population-summary.tsx`
- Delete: `components/system/astrography-teaser.tsx`
- Test: `lib/utils/__tests__/format.test.ts` (formatter); existing
  `progress-bar` test if one exists.

## Testing

- **Unit:** `formatHeadcount` (full grouping incl. fractional → low digits, zero,
  large values), `formatHeadcountShort` (unit-rounding `141.8M → 142M`, billions
  `3.4B`). `ProgressBar` `formatValue` (label uses the formatter; default unchanged).
- **tsc** clean.
- **Manual visual:** Overview (Sun/Bodies/Population rows, no teaser), Astrography
  (shared block, live + consistent labels), Population tab (shared block + stability
  + demand). Confirm the headcount ticks and reads identically across tabs.

## Out of scope

- Surfacing a separate "Units" readout.
- Removing `population`/`popCap` from the substrate type/read.
- Any change to the population *simulation* (engine, processors, calibration).
