# System & Faction Detail Panels

The detail surfaces are **left-docked, non-blocking drawers** you can scrub the live map behind. The
system and faction screens share one drawer shell and one reusable **vitals grid**, are organised into
**tabs**, and lead each Overview with a few loud stats over quiet context. Most of the surface is still
read-only reporting; the player's own territory additionally carries the construction/colonisation
control surface — quick-add, new-industry, establish-colony, cancel, and the faction's automation
switches — detailed in [player-seat.md](../gameplay/player-seat.md). Theme rules are in
[theme.md](./theme.md); the map side is [map-rendering.md](../engineering/map-rendering.md).

## Docked drawer shell

`DetailPanel` (`components/ui/detail-panel.tsx`) is a fixed, left-docked, full-height drawer
(`top: var(--topbar-height); left: 0; bottom: 0`, width `560px`), shared by every
panel (system, faction, faction list, diplomacy, events, styleguide).

- **Non-blocking** — there is no backdrop, so the map keeps all pointer events: you pan, zoom, and click
  other systems with a panel open.
- **Re-points on click** — clicking another system re-targets the drawer in place (the URL is the single
  source of truth); content swaps with no open/close churn, and the map recentres so the selection clears
  the drawer. The drawer shell itself persists across the switch (no remount, no re-animation), and the
  system panel's open sub-tab carries over onto the newly selected system where it still applies
  (Astrography always; an economy tab only if the target is developed) — panning between systems doesn't
  bounce you back to Overview.
- **Close = X / Escape → map** (`backPath` defaults to `/`).
- The header is pinned; an optional `subHeader` slot carries the tab strip; the body scrolls internally
  with Foundry-themed custom scrollbars (`scrollbar-gutter: stable`).

Navigation (Events / Factions / Diplomacy), game speed + tick, and Save / Exit live in the top bar —
there is no separate sidebar, and the top bar's center-left is left roomy for the future treasury strip.

The **right** edge is the Tracker's rail — a flex column holding the Tracker panel above the map
controls dock, with the Tracker's own settings panel opening to its left. See
[tracker.md](../gameplay/tracker.md). The system panel's header action slot carries that surface's
star pin toggle, beside the cadence countdown and "Show on Map".

## Hover surfaces — two tiers

- **Tooltip** (`components/ui/tooltip.tsx`, Radix Tooltip) — one-line legends and term definitions.
  Non-interactive by design: its content is wired as `aria-describedby`, closes on pointer-leave, and
  is not keyboard-reachable. Carries the app-wide dotted-underline affordance on text triggers.
- **`Popover`** (`components/ui/popover.tsx`, Radix **Popover**) — the second, richer tier, for
  content with a table or a control in it. A popover rather than a hover-card specifically so the
  content is keyboard-reachable; hover-cards are mouse-only by design. Opens on hover after a delay,
  on keyboard focus, and on click; survives the cursor travelling from trigger to content; one open
  at a time. Consumers whose trigger click already means something else opt out of click-to-open —
  the Tracker's rows do, because a row click navigates. Consumers whose trigger hover already means
  something else opt out of hover-to-open the same way.

  Scoped to one level. Nested, pinnable deep tooltips and the concept glossary behind them are
  planned, not built; migrating the existing plain tooltips onto `Popover` is deferred with them.

### The keyboard enter/exit convention

Every popover in the game obeys one contract, because triggers come in lists and a popover is
portalled to the end of the document — a popover that takes focus puts every later trigger behind
itself in tab order, and the list stops being walkable.

- **Opening never moves focus.** Hover, click and keyboard focus all leave focus on the trigger.
  Opening a popover and entering it are two separate steps.
- **ArrowDown on the trigger enters the popover**, opening it first if it was closed. Focus lands on
  the popover's first control, or on the popover itself when it holds no control, so its content is
  still reachable by a screen reader. The key is consumed, so the page does not scroll as well — and
  so the map's window-level pan keys, which stand down on a key another handler has spent, do not
  drag the galaxy behind the popover at the same time. The trigger carries `aria-keyshortcuts`, so
  the gesture is announced with the trigger's own name rather than left to be discovered; the
  popover is a dialog and **every consumer names it**, or a keyboard user arrives at something
  announced as bare "dialog".
- **Escape closes the popover and returns focus to the trigger** — the exit, and ArrowDown's
  counterpart.
- **Tab and Shift+Tab cycle within an entered popover**, wrapping at its last and first control
  rather than tabbing out into the empty document behind it. Escape is the way out, not the last
  resort.
- **A popover the pointer opened is keyboard-driven once entered**, so it hands focus back on Escape
  like any other.
- **The pointer leaving never closes a popover the keyboard has entered.** The pointer-leave grace
  period stands down for the rest of that popover's life; Escape is the way out. What counts is the
  ArrowDown, not where focus happens to be — clicking a control inside a popover with the mouse puts
  focus in it too, and that popover still closes when the pointer leaves.
- **Opening the next popover still closes the one before it**, entered or not — the one-at-a-time
  rule outranks the rule above, because two popovers on screen at once is the worse outcome. Focus
  then falls to the document body rather than back to the closed popover's row: returning it there
  would land a `focusin` outside the popover that just opened, which dismisses it on sight. This is
  the one case where a keyboard user is left without a place to Tab on from, and it takes a
  deliberately mixed sequence to reach — enter a popover by keyboard, then hover another row with
  the mouse.

A popover whose content carries another popover's trigger inherits all of this recursively — one
level per ArrowDown, one per Escape — but nesting is not built (see above), and the
one-open-at-a-time registry is what would have to change first: it would close the outer popover as
the inner one opened.

## Vitals grid

`VitalTile` / `VitalGrid` / `GhostVitalTile` (`components/ui/vital-tile.tsx`) are a reusable, N-up
stat-tile grid both Overviews use. Each tile carries an uppercase label + status dot, a large `font-mono`
value, an optional thin meter *or* a `children` body (e.g. a composition sub-bar), and a one-line hint.
Tile hues align with the map's value-mode ramps (stability cyan, development copper) so a value reads the
same colour on the tile as on the map. A dashed `GhostVitalTile` marks slots reserved for future stats
(treasury / control / tax base), proving the grid extends with no redesign.

## System detail — tabs

**Overview · Astrography · Population · Industry · Logistics · Market** (the four economy tabs hide on an
undeveloped system).

- **Overview** — a loud vitals band (**Stability** = `1 − unrest`%; **Development** = % of the system's
  *own* build-out potential + raw points; **Population** = headcount + an unskilled/technician/engineer
  composition sub-bar; **Construction** = open-project count, linking to Industry; **Provisioned** =
  necessity-weighted delivery this cycle, its meter carrying a dashed tick at the population's
  remembered level), then, on a controlled-but-undeveloped player system, the colonisation founding
  entry (establish verb + preview, forming, or the disabled verb with its blocking reason); then a
  quiet 2-up context strip (faction · government · danger · astrography) and an events banner.
- **Population** — three blocks, top to bottom (who lives here, whether they are angry, then why):
  **Population** (residents, capacity, an occupancy bar with an overshoot segment past the capacity
  rule, a crowding chip, and a housed/over-capacity/capacity key); **Stability** (stability chip and
  headline with which way it is moving, then a track whose fill is stability *now*, a dashed rule
  where it is *heading* — the settled value the accumulator is relaxing toward, so a calm world with
  collapsing causes reads as one — and a red rule at the strike line, with a Now/Heading-for/Strike
  key; then a `ContributorBars` breakdown — goods shortfall, tax pressure, crowding — on the raw
  contributor scale, carrying no per-bar marker because the causes sum and the strike line governs
  only the total. Every number is converted from unrest to stability in one place,
  `components/system/stability-view.ts`. Before its first economy cycle a system withholds the goods
  cause, so the heading-to rule and the direction word are omitted and the block says its causes are
  incomplete rather than letting the missing bar read as calm); **Provisioned** (band chip, the percentage, a band
  track carrying a solid rule at today's level and a dashed rule at the remembered level with a
  Now/Used-to key, then the **needs ledger** directly beneath as its per-good decomposition: one row
  per consumed good, severity glyph ✓/⚠/▼ · % met · want · delivered, pressure-sorted with met needs
  collapsed behind an expandable row; each row's tooltip carries the want/delivered/pressure figures
  and the base / technician / engineer tier breakdown). Want is the unfloored civilian consumption
  rate (the `MIN_DEMAND` pricing floor stays engine-side, unrendered). A `popCap ≤ 0` system with
  residents or standing unrest still renders all three blocks — collapsed housing strands a
  population rather than un-rendering it; only a system with neither residents nor unrest reads as
  the Uninhabited empty state.
- **Industry** — the deposit/space breakdown as compact tables: a per-deposit row (health glyph ·
  resource · `worked/slots` · yield · output, multi-type deposits carrying per-type sub-rows under a
  shared slot pool) and a general-land magnitude bar + a buildings table grouped **Housing · Academies ·
  Specialisation · Production · Support** with exception-only problem sub-rows (input throttles and
  pop shortages; the full per-input list lives in the building tooltip), plus the skill-tiered Labour
  card and a pop-pressure chip on the health strip naming the top unmet needs. Health reads
  **stable / idle / contracting / collapsing**, grounded on the infrastructure-decay engine's
  exact triggers (contracting = a whole idle level `floor(built − used) ≥ 1` for a reason decay can
  act on; idle = the same whole-level gap, but for want of a recipe input, a cause decay can't see and
  so will never shed on its own; collapsing = the unrest teardown), so a healthy system reads stable.
  On the player's own systems, in-flight builds render as
  ghost rows in place with a quick-add `+` per row and a **New industry** dialog; see
  [player-seat.md](../gameplay/player-seat.md).
- **Astrography / Logistics / Market** — the physical substrate, the imports/exports + production/
  consumption dashboard, and the read-only market inspection surface.

## Faction detail — tabs

**Overview · Diplomacy · Territory** — the Victoria-3 country-panel model: the same lens for every
faction, with diplomacy as one tab.

- **Overview** — `FactionCard` identity + the shared vitals grid rolled up over the faction's systems
  (Territory · Population · Stability · Development) + compacted government/doctrine (homeworld + flavour)
  + the faction construction command card (pool composition, systems-building and colonies-forming link
  lists, and — player faction only — the automation switch pair).
- **Diplomacy** — active alliances, the relation-score stance across every other faction, and recent
  diplomatic events.
- **Territory** — the full owned-system list (gateways first), each linking to its system.

## Faction / map aggregation

Faction- and region-level roll-ups — the Overview vitals *and* the map's zoomed-out numbers — are
**quantity-aware**, so a faction spreading into new systems never *looks* like it is declining when it is
only spreading thin. **Extensive** magnitudes (population, development points) **sum**; **intensive**
stability (`1 − unrest`) is a **population-weighted mean** so a populous core dominates and a tiny outpost
can't drag the number down. The faction Overview reads a tick-dynamic `getFactionVitals` service; the map
computes the same via `number-aggregation`; both share one `weightedMean` (`lib/utils/math`) so the
stability figures can't drift. Systems with no value (undeveloped) are skipped, never counted as a
dragging zero.
