# UI Overhaul · WS2 — Map Modes

> **Status:** **P1 shipped** — Migration mode + the population two-pole red→green ramp; the map's price + event
> **pills/overlays removed**. Current reality lives in the map spec ([map-rendering.md](../active/engineering/map-rendering.md)).
> **The Price mode was built in P1 then CUT as premature** (see the Price section + decisions log). **P2 (flow-viz)
> remains planned** — this doc stays in `docs/planned/` until P2 ships. Part of the map/system-detail overhaul
> ([ui-overhaul.md](./ui-overhaul.md)).

## Headline

WS2 adds two **colour-first value modes** — **Migration Attractiveness** and **Price** — and **removes the glyph
pills** (price, events) that don't survive this game's zoomed-out viewing distance. It follows the Paradox model
the map is already converging on: **colour carries the read on the map, richness lives in the hover tooltip, and
printed on-map numbers stay reserved for the magnitude modes** (population, development) where a count is the point
and sums honestly. Both new modes reuse WS1's shipped value-choropleth and its red→green ramp — no new visual
language — so P1 is a framework-native extension.

The genuinely hard part — **flow visualisation** (migration movement arrows + the logistics rethink) — is split
into **P2**, a dedicated later design pass with its own prototype, because directed flow arcs fight map density and
that craft is worth doing carefully rather than rushing.

## Guiding principles

- **Modes over overlays.** EU5 leans on *many* mutually-exclusive map modes; overlays are expensive — a new
  overlay must coexist legibly with *every* mode's visuals (cell colours, faction borders, travel lanes) and adds
  screen density. So a new *per-cell read* becomes a mode; additive directed arcs are the exception, reserved for
  P2 and given their own dedicated stage rather than layered across all modes.
- **Colour-first; numbers are earned.** A printed cell number pays for its clutter only when it has a
  player-meaningful unit *and* aggregates cleanly. Population and development qualify (magnitudes — the count is the
  point, sums honestly) and already print numbers (WS1). Attractiveness and price do not (index / quality reads),
  so they are **colour-only heatmaps**; their precise values live in **hover**. This matches EU5/Vic3, which put
  the detail in rich tooltips and reserve on-map numbers for population / control.
- **Pills don't scale to this zoom.** A small per-glyph pill is unreadable at the zoom levels this game lives at.
  Retire them; their data moves onto modes (colour) and hover (precise value).

## P1 — Value modes (build now)

Both modes slot into the existing shared `ValueChoroplethLayer` and derive their legend from the single
`value-ramp` source, exactly as the WS1 value modes do. The `MapMode` union and its predicate helpers
(`isValueMapMode`, `isFactionInteractiveMode`, `MAP_MODES` order) gain the two new members.

### Migration Attractiveness mode

- **Data — already computed, no processor change.** Reuse `migrationAttractiveness(node, weights)`
  (`lib/engine/migration.ts`): a per-system weighted sum of contentment (`1 − unrest`), relative headroom, and the
  jobs gradient. Its inputs (unrest, population, popCap, labourDemand) are all already persisted, so exposing it
  needs **only a read service + route + hook** (no tick/processor change). It is the cheapest possible mode.
- **Choropleth.** A per-system **intensive** value → the 4th value mode in `ValueChoroplethLayer`. Ramp is
  **red → green, bad → good** (same heat family as population): repulsive worlds (full / high-unrest / no jobs)
  read red, attractive worlds (room + jobs + calm) read green.
- **Colour-only.** No printed cell number — attractiveness is an abstract relative index with no natural
  player-facing unit. The contentment / headroom / jobs breakdown lives in **hover**.
- **Faction-scopable + pop-weighted**, consistent with the other intensive value mode (stability): zoom-out
  aggregation is a **population-weighted mean** (`weightedMean`), and faction focus (`/factions/[id]`)
  re-normalises to that faction's worlds. This is *semantically correct*, not just reused plumbing — migration
  flows only along intra-faction edges, so "attraction relative to your market" **is** the faction scope (the same
  scoping Vic3's attraction mode uses when it shows only your market).

### Price mode — ❌ CUT in P1 (premature)

> Built in P1, then removed. The buy/sell deal-quality framing is a **trader hangover** — the player isn't a hauler
> in the current grand-strategy form, so "where do I buy low / sell high" has no consuming mechanic. The surviving
> value (scarcity/surplus, or a faction-aggregate "who has good X") needs a **faction-trading mechanic that doesn't
> exist yet** — building the viz first is building the wrong thing. The pre-existing price **pill + `priceHeatmap`
> overlay were removed too**; market data stays reachable on the per-system **Market panel**. The design below is
> **kept for a future revisit** (reframe around scarcity/surplus, drop buy/sell, and decide per-system vs
> faction-aggregate once the mechanic lands).

- **Data — already client-side.** `useMarketComparison(goodId)` → `MarketComparisonEntry[]` (per-system
  `currentPrice` / `basePrice` for the picked good); `lib/utils/price-ramp.ts` maps that to deal-quality. No new
  service required.
- **Promote overlay → first-class mode.** Cell fill = **deal quality on red → green, bad → good** for the picked
  good and buy/sell perspective (good deal / cheap-to-buy green ↔ bad deal / expensive red). The good-picker +
  buy/sell `SegmentedControl` (today's `MapPricePanel`) **reattach to the mode** — shown when price mode is active,
  gated on the mode rather than the removed overlay. Pick a sensible **default good** so the mode isn't blank on
  entry.
- **Colour-only on the map; delta % in hover.** Per-system the delta % is genuinely useful, but the *aggregate* is
  semantically vague ("roughly where prices are good"), so it is **not** printed-and-rolled-up in cells — it lives
  in hover.
- **A new *kind* of value mode.** Unlike the magnitude modes, price uses an **absolute diverging** deal-quality
  ramp (not the relative-to-scope-max ramp) and is **good-parameterised**, so it does **not** faction-rescale (deal
  quality is absolute). `ValueChoroplethLayer` is parameterised by (value map, reference map, mode); price adds a
  diverging-ramp variant and opts out of scope re-normalisation. `RESCALES_TO_SCOPE` excludes it.

### Ramp & absence semantics (all value modes)

Unifies the value-mode colour language and makes *absence* honest:

- **Two distinct blacks.** (1) **Absent → black** — a cell not in the mode's value map draws `ABSENT_COLOR`
  ("no such activity exists here"). (2) **Literal 0 → black** (`RESERVES_ABSENT_ZERO`) — a *present* system whose
  value is genuinely 0.
- **Migration + price are developed-gated.** Their value maps include **only `developed` systems** (mirroring how
  stability already gates on `developed`). An undeveloped system has **no migration and no market at all**, so it
  draws **black (absent)** — never a red "low", which would falsely imply migration/trade is possible but poor.
  This is the honest read.
- **No literal-0 black for the new modes.** A *developed* system always has a real attractiveness and a real market
  price, so `RESERVES_ABSENT_ZERO` is **false** for both — every developed system rides the red→green ramp; black
  means only "undeveloped/absent" (same shape as stability, whose 0 = max unrest rides the red floor).
- **All quality ramps are two-pole red → green (no amber).** Migration and price run red (bad) → green (good).
  **Population is simplified to the same red → green** (its amber midpoint dropped) for one consistent quality
  language, but **keeps its literal-0 = black** (0 people = nothing there). Development is unchanged. The pure
  red→green midpoint interpolation is a **calibration knob** — if the mid reads muddy on the real map, the
  interpolation path is tunable.

### Pill + overlay removal

- **Remove the price pill** (`redrawPricePill` in `objects/system-object.ts`) and the **`priceHeatmap` overlay**
  (its entry in `use-map-overlays`, `map-session`, `MapOverlayControls`, and the overlay-gating of `MapPricePanel`
  in `star-map.tsx`). Price is mode-only now.
- **Remove the event pills** and the **`events` overlay** (map display only). The Events panel/nav and the
  underlying event data stay — only the map-clutter representation goes. **Events-as-mode + a rich event tooltip
  are deferred to the events rework** (a reworked events system is landing; building an events mode now would be
  thrown away).
- After P1, **`logistics` is the only remaining overlay** — which teed up P2.

### Hover — deferred (not P1)

The map has **no hover→data channel today** — hover is purely visual (a Voronoi highlight + glyph scale; no DOM
readout, no `onHover` back to React). So a "minimal" price/attraction hover is actually **net-new infrastructure**,
not a tweak. It is therefore **deferred wholesale** to the bookmarked rich-tooltip follow-up. Removing the price
pill loses no precision in the meantime: exact prices remain reachable via the **price comparison table** (the
"Show all prices" panel, kept and reattached to the price mode) and any system's full detail via **click → the
docked detail panel**. Colour carries the at-a-glance read; precise numbers live one click away.

## P2 — Flow visualisation (deferred; dedicated design + prototype)

The hard, novel visual craft — kept out of P1 so P1 can ship, and given its own design pass + HTML prototype
because directed arcs fight map density (the exact problem the logistics overlay hit).

- **Migration movement arrows, built *inside* the Migration mode.** Not a cross-mode overlay — the EU4 Trade-map
  precedent: flow arrows live in a *dedicated mode* that quiets its own base (the attraction fill drops to a
  subdued desaturated layer) so the arrows own the foreground and never have to coexist with every other mode's
  visuals. Rendering reuses WS1/logistics' solved arc pattern (travelling particles + destination arrowhead, **no
  static crossing line** — the anti-spaghetti fix already landed for logistics).
- **New per-edge migration flow log.** The migration processor already computes per-edge direction + magnitude
  internally but **discards it** (only per-system population deltas survive, folded into `population`). P2 persists
  it as a windowed log — a **sibling of `WorldFlowEvent`** (`flowEvents`) — from which arrows render directly and
  per-system **net** numbers fall out as a free aggregation if wanted. Note the process is a **bursty monthly
  pulse** (sharded), so the window must span enough ticks not to flicker.
- **Logistics settled holistically here.** It is the last remaining overlay and the same flow-viz problem; the
  choices (keep as overlay / rework the rendering / fold into an "economic lens") are decided in this pass, not
  piecemeal.

## Bookmarked (not WS2)

- **Richer EU5-style system-hover tooltips across all modes** — the whole hover→data channel is net-new (none
  exists today), so it is a cross-cutting follow-up, not P1.
- **Events as a map mode + rich event tooltip** — rides the upcoming events rework, not WS2.
- **Realized-flow *numbers*** (net migration per cell) — derivable for free once P2's per-edge log exists;
  surfaced only if the arrows read leaves a gap.

## Decisions log

- **Price map mode CUT as premature (2026-07-15)** — supersedes the "Price: mode, not overlay" decision below. Built
  in P1, then removed along with the pre-existing price pill + `priceHeatmap` overlay. Reason: the buy/sell
  deal-quality framing is a trader hangover with no consuming player mechanic in the current grand-strategy form;
  the useful reframe (scarcity/surplus, or faction-aggregate "who has good X") needs a faction-trading mechanic
  first. Migration mode + the population red→green ramp shipped; market data stays on the per-system Market panel.
- **Migration mode = the attractiveness heatmap (the pull), not realized flow** — matches Vic3/EU5, where
  attraction *is* the migration map mode and actual movement is a separate surface.
- Both new modes: **colour-first, red → green bad → good; no printed cell numbers** (reserved for the pop/dev
  magnitude modes).
- **Population ramp simplified to two-pole red → green** (amber dropped), keeping literal-0 = black — one
  consistent quality language across pop/migration/price. (Updates WS1's shipped red→amber→green.) Development
  unchanged.
- **Migration + price are developed-gated: undeveloped = black (absent), never a misleading red "low".** No
  literal-0 black for the new modes (a developed system always has a real value) — `RESERVES_ABSENT_ZERO` false
  for both.
- **Price: mode, not overlay**; the pill is removed; delta % moves to hover; colour-only on the map; absolute
  diverging ramp, no faction rescale.
- **Event pills removed for cleanliness**; events-as-mode deferred to the events rework.
- **P1 skips the HTML prototype** — it reuses the shipped `ValueChoroplethLayer` + red→green ramp (no novel
  visual), and a static mock couldn't faithfully reproduce the Pixi read anyway. **P2 flow-viz keeps its
  prototype** (genuinely new visual craft — density is the hard part).
- **Migration arrows deferred to P2**, built in-mode (EU4 model), needing the new per-edge flow log.

## Open questions (resolve at P1 build / P2 design)

- **Mode label** — "Migration" vs "Attraction" for the attractiveness mode's toggle name.
- **Price default good** on mode entry.
- **P2** — arrow density + colour vs logistics (they share lanes; distinct hues + rarely-both-on), window width
  for the bursty monthly pulse, and logistics' final fate.

## Sequence

P1 (value modes: attractiveness + price, pills out) builds now, subagent-driven, on a phase branch off
`feat/economy-rework-base`. P2 (flow-viz: migration arrows + logistics) is a later dedicated design pass +
prototype + build. Doc lifecycle (promote to `docs/active/`, mark shipped in `docs/SPEC.md` + `ui-overhaul.md`,
delete build plans) runs when WS2 ships.
