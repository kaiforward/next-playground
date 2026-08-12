# Tracker — build plan

## Spec

`docs/planned/tracker.md`. No `/spec-review`: no cross-mechanic surface — a read path, one
player-state field, and one new UI primitive. No processor reads anything this feature writes.

**Correction carried from the spec.** The spec calls the funded front "a new read". The *computation*
already exists: `computeFactionConstruction` runs `nextCycleGains(projects, pool, cap, capFor)`
(`lib/engine/construction-readout.ts:160-173`, `:321`) and discards the per-project array. Task 2 is
therefore shaping existing output, not adding a forecast.

---

## Build plan

### Task 1 — Pinned systems persist on the player seat

Files:
- `lib/world/types.ts` — `WorldPlayer` (existing, `:41-46`)
- `lib/world/gen.ts` — player seed (existing, `:219-234`)
- `lib/world/save.ts` — `SAVE_FORMAT_VERSION` (existing, `:29`)
- `lib/services/player-pins.ts` **(new)**
- `lib/schemas/player-pins.ts` **(new)**
- `app/api/game/player/pins/route.ts` **(new)**
- `lib/types/api.ts` — response type (existing)
- `lib/hooks/use-player-pins.ts` **(new)**
- `lib/query/keys.ts` — pin/tracker key (existing)

Interface:
- `WorldPlayer.pinnedSystemIds: string[]` — insertion-ordered, no duplicates, no cap.
- `setSystemPin(input: { systemId: string; pinned: boolean }): { ok: true; data: string[] } | { ok: false; error: string }` — returns the whole list.
- `pinSchema` (Zod): `{ systemId: string; pinned: boolean }`.
- `PinsResponse = ApiResponse<string[]>`; `POST /api/game/player/pins`.
- `useSetSystemPin()` — mutation invalidating the tracker key.
- `SAVE_FORMAT_VERSION` 12 → 13.

Proves:
- Pinning a system that is already pinned leaves the list unchanged rather than adding a second entry.
- Unpinning a system that was never pinned succeeds as a no-op instead of erroring.
- A world with no player seat rejects the write and returns the discriminated error, rather than throwing past the service boundary.
- Pins survive a `serializeWorld` → `deserializeWorld` round trip in insertion order.
- A save written at the previous format version fails to load with the version error, rather than loading a world whose `pinnedSystemIds` is absent.
- The schema rejects a body with a missing or non-boolean `pinned`, so a malformed request cannot clear the list.

Consumes: nothing.

> **Sibling walk.** `automation` is the nearest existing `WorldPlayer` member; its file set is
> `world/types.ts`, `world/gen.ts`, `types/api.ts`, a schema, a service, a route, a hook, plus
> `lib/world/tick.ts` and `lib/tick/processors/directed-build.ts`. **The two tick files are
> deliberately absent here**: automation is read by a processor and pins are not — nothing in the tick
> loop, no adapter, and no processor ever reads `pinnedSystemIds`. Stale pins are filtered on read
> (Task 3), so abandonment needs no tick write either.

---

### Task 2 — The funded front on the faction construction readout

Files:
- `lib/engine/construction-readout.ts` — `computeFactionConstruction` (existing, `:304-322`)
- `lib/types/api.ts` — `FactionConstructionData` (existing, `:368-381`)
- `lib/services/construction.ts` — `getFactionConstruction` (existing, `:141`)

Interface:
- `FactionConstructionReadout.fundedFront: Array<{ projectId: string; systemId: string; systemName: string; label: string; progress: number; etaCycles: number | null }>` — queue order, one entry per project whose next-cycle gain is positive. `label` names the building type and level count, or the colony.
- `FactionConstructionReadout.waitingCount: number` — open projects not on the front.
- Both surface unchanged through `FactionConstructionData`.

Proves:
- A project whose next-cycle gain is zero is absent from the front and counted in `waitingCount`.
- A colony whose materials the treasury cannot buy this cycle (its `capFor` ceiling is 0) is absent from the front, not listed at zero progress.
- `fundedFront.length + waitingCount` equals the faction's open-project count for every queue shape, including one where the pool lands a project outright.
- An empty queue yields an empty front and a zero count, never `undefined` reaching the response type.
- The front preserves queue order rather than re-sorting by progress, so it reads the same way as the funding it describes.
- A faction whose pool is zero produces an empty front while `waitingCount` still counts every open project.

Consumes: nothing.

---

### Task 3 — The Tracker read service, route and hook

Files:
- `lib/services/tracker.ts` **(new)**
- `lib/types/api.ts` — tracker data types (existing)
- `app/api/game/player/tracker/route.ts` **(new)**
- `lib/hooks/use-tracker.ts` **(new)**
- `lib/query/keys.ts` (existing)
- `lib/hooks/use-tick-invalidation.ts` (existing, `:42`)

Interface:
- `getTrackerData(): TrackerData` — `{ pinned: TrackerPinnedRow[]; building: TrackerBuildRow[]; waitingCount: number; colonising: TrackerColonyRow[] }`.
- `TrackerPinnedRow: { systemId; systemName; population: number; populationPct: number; stabilityPct: number; provisionPct: number; developmentPct: number }` — the card's table and the row's two figures from one row.
- `TrackerBuildRow` / `TrackerColonyRow`: `{ systemId; systemName; label; progress; etaCycles }`.
- `TrackerResponse = ApiResponse<TrackerData>`; `GET /api/game/player/tracker`; `queryKeys.tracker`.
- `useTracker()` — `useSuspenseQuery`, invalidated on the economy cycle alongside `factionConstructionAll`.

Proves:
- A pinned system that has been abandoned back to unclaimed is filtered out of `pinned` rather than returned with zeroed vitals.
- A pinned system belonging to another faction is still returned — pinning is a bookmark, not an ownership claim.
- A world with no player seat returns empty sections rather than throwing, so the panel degrades instead of blanking the shell.
- `building` matches the funded front for the player's faction only, never another faction's queue.
- The pinned rows preserve `pinnedSystemIds` order after stale entries are filtered, rather than re-sorting.
- The response carries no `Cache-Control` beyond `private, no-cache`, so a New game cannot serve stale system ids.

Consumes: Task 1 (`pinnedSystemIds`), Task 2 (`fundedFront`, `waitingCount`).

---

### Task 4 — `RichCard`, the popover-based hover card

Files:
- `components/ui/rich-card.tsx` **(new)**
- `components/ui/__tests__/rich-card.test.tsx` **(new)**

`@radix-ui/react-popover` is **already a dependency** (`package.json:21`) and currently has no
importer anywhere in the codebase — `RichCard` is its first consumer. No dependency change, and
`package.json` is not touched.

Interface:
- `RichCard` — composition mirroring the existing tooltip wrapper: root, trigger (`asChild`), content. Props on the root: `openDelay`, `side`, `align`.
- Opens on pointer-enter after `openDelay`, on click, and on keyboard focus of the trigger.
- Does **not** move focus into the content on a hover open; does move focus on a click or keyboard open.
- Stays open while the pointer travels from trigger to content.
- Content is dismissible by Escape and by pointer-leave, and its controls are focusable once open.

Proves:
- Opening by keyboard puts focus inside the content, and opening by hover leaves focus on the trigger — the two paths differ.
- A button inside the content is reachable and activatable by keyboard, which the existing tooltip primitive cannot do.
- Escape closes the card and returns focus to the trigger rather than to the document body.
- The card does not close while the pointer is between trigger and content, so its controls are reachable by mouse at all.
- Two cards cannot be open at once — opening a second closes the first.
- With no `openDelay` elapsed, a pointer passing across a trigger does not open the card.

Consumes: nothing.

> Scope is one level. Nesting, pinning, glossary links and migrating the existing tooltips are the
> deep-tooltips roadmap row's, not this task's.

---

### Task 5 — The Tracker panel

Files:
- `components/tracker/tracker-panel.tsx` **(new)**
- `components/tracker/tracker-row.tsx` **(new)**
- `components/tracker/__tests__/tracker-panel.test.tsx` **(new)**
- `components/game-shell.tsx` — mount beside the map controls dock (existing, `:31-40`)
- `components/map/map-controls-dock.tsx` — share the right-edge container (existing, `:27`)

Interface:
- `TrackerPanel` — no props; reads `useTracker()` inside a `QueryBoundary`.
- `TrackerRow` — `{ systemId; name; figures: TrackerFigure[]; progress?: number; tone?: "build" | "colony"; onActivate: () => void; card: React.ReactNode }`.
- One line per row. `progress` renders a 2px bar flush to the row's bottom edge, over a faint track; `tone` selects copper or amber.
- Row activation routes to the system path with the existing focus query (`?focus=x,y&loc=N`) and the destination tab: Overview for pinned and colony rows, Industry for build rows.
- The right-edge container holds the panel above the dock; the panel scrolls internally.

Proves:
- Activating a build row routes to the Industry tab and a pinned row to Overview, so the two destinations are not wired to the same path.
- Each activation increments the locate counter, so locating the same system twice still re-centres the map.
- A section with no rows renders its empty state rather than a bare heading with nothing beneath it.
- The waiting count renders when projects are behind the front and is absent when none are, rather than rendering "0 more".
- A row whose progress is zero still renders the track, so a stalled project is visibly present rather than blank.
- A pinned row exposes its population and stability in its accessible name from the rendered DOM, so the assertion cannot pass once the figures stop rendering.

Consumes: Task 3 (`useTracker`), Task 4 (`RichCard`).

---

### Task 6 — The star toggle in the system panel header

Files:
- `app/(game)/@panel/system/layout.tsx` — `headerAction` (existing, `:68-82`)
- `components/system/pin-toggle.tsx` **(new)**
- `components/system/__tests__/pin-toggle.test.tsx` **(new)**
- `components/ui/icons.tsx` — existing file, **new** re-export; it is a single line re-exporting
  lucide icons (`:1`) and carries no star today, so the star is added there rather than imported
  from lucide at the call site.

Interface:
- `PinToggle` — `{ systemId: string }`. A `Button` in the header's action slot beside the cadence countdown and "Show on Map".
- Reads pinned state from `useTracker()`; writes through `useSetSystemPin()`.
- Accessible name states the action and the subject, and its pressed state is exposed.

Proves:
- The control's pressed state reflects the current pin, so a pinned system's header does not render as unpinned.
- Activating it twice returns the system to its starting state rather than pinning twice.
- It uses a star, not the map-pin glyph already used by "Show on Map" in the same header.
- It is operable by keyboard, since it is the only unpin route that does not require a pointer.
- On a world with no player seat it is absent rather than rendered and erroring on activation.

Consumes: Task 1 (`useSetSystemPin`), Task 3 (`useTracker`).

---

### Task 7 — Tracker section settings

Files:
- `components/tracker/tracker-settings.tsx` **(new)**
- `components/tracker/tracker-panel.tsx` (from Task 5)
- `lib/hooks/use-tracker-sections.ts` **(new)**

Interface:
- `useTrackerSections()` — `{ sections: Record<"pinned" | "building" | "colonising", boolean>; setSection(key, on): void }`, persisted client-side (`sessionStorage`, narrowed at the boundary). Not world state: a view preference, not part of the save.
- `TrackerSettings` — a checkbox per section in a `RichCard` opened from the panel header.

Proves:
- Hiding a section removes its rows and its heading, not just the rows.
- Hiding every section leaves the panel's header present so the settings remain reachable.
- A malformed stored value falls back to all-sections-on rather than throwing at the boundary.
- The setting survives a route change within the game shell.

Consumes: Task 5.

---

## Verification

**This is not a game-logic change** — no processor reads anything it writes, and no sim metric moves.
Quoting a `npm run simulate` run here would be theatre; the gate that applies is the one below.
(Task 1 does bump the save format, which `npm run simulate` does not exercise.)

- `npx next build --webpack` — the build gate.
- `npx vitest run` — unit and component suites, including the new `.test.tsx` files in jsdom.
- **Manual browser smoke, by hand:** pin and unpin from the system header; confirm the Tracker
  updates without a reload; click one row of each of the three kinds and confirm the map flies and the
  right tab opens; hover a pinned row and confirm the card is reachable with the mouse and operable by
  keyboard; save, reload from the start screen, and confirm pins survive.
- **Save round trip** is the one behaviour no automated gate covers end to end: write a save, load it,
  confirm the pins return. Task 1's tests cover serialize/deserialize; the manual step covers the file.

## Doc fold

On the branch, before the final review:

- Promote `docs/planned/tracker.md` → `docs/active/gameplay/tracker.md`.
- Add a **Tracker** entry to `docs/SPEC.md`'s Active Systems, and a line to the System Interaction Map
  noting it is a read surface with no processor edge.
- `docs/active/engineering/single-player-runtime.md` says `world.player` carries "the controlled
  faction and its per-domain automation switches" — now also the pinned set.
- `docs/active/design-system/detail-panels.md` gains the `RichCard` tier beside the existing tooltip,
  and the system panel's header action gains the star.
- Delete `docs/build-plans/tracker.md` on the PR that finishes this work.
- Delete roadmap row 1; leave the alert-bar row and the deep-tooltips row standing.

## Not covered

- **Nesting, pinning and glossary links in `RichCard`, and migrating the existing tooltips onto it** —
  **booked**, roadmap Unqueued/UI, "[L] Paradox-style nested/pinnable deep tooltips", which already
  names the primitive as landing here and the rest as staying there.
- **The alert bar and everything condition-shaped** (overcrowding, unmet demand, strikes, famine,
  blocked builds) — **booked**, roadmap queue row 2.
- **Pinning anything but systems** (formations, markets, factions) — **dropped**: the game has no
  formations, and a market or faction pin has no named read behind it. Re-propose with a use.
- **Ordering pinned systems by anything** — **dropped**: the Tracker does not rank, by design; ranking
  is row 2's problem and is solved there by authored category tiers.
- **Moving the map-mode controls to a centre-bottom strip** — **dropped** from this plan: the spec
  states nothing here depends on it, and the shared container works without it. It is a redesign with
  no owner, not a deferred task.
- **A general accessibility audit of the system panel** — **booked at a gate**: Task 4's merge
  condition is that the card's keyboard paths pass, which is the only accessibility claim this feature
  rests on. The wider panel audit was raised at the design pass and has no row; if the manual smoke
  finds the panel unreachable by keyboard, book it then rather than expanding this plan.
