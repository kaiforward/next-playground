# UI WS4 — System- & Faction-Detail Redesign

> **Status:** Designed (collaborative pass, browser prototype approved). The visual oracle is
> `docs/build-plans/ws4-system-detail-prototype.html` — open it in a browser; it is the pixel
> reference for the build. Phased build plan: `docs/build-plans/ws4-system-detail.md`. This is
> WS4 of the [UI overhaul](./ui-overhaul.md); it supersedes that doc's intent-level WS4 section.

## Headline

The detail panels predate the accurate colony sim and get in the way: the modal is slow, blocks the
map, and buries the few numbers that matter under cards that all look alike. WS4 turns them into
**fast, docked, non-blocking drawers** you can scrub the map behind, reorients the system overview
around **three loud vitals (stability / development / population)** in a *reusable, extensible stat
grid*, splits the overloaded faction screen into **tabs**, and gives the Industry tab a proper
**deposit/space breakdown** built from a single **four-state chip grammar**. It is a **read-only
legibility + reshape pass** that deliberately leaves quiet room for the player-controls workstream
that follows (Vic3 model: your faction gets actions, others stay read-only).

This pass touches **no engine mechanics** except one build-time recalibration (`[Sys 2]`). Data that
already exists is surfaced better; nothing new is simulated.

## Reference lessons (EU5 / Victoria 3 / Stellaris — don't re-derive)

- **Victoria 3 is the closest model.** Its country panel is the *same lens* for your nation and
  others, gated by relations — so the faction screen is a **tabbed country panel**, diplomacy is
  *one tab*, and building read-only first is correct.
- **Density is a feature; don't over-clean.** Stellaris 4.0's planet UI was panned for hiding info
  behind scroll/nesting. Prefer high information density over tidiness.
- **Hierarchy beats uniformity.** EU5's province panel drew fire for "uniform boxes that all look
  the same." The things that matter must look *different and louder* than the rest.

These give the overview its rule: **high density, strong hierarchy** — loud vitals, quiet context,
hide nothing behind scroll.

---

## 1. Shared shell + chrome reshape (the keystone)

The centered modal `DetailPanel` (`components/ui/detail-panel.tsx`, used by six panels: system,
faction detail, faction list, diplomacy, events, styleguide) becomes a **left-docked, full-height,
non-blocking drawer**. Reshaping the one shared component moves all six.

- **Docked:** `top: var(--topbar-height); left: 0; bottom: 0`, fixed width **~clamp(400px, 30vw,
  560px)** (tune at build; ~500px fits all six system tabs without horizontal scroll). Header
  pinned, body scrolls internally. Slide-in-from-left enter animation (drawer feel), replacing the
  scale-fade.
- **Non-blocking:** delete the full-screen `inset-0` backdrop entirely so the map keeps all pointer
  events. Pan/zoom and click other systems with the panel open.
- **Re-points on map click:** clicking another system re-targets the panel (the URL is already the
  single source of truth from WS1); content swaps in place — scrub system-to-system with no
  open/close churn. This is the core UX win.
- **Close = X / Escape → map (`/`).** No click-off-to-close (no backdrop). Fixes the faction bug:
  its `backPath` is `/factions` (→ list); set it to `/` so closing goes straight to the map.
- **Map recenter offset:** when a panel opens, nudge the map so the selected system sits in the
  visible (right) area, not hidden under the drawer (EU5/Vic3 do this).
- The `size` variants (md/lg/xl) collapse toward the single docked width; the modal-centering CSS,
  transparent backdrop, and scale-fade are removed.

**Retire the `GameSidebar` → absorb into the `TopBar`.** The sidebar (fixed-left, `z-40`) only holds
logo, nav (Events / Factions / Diplomacy), Tick + `SpeedControls`, and Save / Exit — all of which
fit the near-empty topbar:

- **Left:** logo + the three nav entries (compact icon+label, open their `@panel` drawers).
- **Center:** game speed (pause / 1× / 5× / max) + tick + TPS — Paradox-classic placement. **Leave
  the center-left deliberately roomy** — treasury / resource readouts land here in the agency
  workstream (Vic3 top-bar-as-resource-strip).
- **Right:** Save / Exit.
- The breadcrumb folds away (the drawer's own header + tabs show location). Delete `GameSidebar`, the
  `marginLeft` shim in `game-shell.tsx`, and the `useSidebar` / collapse machinery.

**Right-align the map controls.** `MapControlsDock` is bottom-**left** (`bottom-4 left-4`) today —
move to bottom-**right** (`right-4`, `items-end`) so the mode selector + price panel clear the drawer.
**Position only** — the map-mode tool's internals stay as-is.

**Custom scrollbars (Electron target = always Chromium).** Style `::-webkit-scrollbar` directly (no
JS lib needed) to match Foundry: thin, square, a muted slate thumb (`rgba(139,148,158,0.3)` with a
`surface`-colored border padding it to a sliver) that goes copper on hover; `scrollbar-gutter: stable`
to avoid content jump. `OverlayScrollbars` (`overlayscrollbars-react`, v2) is the deferred option
*only* if we later want auto-hiding overlay scrollbars app-wide — not needed for this pass.

---

## 2. System overview — loud vitals, quiet context

Structure top-to-bottom (see prototype Overview tab):

1. **Vitals grid (loud).** A **reusable, extensible stat-tile grid** (`VitalTile` + a grid wrapper).
   Today it holds three tiles; it is built so **control / treasury / tax base / logistics** drop in
   later as further tiles (raw on the system screen, aggregated on the faction screen) with no
   redesign. The same primitive is reused on the faction Overview. Each tile: uppercase display
   label + status dot, a large `font-mono` value, a thin meter/bar, and a one-line hint.
   - **Stability** — `1 − unrest` as a %, on the **map's stability ramp (calm cyan → unstable red)**,
     from `useSystemPopulation`. **Vital-tile colors align with the WS1 map mode ramps for
     cross-surface clarity** — stability cyan↔red, development copper — so a value reads the same hue
     on the tile as it does on the map.
   - **Development** — **progress vs. the system's own potential** (`% of potential · N pts`), copper
     meter. *Not* the map's raw cross-system `developmentPoints`; a single-system screen reads
     better as "built out vs. its ceiling, room to grow." Needs a small service extension to emit
     the system's dev points + potential (the map already computes `developmentPoints`; potential
     comes from `habitablePotentialPop` + `industryPotential`).
   - **Population** — headcount + a thin **composition sub-bar** (unskilled / technician / engineer,
     blue / cyan / purple to match the Industry grades) + growth trend. This is the "population
     spread" — how big, growing?, made of what. From `useSystemPopulation` + the labour allocation.
2. **Context strip (quiet).** Faction (color swatch + name), Government, Danger, Astrography
   (sun-class glyph + body count) as a tight 2-up — deliberately *unlike* the loud vitals (no tall
   `StatList`). Astrography detail keeps its own tab.
3. **Economy (compact).** Produces / Consumes as compact chip rows. Full market lives on the Market
   tab.
4. **Events banner + Construction** — kept; both are decision-relevant.

**Cut from the overview: the Market Snapshot (best/cheapest prices) and the Stock-Distribution pie.**
Trader-era hangovers — price-hunting was for a trading player we no longer are, and a stock pie is
noise for triage. The Market tab already owns price/stock detail.

---

## 3. Faction screen — tabs + shared vitals

The faction detail (`app/(game)/@panel/factions/[factionId]/page.tsx`) is one long diplomacy-heavy
scroll. Split into **tabs**, mirroring the system screen and the Vic3 country panel. (This is
**structural reuse** — the vitals grid and shell are already specced above; no new visual questions.)

- **Overview** — identity (`FactionCard`), **aggregate vitals** using the *same* `VitalTile` grid
  (territory size, total population, avg stability, total/avg development; future treasury / control /
  tax-base slots), government + doctrine compacted, construction.
- **Diplomacy** — today's bulk: the relation-score list, alliances/pacts, recent diplomatic events.
- **Territory** — the system list (today's cramped "Territory Sample" promoted to a fuller list;
  later, per-system vitals inline).

Same loud-vitals → quiet-detail hierarchy; diplomacy no longer swamps the screen; Overview reserves
quiet space for the agency workstream's controls.

---

## 4. Industry tab — deposit/space breakdown (`[Sys 1]`)

> **Scope guard:** this re-specs the **deposit/space breakdown only.** Everything else on the current
> Industry tab is **preserved** — the labour card (population decomposition + skill licensing), the
> per-building tier-1/2 **input / supply-chain "needs X, Y" lines**, health glyphs, per-building
> tooltips, and the compact/detailed density toggle all stay.

A **Chipped / Table** view toggle (segmented control, like the existing density toggle). Chipped is
the default (glanceable, game-y); Table is the precise alternative. Both render the same data.

**The four-state chip grammar** — one grammar for both deposits and industry:

| Chip | State | Meaning |
|------|-------|---------|
| copper fill (full or **partial**) | **built & staffed** | working; partial fill = fractional staffing / working |
| **red** (`rgba(239,68,68,.28)` fill, red border) | **built but wholly idle** | wasted, decaying capacity — actionable |
| **dashed** (copper dashed border, empty) | **not built** | buildable potential |

Reading: a chip's inner fill width = its fractional working level; a built unit that receives **zero**
staffing is red (not a partial); slots/space with no building are dashed.

- **Deposits** — chips = **the system's full slot count** (bounded); built-but-idle = red, unbuilt
  slots = dashed. **No aggregate header bar** — the chips already show total + used + idle, so the
  old `LandBar` is dropped here. Each row: name + `×yield` (gold when rich) · chips · `worked/slots`
  label · `out/cyc`. Worlds can have **double-figure deposits**; chips **wrap onto new lines
  gracefully** (`flex-wrap`, row `align-items: flex-start` so name/labels stay anchored to the top
  line) — the chip footprint doubling as a "how rich is this world" indicator is intentional.
- **Industry (production)** — chips = **quantity built** (unbounded) + **one dashed "room to build"
  chip** while general space remains; partial last chip = staffing; wholly-idle built unit = red.
  Chips add the *quantity* signal the old staffing bars never showed.
- **General land (aggregate)** — stays a **magnitude bar** (segmented housing / factory / free), not
  chips — continuous capacity isn't slot-like.

**Chip / segment palette** is `dataviz`-validated against the dark surface. Deposit/industry chips use
copper (`--accent` / `--accent-muted`); the demand chart (below) uses base = copper `#d06a42`,
technician = deep-cyan `#0891b2`, engineer = purple `#a855f7` (passes lightness / chroma / CVD /
contrast; the deep-cyan is a validated variant of the Industry grade cyan `#06b6d4`).

## 5. Population tab — consumer-segmented demand chart (`[Sys 3]`)

`[Sys 3]`'s data question is resolved: consumption **already** includes the technician/engineer tiers
additively — `consumptionRate` runs on a `CivilianDemandBasis = { population, technicians, engineers }`
and `consumptionBreakdown()` exposes the three terms. So this is a *presentation* change, and it lands
on the **Population tab** (its natural home), superseding the spec's Industry/logistics placement.

Swap the Population tab's **Demand footprint** `<ul>` (good → `demandRate/cyc`, split buried in a
tooltip) for a **segmented horizontal bar chart**: one bar per good (sorted by total demand), each
stacked into **base population / technicians / engineers** in the validated palette. Payoff: you *see*
a good's demand profile — a mostly-copper bar is a staple everyone eats; a fat purple tail is an
engineer-driven advanced good. Handle the `MIN_DEMAND` floor: when segments sum below the floored
total, show the remainder as a faint hatched "market minimum" tail (the existing tooltip already names
this). Per `dataviz`: legend always present, values in text tokens (not series color), 2px surface gap
between segments, sharp ends (Foundry override of the default 4px rounding), per-segment hover tooltip.

## 6. Stale industry labels (`[Sys 2]`) — build-time calibration

Not a prose-design item. The health labels (thriving / coasting / declining; the "N stable / N idle /
N collapsing" tally) fire on thresholds that predate the accurate sim, so healthy systems read
alarmist. Thresholds: `IDLE_COASTING_FRACTION` (0.15), `IDLE_COLLAPSING_FRACTION` (0.5), unrest θ
(0.75) in `lib/engine/industry.ts` / `lib/constants/infrastructure.ts`; label strings in
`components/system/industry-panel.tsx`. **Recalibrate at build time using the simulator**
(`npm run simulate`): read the actual idle-fraction / unrest distribution on a healthy galaxy, re-tune
the thresholds (and reword if the vocabulary itself is too dramatic) so a normal system reads green.

---

## What this pass is not

Read-only legibility + reshape only. No player controls (they arrive in the agency workstream — the
layouts deliberately reserve quiet space for them). No engine mechanic changes except the `[Sys 2]`
threshold recalibration. `[Sys 5]` (pops die → undeveloped) is separate engine work (WS5).
