# Logistics Tab — Imports/Exports Dashboard

> **Status:** Designed, not built. This is **P4** of the
> [Economy Scaling & Trade-Logistics Rework](./economy-scaling-and-trade-rework.md) — one of the two
> model-agnostic UI/visualisation pieces that ship *before* the scaling work (P3 map overlay already
> shipped). It needs no contract model and does not change the economy; it surfaces flow data that
> already exists. See [economy-simulation-vision.md](./economy-simulation-vision.md) §13 for the
> roadmap slot.

## Headline

A new **Logistics** tab on the system detail panel consolidates everything about *what a system makes,
needs, and moves* into one screen. It pairs two **diverging-bar charts** side by side — **Internal
balance** (production vs consumption, relocated from the Industry tab's "Trade balance" card) and
**External balance** (imports vs exports, relocated from the Overview "Trade Activity" panel) — over a
full-width **volume-over-time** series. Both charts share one good ordering (grouped raw → processed →
advanced, sorted by net within each tier) so each good sits on the **same row** in both columns: you
read a good's internal balance straight across to its external balance. The External bars additionally
**split by flow type** — a solid section for directed **logistics** and a diagonal-hatched section for
**market** diffusion — the same two layers the P3 map overlay distinguishes, and the same hatch idiom
the Industry land bars already use.

The tab is a **legibility / drill-down** instrument ("what is the trade here, in detail"), the bottom
of the world-economy funnel: the map overlay says *where to look*, the price overlay surfaces
*opportunity*, and this tab gives the *precise per-good picture* for one system. It is **not** a
contract board and does **not** flag opportunities — that stays the price overlay's job.

## Scope & non-goals

**In scope:**
- A new `Logistics` tab combining prod/con + imports/exports + volume history for one system.
- Generalising the existing custom diverging-bar component into a reusable primitive.
- Reworking the system trade-flow aggregation to (a) split by `flowType` and (b) return all active
  goods (not a top-5 slice).
- Removing the now-superseded Overview "Trade Activity" panel and Industry "Trade balance" card.

**Non-goals (explicitly out):**
- No contract / claimable-mission surface (that is the later contract-model rework).
- No automatic "stuck surplus" / opportunity labelling (see [No gap label](#no-gap-label)).
- No economy/model change — purely a read-side visualisation of existing `TradeFlow` + capacity data.
- No new per-good colour system — deferred to a dedicated game-wide colour pass (see
  [Colour](#colour-uniform-redgreen)).
- No global magnitude scaling — that is sub-project 1 of the parent rework, which lands after this.

## Placement

A new tab `Logistics` is inserted into the system panel tab list
(`app/(game)/@panel/system/[systemId]/layout.tsx`), positioned **between `Industry` and `Market`** so
the panel reads as a progression: **Industry** (what is built) → **Logistics** (what flows in and out)
→ **Market** (prices / trade here). Route segment:
`app/(game)/@panel/system/[systemId]/logistics/page.tsx`. No tab badge count.

The panel is `DetailPanel size="xl"` (`w-[min(1200px,90%)]`, ~1150px content, body scrolls), wide
enough to carry two bar columns comfortably.

## Layout

```
┌─ Logistics ──────────────────────────────────────────────────────────────┐
│  INTERNAL · production vs consumption        EXTERNAL · imports vs exports │
│  ◀ Consumes        Produces ▶   Net          ◀ Imports     Exports ▶   Net │
│  ── Raw ─────────────────────   ───────────  ── Raw ───────────────────────│
│   Minerals   ▭▌      ▌▭▭▭▭   +16              Minerals          ▌▒    +2     │
│   Ore        ▭▭▌     ▌▭▭▭▭   +8               Ore               ▌▒▒   +6     │
│   Biomass    ▭▌      ▌▭        0              Biomass        ·  (not traded) │
│   Water      ▭▭▭▌    ▌▭      −17              Water       ▒▒▌          −15    │
│   …                                          …                              │
│  ── Processed ──────────────   ───────────  ── Processed ──────────────────│
│   Alloys     ▭▌      ▌▭▭▭▭▭  +44              Alloys            ▌▭▭▭▒  +40    │
│   …                                          …                              │
│  ── Advanced ───────────────   ───────────  ── Advanced ───────────────────│
│   …                                                                         │
├───────────────────────────────────────────────────────────────────────────┤
│  Trade volume over time  ── exports (green) ── imports (red) ── t-200 → now │
│  [ Recharts line chart, full width ]                                        │
└───────────────────────────────────────────────────────────────────────────┘
```

Two equal columns (`grid-template-columns: 1fr 1fr`), column headers + legends rendered once at the
top, then tier bands and bar groups, then the full-width volume series beneath. Both columns are
generated from one shared, tier-grouped row model so their rows line up exactly.

## Internal balance chart (production vs consumption)

- **Data:** `capacityGoodRates(buildings, population, yields)` (`lib/engine/industry.ts`) — already
  computed for every system, mapping over **all 24 goods** and returning `{ goodId, production,
  consumption }`. Consumption is `GOOD_CONSUMPTION[good] × population`, which is non-zero for *every*
  good on an inhabited system, so this column is reliably dense (≈all 24 goods present). Production is
  non-zero only for goods the system's buildings make.
- **Visual:** consumption fills **leftward** from the centre divider (red), production fills
  **rightward** (green). Net (`production − consumption`) shown numerically on the right, coloured by
  sign (green positive / red negative / muted zero). This is exactly today's `SubstrateTradeBars`
  behaviour, re-homed.
- **Units:** per-cycle rates ("/cyc"). Internal is **not** flow-split — production and consumption have
  no market/logistics distinction, so these bars are always solid. (This also visually distinguishes
  the two charts: Internal is solid; External carries texture.)

## External balance chart (imports vs exports)

- **Data:** `TradeFlow` rows for the system over the recent window
  (`TRADE_SIMULATION.FLOW_HISTORY_TICKS = 200`). For each good, aggregate four totals:
  - `importLogistics` / `importMarket` — flows where `toSystemId == system`, by `flowType`.
  - `exportLogistics` / `exportMarket` — flows where `fromSystemId == system`, by `flowType`.
  - `externalNet = (exports total) − (imports total)`; `traded = any of the four > 0`.
- **Visual:** imports fill **leftward** (red), exports fill **rightward** (green), net on the right.
  Each side is **split by flow type**:
  - **Solid** segment = directed **logistics** (`flowType: "logistics"`).
  - **Diagonal-hatched** segment = **market** diffusion (`flowType: "market"`) — a
    `repeating-linear-gradient(135deg, …)` overlay, matching the Industry land-bar hatch idiom
    (`COPPER_HATCH`/`IDLE_HATCH` in `industry-panel.tsx`).
  - Ordering within a side: **solid (logistics) sits against the centre divider**, **hatch (market)
    fans outward**, symmetric on both sides.
- **Units:** cumulative volume over the 200-tick window. (See
  [Two scales, one order](#two-scales-one-order).)
- **Legend:** a small banner — "solid = directed logistics · ▦ hatched = market diffusion" — plus the
  per-column ◀ Imports / Exports ▶ direction legend.

### Partner drill-down (preserve, don't regress)

The old Trade Activity panel listed the top partner systems per good (Sources / Destinations). The
diverging bars don't show partners inline, so to avoid losing that information, **each External bar row
gets a hover tooltip** listing its top partner systems with quantities — for an **imported** good, the
**source** systems it comes from; for an **exported** good, the **destination** systems it goes to —
reusing the existing `rankGoodFlows` partner aggregation. This is the only place
partner-level detail lives in v1; deeper partner views are deferred.

## Shared ordering model

Both columns are rendered from **one** ordered row set so rows align:

1. **Row set** = every good with *any* activity in either column. Because Internal is dense (all 24 on
   an inhabited system), the row set is effectively driven by Internal; External fills the rows it has
   flow for and leaves the rest blank.
2. **Group by tier ascending:** Raw (tier 0) → Processed (tier 1) → Advanced (tier 2), separated by
   thin **tier bands** (label + a tier-colour swatch using the existing `TIER_COLOR` palette: green /
   amber / cyan + a hairline rule). This gives a **stable layout** — a good keeps its position across
   systems, so players build spatial memory — and reads as the production chain.
3. **Within a tier, sort by internal net descending** (exporters first), so each tier reads as a small
   funnel. (Rationale for net-within-tier over a fixed canonical order: the tier grouping already
   provides cross-system stability; net-first keeps the biggest movers at the top of each group.)
4. **Blank (un-traded) rows:** a good present in Internal but with no external flow renders **blank** on
   the External side — no bars, a faint `·` in the net column, the good name muted. The row height is
   held by the Internal side so alignment is preserved. This keeps the eye on real flow and makes a
   sparse External column *mean something*: a weakly-connected outpost reads as mostly blank; a hub
   fills up.

### Two scales, one order

The two columns share a good **order**, not a numeric **scale**. They measure different things —
Internal is per-cycle *rates*, External is *cumulative volume over 200 ticks* — so each column
normalises bar widths to its **own** maximum (the largest single production/consumption rate for
Internal; the largest single import/export total for External). The cross-column comparison is
therefore **qualitative**: same row, compare *sign* and *within-column relative size*, not absolute
magnitude. (E.g. "Minerals is this system's biggest internal surplus but only a middling export" — a
relative read, not an equality.) The legends label the differing units so this isn't mistaken for a
bug.

## Colour: uniform red/green

Bars use **uniform direction colour** — red for the inflow side (consumption / imports), green for the
outflow side (production / exports) — *not* a colour-per-good. The diverging bars are already labelled
by good name, so per-good hue mostly adds noise and competes with the hatch texture for attention. A
game-wide per-good colour identity (usable here as a small accent and elsewhere across the game) is a
worthwhile idea but belongs in its **own dedicated colour-design pass** where the palette can be chosen
carefully; it is explicitly out of scope here.

## No gap label

The tab does **not** auto-detect or label "stuck surplus" (high internal production, low external
export) or any other gap. The aligned layout already makes such gaps *visible* (a large internal bar
beside a small external one, same row), which is the entire point of the two columns. Three reasons not
to add a label:

1. It is redundant with what the bars already show.
2. Detecting it requires an arbitrary threshold (how big a gap counts?) — a magic number that cuts
   against the project's emergent-realism / coarse-calibration discipline.
3. Surfacing trade *opportunities* is the **price overlay's** role; auto-labelling gaps here
   over-reaches this tab's legibility purpose.

Revisit gap call-outs later, once directed logistics becomes player-contestable (the point at which
watching a faction's supply chain becomes actionable).

## Volume-over-time series

Full-width beneath the two columns: the existing **Recharts** line chart with two series — imports
(red) and exports (green) — bucketed over the flow-history window
(`bucketizeVolumeHistory`, 20 buckets across `FLOW_HISTORY_TICKS = 200`). This is the one genuine
time-series in the tab, and Recharts is the right tool for it (unlike the diverging bars, which stay
custom CSS). Salvage the current `VolumeSparkline` from the Trade Activity panel before that panel is
removed.

## Header meta line

Each column header carries a small, quiet meta string as a one-glance connectivity read (replacing the
dropped per-tier counts): Internal shows the active-good count (e.g. "24 goods"), External shows the
traded-good count (e.g. "trades 11"). Low-priority polish — wording is open, and it can be dropped
without affecting the design.

## Component architecture

- **`components/ui/diverging-bars.tsx` — new reusable primitive.** Generalise the current
  `SubstrateTradeBars` (whose internals are a clean ~40-line CSS diverging bar) into a unit-agnostic
  component. It renders a **flat list** of bar rows against a **shared, caller-supplied `maxValue`**
  (so multiple instances across tiers share one scale), and the tab composes the two-column,
  tier-grouped layout around it. Sketch of the props:

  ```ts
  interface BarSegment {
    value: number;
    side: "left" | "right";
    color: "import" | "export" | "consume" | "produce"; // → red (in) / green (out)
    pattern: "solid" | "hatch";
  }
  interface DivergingBarRow {
    goodId: string;
    label: string;
    segments: BarSegment[]; // 0 segments → blank/un-traded row
    net: number;
    blank?: boolean;
  }
  interface DivergingBarsProps {
    rows: DivergingBarRow[];
    maxValue: number;            // shared normalisation denominator
    netFormatter?: (n: number) => string;
  }
  ```

  Simple mode (Internal) uses one left + one right solid segment; split mode (External) uses
  `[hatch, solid]` per side. Keep Recharts out of this component.

- **`components/system/logistics-panel.tsx` — the tab content.** Fetches via `useSystemLogistics`,
  computes the two normalisation maxima, slices the row model by tier, and renders: column headers +
  legends, the flow-split legend banner, the tier bands with paired `DivergingBars` (internal slice |
  external slice) per tier, the per-row partner tooltips, and the volume series. Visibility gating:
  if the system is unsurveyed, render the existing `EmptyState` ("Scan this system with a ship in range
  …").

- **Reuse:** `VolumeSparkline` (moved out of the deleted panel), `EmptyState`, `Card`, `SectionHeader`,
  `Badge`, the `TIER_COLOR`/`TIER_LABEL` palette, and the existing tooltip primitive.

## Data layer

- **Engine (pure, unit-tested) — `lib/engine/logistics.ts` (new):** a function that takes the raw
  prod/con rates (`SubstrateGoodRate[]`) and the aggregated per-good flow split, and returns the
  **aligned, tier-grouped row model**: union of goods, tier grouping, net-descending within tier, blank
  flags, and the per-row segment values for both columns. This supersedes `prepareTradeBars`
  (`lib/utils/substrate.ts`) and absorbs its normalisation/net/sort responsibilities (migrate its
  tests). Pure — no DB, Vitest-tested.

- **Service — `lib/services/trade-flow.ts` (extend) → `getSystemLogistics(playerId, systemId)`:**
  composes the two sources, visibility-gated together (server-side, as `getSystemTradeFlow` already
  is):
  1. prod/con rates for the system (the same `capacityGoodRates` source the Industry readout uses —
     reused, not recomputed).
  2. trade-flow aggregation reworked to **group by `goodId` + direction + `flowType`** and return
     **all** active goods (retire the top-5 cap). Use a Prisma `groupBy` on
     `["goodId", "flowType"]` filtered by `toSystemId`/`fromSystemId` and `tick > minTick`, plus the
     existing batched partner-name resolution for the tooltips.

  Returns a fully typed `SystemLogisticsData` (typed at the boundary, validated once; no `unknown`).

- **API route — `app/api/game/systems/[systemId]/logistics/route.ts` (new):** thin wrapper — auth →
  `getSystemLogistics` → `NextResponse.json` with `Cache-Control: private, no-cache`.

- **Hook — `lib/hooks/use-system-logistics.ts` (new):** `useSuspenseQuery`, query key added to
  `lib/query/keys.ts`. Flow + prod/con are **tick-changing dynamic data**, so the key is tick-scoped
  and invalidated by the existing tick invalidation, per the static-vs-dynamic separation convention.

- **Types — `lib/types/api.ts`:** add `SystemLogisticsData` (per-good rows with prod/con + the
  four-way flow split + partners + net + tier) and `SystemLogisticsResponse = ApiResponse<…>`.

## Migrations & removals

- **Overview page:** remove `TradeActivityPanel` entirely. The Overview gets a dedicated polish pass
  later (out of scope here) — for now it simply loses the Trade Activity section.
- **`components/system/trade-activity-panel.tsx`:** delete after salvaging `VolumeSparkline`. The
  top-5 `GoodFlowList`/`GoodFlowRow` list is replaced by the External chart (with partner info
  preserved via the per-row tooltip).
- **Industry tab (`components/system/industry-panel.tsx`):** remove the "Trade balance" card (the
  `SubstrateTradeBars` usage + its caption/explainer). Industry keeps buildings, land pools, and
  health; prod/con balance moves to Logistics. The `EconomyCycleCaption` (shard-timing note) moves with
  it or is dropped — decide during build.
- **`components/system/substrate-trade-bars.tsx`:** delete — its only caller is the Industry card, and
  its rendering is replaced by `DivergingBars`.
- **`lib/utils/substrate.ts` `prepareTradeBars` + tests:** superseded by the engine row-builder;
  migrate the relevant test cases.
- **Docs:** on ship, fold the functional description into the active economy/trade docs (e.g.
  `docs/active/gameplay/trade-simulation.md` and the system-traits/industry docs), update `docs/SPEC.md`
  (the Trade Simulation and Economy sections reference the per-system panels), delete the parent
  rework doc's P4 line, and delete this planned doc per the doc lifecycle.

## Edge cases

- **Unsurveyed system** (`visibility === "unknown"`): the whole tab shows the scan `EmptyState`; no
  charts.
- **Inhabited but no trade:** Internal renders (prod/con dense), External is all-blank — a valid,
  meaningful state (isolated system).
- **Uninhabited / undeveloped:** little or no prod/con and no flow → `EmptyState` ("No logistics
  activity").
- **Normalisation when a column max is 0:** guard division (the existing `prepareTradeBars` already
  handles `maxRate === 0` → width 0); carry that guard into the engine builder.
- **`flowType` values:** only `"market"` and `"logistics"` exist today; treat any unexpected value as
  market (or surface separately) — validated at the service boundary.

## Testing

- **Engine (`lib/engine/logistics.ts`):** unit-test the row model — tier grouping order, net-descending
  within tier, blank-row handling for un-traded goods, the four-way flow-split segment values, shared
  normalisation (including the all-zero guard), and union-of-goods construction.
- **Service:** integration-test `getSystemLogistics` — `flowType` split correctness, all-goods (no
  top-5) output, visibility gating, and partner resolution.
- **Component:** render checks for the two-column tier-grouped layout, the hatch split, blank rows, and
  the visibility `EmptyState`.

## Deferred / future

- **Per-good colour identity** — its own game-wide colour-design pass.
- **Gap / opportunity call-outs** — once directed logistics is player-contestable.
- **Deeper partner / route views** — v1 keeps partner info to a hover tooltip.
- **Lane-routed flow rendering** — stays deferred (see the P3 map-overlay decisions); the tab is
  per-system and node-level, so it doesn't need routed geometry.

## Build phasing (rough — detailed plan via writing-plans)

1. **Data layer:** engine row-builder + tests; `getSystemLogistics` service (flow split + all-goods) +
   API route + hook + query key + types.
2. **Component:** `DivergingBars` primitive generalised from `SubstrateTradeBars` (+ visual/unit
   coverage).
3. **Tab:** `logistics-panel` + tab registration + volume series + partner tooltips; wire the hook.
4. **Migration & cleanup:** remove Trade Activity panel (salvage `VolumeSparkline`) and Industry Trade
   balance card; delete `SubstrateTradeBars`/`prepareTradeBars`; update SPEC + active docs.

Likely ships as **2 PRs** (data + component, then tab + migration) rather than one, per the
phase-PR convention.
