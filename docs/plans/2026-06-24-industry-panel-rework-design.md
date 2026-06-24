# Industry Panel Rework — Design (SP3.5 · T10)

> Collaborative design output for Task 10 of `2026-06-23-sp3.5-infrastructure-decay.md`,
> replacing that task's "invoke frontend-design blind" step. Approved via 5 wireframe
> iterations. Visual reference (gitignored, local): `.superpowers/brainstorm/265-1782239595/content/wireframes-v5-final.html`.
> This doc + the live theme tokens are the build contract. Graduates into
> `docs/active/gameplay/economy-infrastructure-decay.md` at T11, then this file is deleted.

## Goal

Make the now-moving economy legible: per building, show **availability** (shared land
headroom), **built**, and **in use** (the decay-relevant quantity), so the built-vs-used
gap that disuse-decay rots is visible at a glance, plus a coarse health read. The old
panel (a stack of one-datum rows + a disconnected Labour bar) is replaced.

## Layout — four sections, top to bottom

1. **System health strip** (replaces the old Development card)
   - `Badge` health = system `industryHealth` → thriving (green) / coasting (amber) / declining (red), label `STABLE / COASTING / DECLINING`.
   - System name, `unrest` (mono), `labour` % (mono).
   - **Tally** line: `N stable · N idle · N collapsing` (counts of the building rows by health) for instant triage.
   - **Info icon** (header, right) → `Tooltip`/popover containing the colour + land legend (doubles as the in-game key; no permanent panel space).

2. **Deposit land** pool — extractors
3. **General land** pool — housing + factories (shared)

   Each pool = a header (`USED / TOTAL used · FREE free`) + one **stacked land bar** + the
   building rows beneath, grouped by role sub-label (Extraction / Housing / Production).

4. **Trade balance** — the one secondary block. Reuse `SubstrateTradeBars` (produces-vs-consumes
   diverging bars). This is where the old "Production & consumption" card lives now.

**Removed:** the standalone "Supply chain" card (inputs now live inline on each producer's
`needs` line) and the old "Development" card (labour → health strip; land → pool bars).

## The two bars do two different jobs

### Pool stacked land bar = shared competition (one per pool)

Full width = the pool's land total. Aggregate slices, then free:

- **Deposit:** `[extractors][free]` from `space.depositWorked / space.deposit`.
- **General:** `[housing][factories][habitable-free][factory-only-free]` where
  - housing footprint = `space.habitableUsed`
  - factory footprint = `space.generalUsed − space.habitableUsed`
  - `generalFree = space.general − space.generalUsed`
  - `habitableHeadroom = max(0, space.habitable − space.habitableUsed)`
  - **habitable-free** (housing can still grow here) = `min(generalFree, habitableHeadroom)`
  - **factory-only-free** (beyond the habitable cap) = `generalFree − habitable-free`

  The two-tone free tail carries the habitable ceiling **spatially** — no label. When the
  copper-hatched zone runs out, housing has hit its cap though factory ground may remain.

Slice colours are **structural** (warm/muted, the chrome), never the health palette:
housing = copper, factories = muted bronze, habitable-free = faded-copper hatch,
factory-only-free = dark void.

### Row bar = this building's used vs idle (the decay story)

Track scaled to **built** (`count`); solid fill = **in use**; hatched remainder = **idle
capacity** (the gap disuse decay rots). Right of the bar: **`%` in use** (quick read) +
**decimal magnitude** `used / built` (e.g. `90% · 5.4/6` — decimals stay; the model is
continuous "lots of small facilities", hiding the fraction would be dishonest).

- **colour = health only** (green / amber / red), green is the **default** resting state.
- exact noun in the bar's **hover tooltip** — "worked" (extractors) / "occupied" (housing) /
  "staffed" (producers) — so rows carry no per-pillar text.
- under idle/collapsing rows, a `cause` line; under producers, a `needs` line (input chips).

## "In use" per building (data addition beyond T9)

T9's `staffed = count × labourFulfillment` is a uniform ratio — it can't drive a per-building
read. Replace it with the **real** decay-`used`, matching `computeSystemDecay`:

- **Housing:** occupancy = `housingUsed(population)` = `population / POP_CENTRE_DENSITY`
  (may exceed `count` → overshoot, see edge states).
- **Producers (extractors + factories):** `count × min(labourFulfillment, outputUptake(good))`
  where `outputUptake(stock, minStock, maxStock)` is the existing seller-side signal
  (`lib/engine/tick.ts`). Requires threading **maxStock** through the readout/service
  (only minStock is threaded today).

Also expose a coarse **`idleReason`** per building for the `cause` line:
`"occupancy"` (housing), `"selling"` (producer, uptake binds), `"labour"` (producer, labour
binds), else `undefined`.

## Per-building health (new engine fn)

`buildingHealth({ used, built, unrest, unrestDecayThreshold })` → `IndustryHealth`:

```
if used > built                 → "declining"   // over capacity (overshoot death-sink)
if unrest >= unrestDecayThreshold → "declining"  // unrest teardown (catastrophic channel)
idle = clamp(1 − used/built, 0, 1)
if idle >= IDLE_COLLAPSING_FRACTION → "declining"  // effectively not working
if idle >= IDLE_COASTING_FRACTION   → "coasting"   // disuse decay nibbling
                                    → "thriving"   // within the slack deadband
```

`IDLE_COLLAPSING_FRACTION` = `0.5` — a **display** classification band (how rows are coloured),
not an economy rule, so a round value is fine. `IDLE_COASTING_FRACTION` (= `0.15`, existing)
is the green→amber deadband: green holds below 100% because a little idle is normal slack.

Component maps `IndustryHealth` → label (stable/idle/collapsing), status colour, and the dot.

## Colour & token mapping (build with live theme tokens, not the wireframe hexes)

| role | token |
| --- | --- |
| stable / green | `status-green` `#22c55e` (light `#86efac`) |
| idle / amber (warning) | `status-amber` `#f59e0b` (light `#fcd34d`) |
| collapsing / red | `status-red` `#ef4444` (light `#fca5a5`) |
| copper accent / chrome | `text-accent` `#e0845f` + Card copper stripe |
| surfaces / border | `surface` `#161b22`, `border` |

Reuse `Card` (copper left stripe + sharp corners), `Badge`, `SectionHeader`, `Tooltip`,
`EmptyState`, `formatMagnitude`, `font-mono` numerics, `font-display` headings. No raw markup
duplicating a component.

## Edge states

- **Overshoot** (`used > built`, housing rotted below its occupants — the T7 death-sink):
  bar pegs full + red.
- **Throttled input:** flagged on the `needs` line (`⚠ Alloy 60%`), **not** the row colour —
  colour tracks capacity decay; a starved-but-staffed producer isn't rotting.
- **Undeveloped** (no built base): existing `EmptyState`, unchanged.
- **Unknown visibility** (unscanned): existing `"unknown"` branch, unchanged.

## Build order (TDD)

1. Engine: `buildIndustryReadout` → per-building `used` + `idleReason` (thread maxStock, import `outputUptake`); replace `staffed`.
2. Engine + constants: `buildingHealth` + `IDLE_COLLAPSING_FRACTION`.
3. Service: thread `maxStock` from the market band; API type follows the readout.
4. Component: full rework + info-icon legend tooltip.
5. Verify in the running app (thriving / coasting / declining systems read correctly; Foundry intact).
