# Player Seat — Phase 3

Transient build-plan for the **player seat** — the slice of the grand-strategy pivot that puts a
human in a faction's chair. This doc is the design source of truth while the work is in flight; on
ship each slice promotes its functional spec into `docs/active/` (SPEC.md + faction-system.md / a new
player doc) and this file is deleted per the doc lifecycle.

Roadmap context: [grand-strategy-vision.md](../planned/grand-strategy-vision.md) §8, Phase 3. The core
inversion (vision §2 pillar 4): the autonomic agency layer — directed logistics, autonomic build,
colonisation — that already drives every AI faction becomes the **player's control surface**. The
player seat is a *human seat* on machinery that already exists; it is not new AI.

> **Time language.** The tick/cycle scale is not yet decided. This doc says **ticks**, **cycles**, and
> **pulses** — never "months" or "days". Existing code that still says "month" is left alone here and
> cleaned up opportunistically only in files a slice already touches.

---

## Phase 3 decomposition

Phase 3 is multi-subsystem. It ships as four sequential sub-projects, each its own spec → plan → build,
each independently playable. Build order:

1. **The Seat** *(this slice)* — author a faction on New Game; a `world.player` marks which faction is
   yours; the existing read-only UI reframes around you (auto-focus your homeworld, a "You" tag). **No
   new verbs** — your faction runs on the autonomic brain, identical to the AI. The one unavoidable
   structural change (who is "the player", threaded through save/load) lands in the smallest possible
   slice, de-risking everything after it.
2. **Direct control + automation toggles** — the inversion made playable. Per-domain automation
   switches plus the first manual verbs (place/expand a build, pick a colony target) behind them.
3. **The purse** — faction money: tax from your economy, a treasury, budget bands that fund
   construction/logistics (replacing today's free population-funded pool). Comes after verbs, because
   budgets only matter once there is something to fund by hand.
4. **Alert feed** — the faction situation log, once there is enough happening to need telling where to
   look.

World-gen (small cores, open galaxy) and colonisation already shipped, so they are off the Phase 3
list.

---

## Slice 1 — The Seat

**Headline.** Clicking **New Game** opens a setup screen where you author a faction — name, government,
doctrine — plus galaxy size and an optional seed. World-gen seeds your faction as one more major
alongside the eight hand-crafted AI powers; you enter the galaxy already sitting in it, the camera
centred on your homeworld. Nothing else changes: your faction runs on the same autonomic brain as every
rival. This slice establishes *identity and entry* — the verbs come in Slice 2.

### 1. The setup screen (`/start/new`)

`/start`'s inline New-Game form is replaced by a button routing to a dedicated `/start/new` page (a
**Back** link returns to `/start`). The form collects exactly:

| Field | Control | Validation |
|---|---|---|
| Faction name | `TextInput` | required; trimmed; length-bounded |
| Government | `SelectInput` | one of the 8 `GovernmentType` values |
| Doctrine | `SelectInput` | one of the 5 `Doctrine` values |
| Systems | `NumberInput` | 50–20,000 (unchanged) |
| Seed (optional) | `TextInput` | optional integer (unchanged) |

Government/doctrine options come from the existing constants (`GOVERNMENT_TYPES`, `DOCTRINES`) so labels
and any descriptive copy stay single-sourced. Submit → `POST /api/game/new` → hard-nav to `/` (fresh
document, fresh TanStack cache — same pattern the current form uses). No color picker, no doctrine/
government modifier tuning — "author your faction" is name + government + doctrine, full stop.

### 2. The player faction in world-gen

`generateWorld` and `generateUniverse` gain an **optional** `playerFaction: { name, government,
doctrine }`. When present, it is injected in `generateFactions` as an **additional major**
(`isMajor: true`), appended to the preset-major block ahead of the procedural minors, then placed by
the same spacing + seed-biased `placeHomeworlds` logic as every other faction. Consequences:

- **Major-quality homeworld, no special bonus.** Your homeworld is spaced from rivals and seed-biased
  toward good substrate exactly like the eight presets — it is not centred, not buffed. Orientation is
  handled by auto-focus (§4), not by placement.
- **Government may duplicate a preset's.** Governments are not unique; picking Federation simply means
  two Federation majors exist. That is fine and expected.
- **Additive, not replacing.** All eight hand-crafted AI majors still exist; you are a ninth entrant.
- **Colour** is auto-assigned via the same distinct-hue path minors use, kept clear of the preset hues.

**Playerless path is unchanged.** The calibration harness (`npm run simulate`) and any headless
`generateWorld` call pass **no** `playerFaction`, so they keep generating a pure-AI galaxy — the economy
tests and health metrics do not move. `world.player` is `null` in that case.

**Determinism.** `(systemCount, seed, playerFaction)` fully determines the world (byte-for-byte through
JSON). Adding a player changes homeworld placement for everyone (one more homeworld participates in the
spacing), so a seed *with* a player is not position-identical to the same seed *without* one — that is
expected and not a regression; the playerless harness path is what stays pinned.

### 3. Player identity in the world

```
world.player: { controlledFactionId: string } | null
```

A new top-level field on `World`. It lives *in* the world object, so it serialises and round-trips
through save/load with everything else. Everything player-specific hangs off the controlled faction;
`world.player` is deliberately thin — for this slice it holds only the faction id. Save-shape change is
acceptable (saves break on world-shape change, pre-1.0).

**Client exposure.** Player identity folds into the **atlas** payload:

```
AtlasData.player: { controlledFactionId: string; homeworldSystemId: string } | null
```

The atlas is already the map's bootstrap payload and is cached `staleTime: Infinity` — the same
per-world, static cadence player identity has. The API resolves `controlledFactionId` → faction →
`homeworldId` so the client gets the homeworld **system** id directly (what auto-focus needs).
`atlas.player` exists specifically to feed auto-focus (§4); the "You" tag (§5) instead reads a
service-resolved `FactionSummary.isPlayer`, so the faction surfaces need no atlas cross-reference.

### 4. Auto-focus the homeworld

No new map machinery. `StarMap` already accepts `initialSelectedSystemId`, which seeds the camera's
initial `centerTarget` on mount (it centres the camera **without** opening the system panel) and the map
stays hidden until that centre settles — so there is no galaxy-view-then-jump flash. The game page,
which already fetches the atlas to render `StarMap`, reads `atlas.player.homeworldSystemId` and passes
it as `initialSelectedSystemId`. Result: entering the game — whether via New Game, Load, or a plain
refresh — lands the camera on your homeworld. When `atlas.player` is `null` (a hypothetically playerless
world in the browser), behaviour is exactly today's fit-to-galaxy view.

### 5. Minimal identity surfacing

A small **"You"** badge marks the controlled faction in the two read surfaces that list/lead with a
faction: the faction list and the faction panel header. Both render through one component
(`FactionCard`), and `FactionDetail extends FactionSummary`, so a single service-resolved
`FactionSummary.isPlayer` (set from `world.player`) lights up both surfaces. That is the whole of the
identity treatment for this slice — no bespoke your-territory map tint, no panels defaulting to you
beyond the camera focus. Those ride with Slice 2's control surface, where they have verbs to attach to.

### 6. Schema / API

- `newGameSchema` (`lib/schemas/game-setup.ts`) gains `name`, `government`, `doctrine` — name
  trimmed/length-bounded, government/doctrine as enums over the constant value sets. Validated at the
  route boundary (the existing pattern).
- `POST /api/game/new` passes the three new fields into `newGame()`, which forwards a `playerFaction`
  into `generateWorld`.
- New/load response shapes are unchanged (they return `meta`); the client focuses home via the atlas,
  so nothing about entry depends on the mutation response carrying the homeworld.

### 7. Cleanup folded into this slice

- **Delete `startingSystemId` end-to-end.** It is a stale bookmark predating the "you author a faction"
  model and nothing consumes it (confirmed: only `WorldMeta`, `gen.ts`, and tests reference it — no UI/
  map code). Remove the `WorldMeta` field, its computation in `gen.ts`, and the engine's
  `startingSystemIndex` field + `selectStartingSystem()` in `universe-gen.ts`, plus their tests and the
  doc mentions (faction-system.md §5, universe.md, single-player-runtime.md).
- **Purge months/days language** in any file this slice already edits (opportunistic only — not a
  repo-wide sweep).
- **Update vision §3 wording**: the seat is an *authored* faction (name/government/doctrine), not a
  *picked* existing one.

### 8. Explicitly out of scope for Slice 1

No player verbs, no money/treasury/budget, no automation toggles, no manual build or colonisation, no
alert feed, no custom map styling. You author a faction, land on your homeworld, and watch your empire
run on the same brain as the AI. Everything actionable is Slice 2+.

---

## Testing

- **World-gen** (`lib/world/__tests__/gen.test.ts`, `lib/engine/__tests__/*`): with a `playerFaction`,
  the world contains a ninth major carrying the authored name/government/doctrine with a placed
  homeworld and `world.player.controlledFactionId` pointing at it; **without** one, generation matches
  today (playerless, `world.player === null`) — the harness path is pinned.
- **Schema**: `newGameSchema` accepts valid government/doctrine and rejects out-of-set values, empty/
  overlong names.
- **Save/load** (`lib/world/__tests__/save.test.ts`): `SAVE_FORMAT_VERSION` bumps 5 → 6 (adding
  `world.player` is a world-shape change); `world.player` survives the serialize/deserialize round-trip,
  and a v5 save is rejected cleanly ("saves break on upgrade", per project convention).
- **`startingSystemId` removal**: the tests that assert on it are removed with the field; nothing else
  references it.
- **Setup form**: renders the government/doctrine selects and validates required fields (component test,
  matching how the current New-Game form is covered).

## Build gate

`npx next build --webpack`, `npx vitest run`, and `npm run simulate` (confirming the playerless economy
metrics are unmoved) before the PR.
