# Economy UI Legibility — S1→S2 Interstitial (design)

> **Status: design (approved), not built.** Transient build-plan — **delete on ship** (the code
> becomes the source of truth; the Industry-panel behaviour folds into `docs/active/gameplay/
> economy-specialisation.md` + the Economy section of `SPEC.md`). Roadmap slot:
> `docs/planned/economy-specialisation.md` "Staged decomposition" — the interstitial between **S1**
> (shipped) and **S2** (specialisation complexes). Backlog item: `docs/BACKLOG.md` → "Economy UI
> legibility — quick wins."

## Goal

S1 shipped deep mechanics (skill-tiered labour, academy licensing, per-good 3-grade labour vectors)
but the Industry panel shows *numbers without the why*: the skilled-labour pools are computed and
thrown away, an idle factory only says "needs academy" (not which one), and buildings carry no
"what it does" copy. This is a **display-only legibility pass** — surface data the engine already
computes (plus a small readout refinement), no changes to the labour model or economy mechanics.
The ambitious pinnable/nested deep-tooltip system stays deferred to after the full sX track.

## Scope

**In:**
1. **System skilled-labour pools** — a "Labour" card surfacing the three system-wide pools
   (Workforce / Technicians / Engineers) as supply-vs-demand rows.
2. **Per-factory binding pool** — refine the idle reason so a skill-starved factory names the
   *specific* academy it needs (Vocational School vs Research Institute), not a generic "needs academy".
3. **Per-factory grade breakdown** — each production row shows how its staffing splits across the
   grades, in two densities (a **Compact / Detailed toggle**), with a tooltip carrying the full
   per-grade filled/needed detail + a "what it does" description.
4. **Building descriptions** — short "what it does" copy for every building type, especially the two
   academies.

**Out (unchanged):** the labour model, economy tick, decay, seed, build planner. No new gameplay.
Deep pinnable/cross-linked tooltips (separate, larger, post-sX project).

---

## Design

### 1. Three colour languages — never overloaded (redundant encoding)

Colour is a *reinforcement*, never the sole signal (colourblind-safe). Each of the three axes gets
its own hue family, and each distinction is *also* carried by shape / texture / position / a glyph.

| Axis | Hues | Redundant channel |
|------|------|-------------------|
| **Land / space** | copper (`accent` / `accent-muted`) | existing |
| **Labour grade** | **unskilled = blue** (`status-blue`), **technician/skill-1 = cyan** (`status-cyan`), **engineer/skill-2 = purple** (`status-purple`) | texture (solid / diagonal / cross-hatch) + `U`/`T`/`E` label |
| **Health** | green / amber / red (`status-*`) | **glyph shape** (see below) |

No new theme tokens required — reuse the existing `status-blue/cyan/purple`. Optionally alias them
in `globals.css` as `--color-labour-unskilled/technician/engineer` for readability at call sites.
**Unskilled is blue, not grey** — grey read as "unstaffed/absent" in prototyping.

### 2. Health as a glyph, not a coloured square

Replace the square status dot with a trend glyph (shape-first; colour reinforces). Maps from the
existing `IndustryHealth`:

| Health | Glyph | Meaning |
|--------|-------|---------|
| `thriving` | `▲` (green) | in use, holding |
| `coasting` | `▬` (amber) | slack, slowly shrinking |
| `declining` | `▼` (red) | shedding capacity |
| (severe) | `▼▼` | optional: over-capacity / unrest teardown |

The same glyph prefixes the **system-health badge** at the top of the panel for consistency. The
glyph is driven by `buildingHealth(...)` (full picture: staffing ∧ selling ∧ unrest ∧ over-capacity)
— it is the one at-a-glance state signal, so it must reflect *all* throttles, not just labour.

### 3. Global "Labour" card (system-wide spread)

A dedicated card directly under the system-health strip — three supply-vs-demand rows, always
visible (survives the skill-starved case: a frontier world with demand and **no academy** still
shows the pools, precisely when they matter most — the reason the pools do **not** hang off the
Academies section).

| Row | Bar fill (hue) | Numbers | % colour |
|-----|----------------|---------|----------|
| **Workforce** | `population / Σ labour demand` (blue) | `<pop> pop / <demand> jobs` | health severity |
| **Technicians** | `skill1Cap / skill1Demand` (cyan) | `<cap> lic / <demand> req` | health severity |
| **Engineers** | `skill2Cap / skill2Demand` (purple) | `<cap> lic / <demand> req` | health severity |

A pool with demand but zero cap (no academy) reads 0% with a red numeral and a cause line
(`no Research Institute — engineer-grade work can't run`). The `%` numeral carries health *severity*
(green/amber/red) while the bar carries *skill identity* — the two colour languages stay separate.

### 4. Per-factory production rows

Each production/extractor row is one line with a **shared, aligned label column** (sized to the
widest label so every bar starts on the same vertical line — see §8). Structure, left→right:

```
<glyph>  <name [×yield for extractors]>  [==== staffing bar ====]  <staff%>  <used/built>  <output/cyc>
         └ cause / needs lines wrap underneath, indented (unchanged from today) ┘
```

- **Staffing bar + `staff%`** = **pure staffing** = `effectiveFulfilment(tier)` (headcount ∧ the
  skill ceilings the tier draws on). Bar hue = health (green/amber/red); `%` right beside the bar as
  the fill-level cue.
- **`used/built`** (e.g. `13/14`) = how many of the built factories are effectively operating =
  `round(staffedFraction × built) / built`. Consistent with the bar (same ratio) + the `built`
  denominator conveys the **scale** of that industry locally (replaces the earlier `×count` idea).
- **`output/cyc`** = the good's **real post-gate output** the economy actually produces this cycle
  (staffing × input availability × selling/uptake × tier-0 yield). Complements the pure-staffing %:
  the % says *why* (labour), `/cyc` says *what you actually get* — so a fully-staffed factory
  throttled by a short input reads high `%` but low `/cyc`, with the reason on the cause/needs line.
- **Extractor label keeps `×yield`** (e.g. `Ore ×2.00`, coloured by quality band) — do not drop it.
- **Cause / needs lines** stay exactly as today (the non-labour throttles: input shortages via the
  `needs` chips, `output not selling`, etc.), now including the refined academy-specific cause.
- A tiny **column header** (`staff · used/built · output`) above the list labels the trailing numbers
  so the block reads like a table.

**Compact vs Detailed toggle** (segmented control in the panel header, same pattern as the map-mode
toggles; persisted in `localStorage`; **default = Compact**):

- **Compact** — the single health-coloured staffing bar above.
- **Detailed** — replaces that bar with **per-grade micro-bars**: 1–3 thin stacked lines (one per
  grade the good uses), `U`/`T`/`E` label *outside* the bar (legible), each filled to that grade's
  fulfilment in the grade's hue (blue/cyan/purple). Tier-0 → one line; tier-1 → two; tier-2 → three.
  Rows get 1–3 lines tall; the trailing cluster (`% · used/built · /cyc`) stays put. Precise
  "how much of each grade" without hovering, at the cost of a little vertical space.

Both densities share the same tooltip.

### 5. Per-factory tooltip (reuse `components/ui/tooltip.tsx`)

Hovering a production row opens a tooltip with the full breakdown (this is where the "three bars"
live — room to breathe, per the "never cram N scaled series into one bar" rule):

- **Header** — good name + health glyph; sub-line `tier N · <tier label> · ×<built> built`.
- **Description** — the "what it does" copy (§6).
- **Staffing — filled / needed** — up to three per-grade rows (Unskilled / Technician / Engineer),
  each a mini bar (grade hue) + `<filled> / <needed>` numbers; the binding grade flagged `wall`.
  Per-grade `needed = built × labourVector[grade]`; `filled = needed × gradeFulfil`. All derivable
  client-side from `BUILDING_TYPES[type].labour` (static) × built × the system `LabourState`.
- **Footer** — one sentence: `Output <x>/cyc — staffing <n>%, <grade> are the wall. Build a
  <academy> to license <grade>-grade work.` (academy fix only when a skill ceiling binds).

Academy and housing rows get a lighter tooltip (description + their own staffing), no grade split.

### 6. Building descriptions

A `BUILDING_DESCRIPTIONS: Record<string, string>` (keyed by building type = good id, plus
`housing` / `vocational_school` / `research_institute`) + a short **tier label** per tier
(`0 → "extraction"`, `1 → "basic manufacturing"`, `2 → "advanced manufacturing"`). One or two
sentences each; the academies get the clearest copy since they are the least self-explanatory
(what they license, that they draw unskilled labour, that they decay toward the demand they serve).
Home: `lib/constants/industry.ts` (or a sibling `lib/constants/building-descriptions.ts` if it reads
cleaner). Pure data — no logic.

---

## Data plumbing

The panel currently receives `SystemIndustryReadout` (via `buildIndustryReadout` in
`lib/engine/industry.ts` → `lib/services/universe.ts` → `SystemIndustryData`). Changes:

1. **Expose the labour pools** — add a `labour` block to the readout:
   ```
   labour: {
     workforce:  { have: population, need: Σ labourDemand, fulfil: labourFulfil },
     skill1:     { cap: skill1Cap,  demand: skill1Demand,  fulfil: skill1Fulfil },
     skill2:     { cap: skill2Cap,  demand: skill2Demand,  fulfil: skill2Fulfil },
   }
   ```
   All already computed inside `computeLabourState` / `labourParts` — stop discarding them. The
   population adapters already pass a precomputed `LabourState`; thread the parts through too.

2. **Refine `IdleReason`** — split the single `"skill"` into **`"skill1"` / `"skill2"`** (the (b)
   decision). In `buildIndustryReadout`, when a skill ceiling is the binding sub-gate
   (`effectiveFulfilment < labourFulfil`), pick the pool whose fulfilment is the actual min
   (`skill1Fulfil` vs `skill2Fulfil`). The panel maps `skill1 → "needs Vocational School"`,
   `skill2 → "needs Research Institute"`.

3. **Per-building display fields** — extend each `buildings[]` entry with:
   - `built` (= today's `count`),
   - `staffedFraction` = `effectiveFulfilment(tier)` (drives bar `%` + `used/built`),
   - `output` = real post-gate output/cyc for the good (matches the production the economy tick
     applies: staffing-gated production × `inputGate` × selling/uptake × tier-0 yield),
   - keep the existing in-use/`idleReason` inputs that drive `buildingHealth` (the health glyph).
   Per-grade tooltip numbers are derived **client-side** from `BUILDING_TYPES[type].labour` +
   `built` + the `labour` block — no per-grade-per-building server payload needed.

4. **Descriptions constant** — §6.

5. **API type** (`lib/types/api.ts`) — `SystemIndustryData` picks up the new `labour` block and the
   extended `buildings[]` entry automatically via `SystemIndustryReadout` re-export.

No new endpoint, no new query key — the Industry query already tick-invalidates.

## Files to touch

- `lib/engine/industry.ts` — `SystemIndustryReadout` shape (labour block, refined `IdleReason`,
  per-building `built`/`staffedFraction`/`output`); `buildIndustryReadout` fills them. Pure, unit-tested.
- `lib/constants/industry.ts` (or new `building-descriptions.ts`) — `BUILDING_DESCRIPTIONS` + tier labels.
- `lib/services/universe.ts` — pass through the extended readout (mostly automatic).
- `lib/types/api.ts` — re-export follows the readout.
- `components/system/industry-panel.tsx` — Labour card, health-glyph component, Compact/Detailed
  toggle (localStorage), aligned label grid, trailing cluster + column header, per-building tooltip.
  Extract sub-components (`LabourCard`, `HealthGlyph`, `ProductionRow`, `BuildingTooltip`) to keep
  the file focused.
- `app/globals.css` — optional labour-grade colour aliases.

## Precise semantics (so the four signals never blur)

- **Glyph** = overall health (all throttles). The single at-a-glance state.
- **Bar + `%`** = pure staffing (`effectiveFulfilment`). "How staffed."
- **`used/built`** = staffing-consistent operating count + scale. Same ratio as the bar; `built` adds scale.
- **`output/cyc`** = real output after every gate. "What you actually get."
- **cause / needs lines** = the non-labour throttles (which academy, which input short, not selling).

## Testing

- **Engine (Vitest, `lib/engine/__tests__/industry.test.ts`)** — the `labour` block totals; the
  `skill1` vs `skill2` idle-reason selection (binding-pool cases: skill-1 binds, skill-2 binds,
  headcount binds, selling binds); `staffedFraction`/`output` values incl. the no-academy zero case.
  Keep prisma-tainted imports dynamic (unit project has no `DATABASE_URL`).
- **Component render** — Labour card renders three pools incl. the zero-cap "no institute" case;
  Compact vs Detailed both render; glyph maps correctly; tooltip shows per-grade + description.
- Existing sim / tsc / full unit suite stay green (display-only; no tick behaviour change).

## Scope boundaries / non-goals

- No labour-model, tick, decay, seed, or build-planner changes.
- No deep pinnable/nested/cross-linked tooltip infrastructure (post-sX).
- No price / stock / net-flow / days-of-supply on this panel — those stay on the Market / Logistics
  tabs (avoid re-cluttering; separation of concerns).

## Reference

Approved mockups persist in `.superpowers/brainstorm/963-1782921141/content/`
(`final-composed-v2.html` is the composed final; `visual-treatments.html` and
`clean-vs-microbars.html` document the rejected-busier directions and the reasoning).
Design principle captured in memory: `feedback-mixed-bar-one-datapoint` (a shared bar is for two
consumers of one datapoint, never N differently-scaled series — the reason the per-grade breakdown
lives across the Labour card + Detailed micro-bars + tooltip, not one crammed bar).
