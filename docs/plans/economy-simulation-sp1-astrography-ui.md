# Economy Simulation SP1 — Astrography UI (substrate read panel)

> **Status:** design (brainstorm) — 2026-06-17. Sibling to the other `economy-simulation-sp1-*`
> plans. **Delete on ship** per the `docs/plans/` convention. This is the substrate's **first DB
> reader**; it ships *before* the PR3b prune so PR3b stays a clean pure-prune.

## 1. Goal & context

PR3a seeded the physical substrate into the DB (per-system `sunClass`, `population`, `popCap`,
`agg*` resource columns; per-body `SystemBody` rows with `bodyType`, `habitable`, `size`, `res*`
columns, `popCapWeight`, `richnessModifiers[]`). Nothing reads it back yet.

This PR adds a **read-only, player-facing "Astrography" tab** to the system detail panel that
surfaces the generated substrate, so we can *see what we're working with* and eyeball generation
quality — while being a permanent, Foundry-polished game panel (not throwaway debug UI). It also
carries the **read-back path** (`resourceVectorFromColumns`, substrate guards, a substrate read
service + types) that PR3a deferred to "the first reader." Moving that slice here lets PR3b be a
pure destructive prune.

**Audience decision:** *Hybrid* — polished and permanent, but exposes the full generated detail
(per-body resource vectors + richness), not just curated qualitative labels.

## 2. Scope

**In scope**
- New `Astrography` tab on the system detail panel (`@panel/system/[systemId]/astrography`).
- Sun-class header (colored star glyph + class name), population + pop-cap utilisation.
- System **aggregate resource profile** (the `agg*` columns) as a labeled bar strip, framed as
  "development potential."
- Per-body **cards**: habitable badge, size, pop-cap weight, resource vector (sorted, rich-first,
  trace muted) and richness-modifier pills.
- A one-line **teaser** on the Overview tab linking to Astrography.
- Read-back plumbing: `resourceVectorFromColumns`, substrate type guards, substrate read service +
  API route + hook + query key + types.

**Out of scope (explicit non-goals)**
- **No facilities / building-slots UI.** The resource vector is a *cap on a category*, not a slot
  count; the slot taxonomy and resource→cap conversion are deliberately deferred to the Facilities
  sub-project (SP3). We present the substrate honestly as "development potential"; the explicit
  slots view grows on top later. (See `docs/planned/economy-simulation-vision.md` §8.3–8.4.)
- No writes/mutations. No changes to generation, the shim, or the economy tick.
- No PR3b prune work (TraitId pruning, stripping economy fields, etc.).

## 3. Placement

The system panel is a tabbed `DetailPanel` modal (`@panel/system/[systemId]/layout.tsx`): Overview ·
Market · Ships · Convoys · Shipyard · Contracts · Explore. Add an **Astrography** tab.

- Chosen over inlining on Overview: Overview is already dense (summary, market snapshot, stock pie,
  trade activity, traits); the full per-body breakdown needs its own room. One click away; the
  Overview teaser keeps it discoverable.
- New tab is a single `astrography/page.tsx` (siblings use only `page.tsx`; the one
  `@panel/default.tsx` covers the parallel-route slot — no per-tab `default.tsx` needed) plus a new
  `TabLink` entry in `layout.tsx`.

## 4. UI design

### 4.1 Header card
- **Star glyph** — circular gradient swatch colored per `SunClass` (yellow / orange / blue-white /
  red), + class display name from `SUN_CLASSES[sunClass].name`.
- **Population** (raw magnitude) and **Pop capacity** (`popCap`) with a utilisation bar
  (`population / popCap`, clamped 0–100%). Numbers in `font-mono`.
- **Resource profile** — system aggregate vector as a 7-bar labeled strip (`ResourceVectorBars`),
  with the section label "Resource profile · system aggregate (development potential)".

### 4.2 System Bodies
- `SectionHeader` "System Bodies" + count.
- One **`BodyCard`** per body:
  - Name (archetype display name) + `HABITABLE` badge when habitable; copper left-accent stripe
    (green-tinted accent for habitable bodies).
  - `size` and `popCapWeight` in the meta line (`font-mono`).
  - Resource lines via `ResourceVectorBars`, **sorted descending** so the rich resources read first;
    near-zero resources collapse into a muted "trace" line.
  - Richness-modifier **pills** (e.g. "Fertile Lowlands ×1.5 arable").

### 4.3 Overview teaser
- A one-line summary on Overview (e.g. "Yellow star · 4 bodies · pop 4,210") linking to the
  Astrography tab. Uses only the cheap scalar summary (no body join).

### 4.4 Bar scaling
- Resource magnitudes are abstract. Bars are normalized to the **max value within that vector**
  (per body for cards; across the 7 for the aggregate) so the dominant resource reads full-width.
  The **raw number is always shown** alongside, so absolute magnitude isn't lost. (Simple and
  legible; revisit shared-scale later if cross-body comparison matters.)

## 5. Data model / read path

This PR introduces the inverse of the existing column spreaders and the substrate read services.

### 5.1 Engine helper (pure, `lib/engine/resources.ts`)
```ts
// Inverse of aggregateColumns / bodyResourceColumns.
// prefix "agg" reads aggGas…; prefix "res" reads resGas…
export function resourceVectorFromColumns(
  source: Record<string, number>,
  prefix: "agg" | "res",
): ResourceVector
```
Round-trips with `aggregateColumns` / `bodyResourceColumns` (unit-tested).

### 5.2 Type guards (`lib/types/guards.ts`)
Add, following the existing `isEconomyType` pattern (validate against catalog keys):
- `isSunClass(value: string): value is SunClass`
- `isBodyArchetypeId(value: string): value is BodyArchetypeId`
- `isRichnessModifierId(value: string): value is RichnessModifierId`

Used **once** at the service boundary; downstream stays typed (no re-validation in components).

### 5.3 Services (`lib/services/universe.ts`)
- **Extend `getSystemDetail`** (the always-loaded panel detail) with a cheap scalar summary on the
  `"visible"` variant, plus a `_count` (no body-row join):
  ```ts
  substrate: { sunClass: SunClass; population: number; popCap: number; bodyCount: number }
  ```
  Powers the Overview teaser and the Astrography header (renders instantly with the open panel).
- **New `getSystemSubstrate(systemId): SystemSubstrateData`** (lazy; loads the body join):
  ```ts
  interface SystemSubstrateData {
    aggregate: ResourceVector;        // from agg* via resourceVectorFromColumns
    bodies: BodyView[];
  }
  interface BodyView {
    id: string;
    bodyType: BodyArchetypeId;
    archetypeName: string;            // BODY_ARCHETYPES[bodyType].name (resolved in service)
    habitable: boolean;
    size: number;
    popCapWeight: number;
    resources: ResourceVector;        // from res* via resourceVectorFromColumns
    richness: RichnessModifierView[]; // resolved from richnessModifiers ids
  }
  interface RichnessModifierView {
    id: RichnessModifierId; name: string; resource: ResourceType; multiplier: number;
  }
  ```
  Resolves catalog display data server-side (mirrors how `getSystemDetail` already resolves trait
  names into `SystemTraitResponse`). Read services throw `ServiceError`.

### 5.4 API route
- `app/api/game/systems/[systemId]/substrate/route.ts` — thin wrapper:
  `requirePlayer` → `getSystemSubstrate` → `NextResponse.json<SystemSubstrateResponse>`. Cache
  header `private` (auth-gated; never `public`/`immutable`).

### 5.5 Hook + query key
- `lib/query/keys.ts`: `systemSubstrate: (systemId) => ["systemSubstrate", systemId] as const`.
- `lib/hooks/use-system-substrate.ts`: `useSystemSubstrate(systemId)` via `useSuspenseQuery`.
  The Astrography page reads `sunClass`/`population`/`popCap` from the already-loaded
  `useSystemInfo` and `aggregate`/`bodies` from `useSystemSubstrate`.

### 5.6 Types (`lib/types/api.ts`)
- Add `substrate` summary to the `SystemDetailData` `"visible"` variant.
- Add `SystemSubstrateData`, `BodyView`, `RichnessModifierView`, `SystemSubstrateResponse`.

## 6. Components (new — small, single-purpose, Foundry-themed)
- `components/system/resource-vector-bars.tsx` — `ResourceVectorBars` renders a `ResourceVector`
  as a labeled bar strip; props control sorting (rich-first vs canonical order) and whether to
  collapse trace resources. **Reused** by the header aggregate and the body cards.
- `components/system/body-card.tsx` — `BodyCard` for one `BodyView`.
- `components/system/star-glyph.tsx` — colored sun glyph for a `SunClass`.
- `lib/constants/ui.ts`: add `SUN_CLASS_COLORS: Record<SunClass, string>` (presentation only;
  label comes from the `SUN_CLASSES` catalog).
- Page: `app/(game)/@panel/system/[systemId]/astrography/page.tsx`. The header's star + population +
  pop-cap render immediately from `useSystemInfo` (already loaded by the panel layout). Everything
  fed by `useSystemSubstrate` — the **header aggregate strip and the body cards** — lives inside a
  single `QueryBoundary` so the substrate join streams in without blocking the header summary.
- `layout.tsx`: add the `Astrography` `TabLink` (badge 0).

## 7. Edge cases
- **Visibility "unknown"** — `getSystemDetail` already returns the `"unknown"` variant with no
  substrate; the Astrography tab shows a locked/`EmptyState` ("Scan this system to survey it" or
  similar), and the Overview teaser is hidden. `getSystemSubstrate` should also guard unknown
  visibility (throw/empty) so a direct URL can't leak data.
- **No bodies** (shouldn't happen post-seed) — `EmptyState`.
- **popCap = 0** — utilisation bar renders empty (avoid divide-by-zero).
- Reseed staleness — API responses use `no-cache`/`max-age` + TanStack `staleTime`, never
  `immutable`.

## 8. Testing
- **Unit (`npx vitest run`)**:
  - `resourceVectorFromColumns` round-trips with `aggregateColumns` / `bodyResourceColumns`.
  - `isSunClass` / `isBodyArchetypeId` / `isRichnessModifierId` accept valid, reject invalid.
  - Bar-normalization util (if extracted) — scaling + trace collapse.
- **Build/typecheck**: `tsc` + `npm run build` clean (no `as`, no `unknown`).
- **Manual**: open a system → Astrography tab; verify header, aggregate, body cards, richness
  pills, habitable badge; verify unknown-visibility lock; verify Overview teaser links across.
- Not exercised: the simulator (`npm run simulate`) — this PR doesn't touch the economy tick.

## 9. Conventions checklist (per CLAUDE.md)
- No `as` (except `as const` / guards); no `unknown`. Validate substrate strings once via the new
  guards at the service boundary.
- Use existing UI primitives (`Card`, `Badge`, `SectionHeader`, `StatList/StatRow`, `EmptyState`,
  `QueryBoundary`); no raw markup that duplicates a component.
- Services own DB/business logic; route is a thin wrapper; page/components never re-validate types.
- Single-concern: this PR is additive read-only; it does **not** include the PR3b prune.

## 10. Sequencing
1. This PR — Astrography UI + read-back path (on a branch off the shared `feat/economy-simulation`).
2. **PR3b** (after) — the destructive prune (TraitId pruning, strip economy fields, LOCATIONS→bodies,
   danger-from-bodies), now clean because the read slice moved here.
