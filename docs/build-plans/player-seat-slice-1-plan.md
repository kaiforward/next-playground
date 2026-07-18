# Player Seat — Slice 1 "The Seat" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player author a faction on New Game and drop into the galaxy sitting in it — camera on their homeworld — with the faction running on the same autonomic brain as every AI rival.

**Architecture:** A thin `world.player = { controlledFactionId } | null` marks which otherwise-normal faction is the human's. World-gen seeds the authored faction as one more major (optional input; the calibration harness stays playerless). Player identity reaches the client two ways: `AtlasData.player` (feeds homeworld auto-focus by reusing `StarMap.initialSelectedSystemId`) and a service-resolved `FactionSummary.isPlayer` (the "You" tag). The stale `startingSystemId` is deleted.

**Tech Stack:** Next.js 16 App Router, TypeScript 5 strict, Zod v4, React Hook Form, TanStack Query v5 (Suspense), Vitest 4.

## Global Constraints

- **No `as` type assertions** except `as const` and inside `lib/types/guards.ts`. Narrow with guards / type-guard refinements, never cast.
- **No `unknown`** outside JSON-boundary narrowing.
- **Discriminated unions / `| null`, never optional-pairs.** `world.player` is `WorldPlayer | null`.
- **Determinism:** no `Date.now`/`Math.random` in engine/world-gen bodies (the one allowed `Math.random` is the default-seed pick already in `newGame()`).
- **World stays JSON-serializable:** `world.player` is a plain object or `null` — no `Map`/`Set`/`undefined`-as-value.
- **Engine/world purity:** no `fs`/`process.env` in `lib/engine`, `lib/world` (except `save-files.ts`), `lib/services`.
- **Commits:** feature branch is `feat/player-seat` (already checked out). One commit per task. Every commit message ends with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Time language:** never introduce "month"/"day" in new code or prose — use tick/cycle/pulse. Do **not** rename existing code fields/constants (`idleMonths`, `MONTH_LENGTH`); only adjust "month" wording in comment/prose lines a task already edits.
- **Build gate before PR:** `npx next build --webpack`, `npx vitest run`, `npm run simulate` (playerless economy metrics unmoved).

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `lib/world/types.ts` | World model | Add `WorldPlayer`, `World.player`; remove `WorldMeta.startingSystemId` |
| `lib/engine/universe-gen.ts` | Universe assembly | Remove `startingSystemIndex` + `selectStartingSystem()`; add `playerFaction?` param + `playerFactionIndex` output |
| `lib/engine/faction-gen.ts` | Faction roster + placement | Add `PlayerFactionInput`, inject player as an additional major |
| `lib/world/gen.ts` | World assembly | Thread `playerFaction`; set `world.player`; drop `startingSystemId` |
| `lib/world/save.ts` | Serialization | Bump `SAVE_FORMAT_VERSION` 5 → 6 |
| `lib/schemas/game-setup.ts` | New-game validation | Add `name`/`governmentType`/`doctrine` |
| `lib/services/game.ts` | New-game service | Build `playerFaction`, pass to `generateWorld` |
| `app/api/game/new/route.ts` | HTTP wrapper | Widen parsed-body type |
| `lib/types/game.ts` | Client types | Add `AtlasData.player` |
| `lib/services/atlas.ts` | Atlas read | Populate `player` |
| `app/(game)/page.tsx` | Map page | Focus homeworld via `atlas.player` |
| `lib/services/factions.ts` | Faction reads | Set `FactionSummary.isPlayer` from `world.player` |
| `components/factions/faction-card.tsx` | Faction card | Render "You" badge when `faction.isPlayer` |
| `app/start/new/page.tsx` | Setup screen | **Create** — faction authoring page |
| `components/start/create-faction-form.tsx` | Setup form | **Create** — name/gov/doctrine/systems/seed |
| `components/start/start-screen.tsx` | Start screen | New Game card → link to `/start/new` |
| `components/start/new-game-form.tsx` | Old inline form | **Delete** (replaced) |

Tests live beside their targets under `__tests__/`. Per project convention there is **no jsdom** — UI wiring (the setup form, the "You" badge JSX) is verified by unit-testing the underlying logic (schema, services, world-gen) plus the manual smoke at the end, not by DOM-render tests.

---

### Task 1: Remove the stale `startingSystemId`

Pure deletion — `startingSystemId`/`startingSystemIndex`/`selectStartingSystem()` are a bookmark nothing consumes (only `WorldMeta`, `gen.ts`, and tests reference them). Doing this first shrinks the surface the player work then edits.

**Files:**
- Modify: `lib/world/types.ts` (remove `startingSystemId` from `WorldMeta`)
- Modify: `lib/world/gen.ts` (remove the `startingSystemId` computation + meta field)
- Modify: `lib/engine/universe-gen.ts` (remove `startingSystemIndex` from `GeneratedUniverse`, its assignment in `generateUniverse`, and the `selectStartingSystem()` function)
- Test: `lib/engine/__tests__/universe-gen.test.ts`, `lib/world/__tests__/gen.test.ts`, `lib/world/__tests__/save.test.ts`, `lib/world/__tests__/store.test.ts`, `lib/services/__tests__/system-cadence.test.ts` (remove `startingSystemId`/`startingSystemIndex`/`selectStartingSystem` references)

**Interfaces:**
- Produces: `GeneratedUniverse` without `startingSystemIndex`; `WorldMeta` without `startingSystemId`.

- [ ] **Step 1: Find every reference**

Run: `git grep -n "startingSystem"`
Expected: matches in `lib/world/types.ts`, `lib/world/gen.ts`, `lib/engine/universe-gen.ts`, and the five test files above (plus doc mentions handled in Task 8).

- [ ] **Step 2: Delete the field from `WorldMeta`**

In `lib/world/types.ts`, remove the `startingSystemId: string;` line from `WorldMeta`:

```ts
export interface WorldMeta {
  seed: number;
  systemCount: number;
  mapSize: number;
  currentTick: number;
}
```

- [ ] **Step 3: Delete the engine computation**

In `lib/engine/universe-gen.ts`: remove `startingSystemIndex: number;` from the `GeneratedUniverse` interface; delete the entire `selectStartingSystem(...)` function; and in `generateUniverse` delete the `const startingSystemIndex = selectStartingSystem(...)` block and the `startingSystemIndex` property from the returned object.

- [ ] **Step 4: Delete the world-gen computation**

In `lib/world/gen.ts`: delete `const startingSystemId = systemIds[universe.startingSystemIndex];` and remove `startingSystemId` from the returned `meta` object.

- [ ] **Step 5: Strip test references**

Remove the `selectStartingSystem` import and its `describe(...)` block from `lib/engine/__tests__/universe-gen.test.ts`, and delete any `startingSystemId`/`startingSystemIndex` assertions from the other four test files. Do not weaken surrounding assertions — only remove the lines that reference the deleted symbols.

- [ ] **Step 6: Verify types + tests**

Run: `npx tsc --noEmit`
Expected: PASS (no dangling references).
Run: `npx vitest run lib/engine/__tests__/universe-gen.test.ts lib/world/__tests__/gen.test.ts lib/world/__tests__/save.test.ts lib/world/__tests__/store.test.ts lib/services/__tests__/system-cadence.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit
# subject: refactor(world-gen): drop the unused startingSystemId bookmark
# (+ required Co-Authored-By trailer)
```

---

### Task 2: `world.player` + author the faction in world-gen

The structural core: a `WorldPlayer` pointer and an optional authored faction injected as an additional major. Placement stays "same as everyone"; the playerless path (harness) is unchanged.

**Files:**
- Modify: `lib/world/types.ts` (add `WorldPlayer`, `World.player`)
- Modify: `lib/engine/faction-gen.ts` (add `PlayerFactionInput`, inject into `generateFactions`)
- Modify: `lib/engine/universe-gen.ts` (thread `playerFaction`, emit `playerFactionIndex`)
- Modify: `lib/world/gen.ts` (thread `playerFaction`, set `world.player`)
- Test: `lib/world/__tests__/gen.test.ts`

**Interfaces:**
- Produces:
  - `interface WorldPlayer { controlledFactionId: string }`
  - `World.player: WorldPlayer | null`
  - `interface PlayerFactionInput { name: string; governmentType: GovernmentType; doctrine: Doctrine }` (exported from `lib/engine/faction-gen.ts`)
  - `FactionGenParams.playerFaction?: PlayerFactionInput`
  - `generateUniverse(params, names, playerFaction?: PlayerFactionInput)` → adds `GeneratedUniverse.playerFactionIndex: number | null`
  - `GenerateWorldOptions.playerFaction?: PlayerFactionInput`

- [ ] **Step 1: Write the failing world-gen test**

Add to `lib/world/__tests__/gen.test.ts`:

```ts
import { generateWorld } from "@/lib/world/gen";

describe("generateWorld — player faction", () => {
  const base = { systemCount: 200, seed: 12345 };
  const authored = {
    name: "Aurelian League",
    governmentType: "technocratic" as const,
    doctrine: "mercantile" as const,
  };

  it("seeds the authored faction as an additional major and points world.player at it", () => {
    const world = generateWorld({ ...base, playerFaction: authored });

    expect(world.player).not.toBeNull();
    const seatId = world.player?.controlledFactionId;
    const player = world.factions.find((f) => f.id === seatId)!;
    expect(player.name).toBe("Aurelian League");
    expect(player.governmentType).toBe("technocratic");
    expect(player.doctrine).toBe("mercantile");
    // Placed like everyone: it owns exactly its homeworld, which is developed.
    const home = world.systems.find((s) => s.id === player.homeworldId)!;
    expect(home.factionId).toBe(player.id);
    expect(home.control).toBe("developed");
  });

  it("is additive — one more faction, with presets + minors unchanged", () => {
    const playerless = generateWorld(base);
    const withPlayer = generateWorld({ ...base, playerFaction: authored });

    expect(withPlayer.factions.length).toBe(playerless.factions.length + 1);
    // The authored faction is the only new identity: every preset major and procedural
    // minor keeps its name and array position (they're generated before the player is
    // spliced in at the major/minor boundary).
    const nonPlayerNames = withPlayer.factions
      .filter((f) => f.id !== withPlayer.player?.controlledFactionId)
      .map((f) => f.name);
    expect(nonPlayerNames).toEqual(playerless.factions.map((f) => f.name));
  });

  it("stays playerless when no faction is authored (the harness path)", () => {
    const world = generateWorld(base);
    expect(world.player).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/world/__tests__/gen.test.ts`
Expected: FAIL (`playerFaction` not accepted; `world.player` undefined).

- [ ] **Step 3: Add the world types**

In `lib/world/types.ts`, add near the Meta section:

```ts
// ── Player ──────────────────────────────────────────────────────

/** The human seat: which faction the player controls. Null in a playerless world (the
 *  calibration harness). Everything else player-specific hangs off the controlled faction. */
export interface WorldPlayer {
  controlledFactionId: string;
}
```

And add to the `World` interface:

```ts
  /** The human player's seat, or null for a playerless (harness-generated) world. */
  player: WorldPlayer | null;
```

- [ ] **Step 4: Inject the player faction in `faction-gen.ts`**

Add the input type and extend `FactionGenParams`:

```ts
/** The human player's authored faction, seeded as an additional major. */
export interface PlayerFactionInput {
  name: string;
  governmentType: GovernmentType;
  doctrine: Doctrine;
}
```
```ts
export interface FactionGenParams {
  minorFactionCount: number;
  mapSize: number;
  /** When present, the human player's authored faction — seeded as an additional major. */
  playerFaction?: PlayerFactionInput;
}
```

In `generateFactions`, after the minors loop and **before** `placeHomeworlds`, insert:

```ts
  // ── Player faction: an additional major, authored on the New-Game screen ──
  // Built AFTER minors so their procedural names/colours match a playerless run (the
  // harness), then spliced in at the major/minor boundary so placement gives it major-tier
  // homeworld priority. Colour is drawn distinct from every faction already placed.
  if (params.playerFaction) {
    const color = makeMinorColor(rng, usedHues);
    usedHues.push(hexToHue(color));
    factions.splice(FACTION_ROSTER.length, 0, {
      index: FACTION_ROSTER.length, // reassigned below
      key: "player",
      name: params.playerFaction.name,
      description: "",
      governmentType: params.playerFaction.governmentType,
      doctrine: params.playerFaction.doctrine,
      color,
      isMajor: true,
      homeworldSystemIndex: -1,
    });
    factions.forEach((f, i) => { f.index = i; });
  }
```

(`placeHomeworlds(systems, factions.length, mapSize)` then places all of them, including the player.)

- [ ] **Step 5: Thread through `universe-gen.ts`**

Add `playerFactionIndex: number | null;` to the `GeneratedUniverse` interface. Change the signature and body:

```ts
export function generateUniverse(
  params: GenParams,
  names: string[],
  playerFaction?: PlayerFactionInput,
): GeneratedUniverse {
  // ...
  const factions = generateFactions(rng, systems, {
    minorFactionCount: params.minorFactionCount,
    mapSize: params.mapSize,
    playerFaction,
  });
  // ...
  const playerFactionIndex = playerFaction
    ? factions.findIndex((f) => f.key === "player")
    : null;

  return {
    regions,
    systems,
    connections,
    factions,
    systemFactionAssignments,
    playerFactionIndex,
  };
}
```

Import `PlayerFactionInput` from `./faction-gen` (alongside the existing faction-gen imports).

- [ ] **Step 6: Thread through `gen.ts` and set `world.player`**

Extend `GenerateWorldOptions`:

```ts
export interface GenerateWorldOptions {
  systemCount: number;
  seed: number;
  playerFaction?: PlayerFactionInput;
}
```

Import `PlayerFactionInput` from `@/lib/engine/faction-gen`. In `generateWorld`, pass it and derive the player:

```ts
  const universe = generateUniverse(params, REGION_NAMES, options.playerFaction);
```
```ts
  const player =
    universe.playerFactionIndex !== null
      ? { controlledFactionId: factionIds[universe.playerFactionIndex] }
      : null;
```

Add `player,` to the returned `World` object (and confirm the `startingSystemId` line is already gone from Task 1).

- [ ] **Step 7: Run the tests**

Run: `npx vitest run lib/world/__tests__/gen.test.ts`
Expected: PASS.

- [ ] **Step 8: Confirm the harness is unmoved**

Run: `npm run simulate`
Expected: completes with economy-health metrics; no crash. (The harness calls `generateWorld` without `playerFaction`, so `world.player` is null and behaviour is identical.)

- [ ] **Step 9: Commit**

```bash
git add -A && git commit
# subject: feat(player-seat): author the player's faction in world-gen
```

---

### Task 3: Bump the save format for `world.player`

Adding a required `World` field is a world-shape change → bump the version so old saves fail cleanly instead of loading without a player.

**Files:**
- Modify: `lib/world/save.ts` (`SAVE_FORMAT_VERSION` 5 → 6)
- Test: `lib/world/__tests__/save.test.ts`

**Interfaces:**
- Consumes: `World.player` (Task 2).
- Produces: `SAVE_FORMAT_VERSION === 6`.

- [ ] **Step 1: Write the failing round-trip test**

Add to `lib/world/__tests__/save.test.ts`:

```ts
import { generateWorld } from "@/lib/world/gen";
import { serializeWorld, deserializeWorld, SAVE_FORMAT_VERSION } from "@/lib/world/save";

describe("save format — player seat", () => {
  it("round-trips world.player", () => {
    const world = generateWorld({
      systemCount: 120,
      seed: 7,
      playerFaction: { name: "Testers Guild", governmentType: "corporate", doctrine: "hegemonic" },
    });
    const back = deserializeWorld(serializeWorld(world));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.world.player).toEqual(world.player);
  });

  it("rejects a pre-6 save cleanly", () => {
    const stale = JSON.stringify({ formatVersion: 5, world: { meta: {} } });
    const result = deserializeWorld(stale);
    expect(result.ok).toBe(false);
  });

  it("is at version 6", () => {
    expect(SAVE_FORMAT_VERSION).toBe(6);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/world/__tests__/save.test.ts`
Expected: FAIL (version is 5).

- [ ] **Step 3: Bump the version**

In `lib/world/save.ts`: `export const SAVE_FORMAT_VERSION = 6;`

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/world/__tests__/save.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit
# subject: chore(save): bump format to 6 for world.player
```

---

### Task 4: New-game schema + service + route

Extend the New-Game input to carry the authored faction and forward it into world-gen.

**Files:**
- Modify: `lib/schemas/game-setup.ts` (add `name`/`governmentType`/`doctrine`)
- Modify: `lib/services/game.ts` (build `playerFaction`)
- Modify: `app/api/game/new/route.ts` (widen parsed-body type)
- Test: `lib/schemas/__tests__/game-setup.test.ts` (**create** if absent)

**Interfaces:**
- Consumes: `isGovernmentType`, `isDoctrine` (`lib/types/guards.ts`); `GenerateWorldOptions.playerFaction` (Task 2).
- Produces: `NewGameInput` gains `name: string`, `governmentType: GovernmentType`, `doctrine: Doctrine`.

- [ ] **Step 1: Write the failing schema test**

Create `lib/schemas/__tests__/game-setup.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { newGameSchema } from "@/lib/schemas/game-setup";

const valid = {
  systemCount: 600,
  name: "Aurelian League",
  governmentType: "federation",
  doctrine: "expansionist",
};

describe("newGameSchema — authored faction", () => {
  it("accepts a valid authored faction", () => {
    const r = newGameSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe("Aurelian League");
      expect(r.data.governmentType).toBe("federation");
      expect(r.data.doctrine).toBe("expansionist");
    }
  });

  it("rejects an out-of-set government", () => {
    expect(newGameSchema.safeParse({ ...valid, governmentType: "monarchy" }).success).toBe(false);
  });

  it("rejects an out-of-set doctrine", () => {
    expect(newGameSchema.safeParse({ ...valid, doctrine: "pacifist" }).success).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(newGameSchema.safeParse({ ...valid, name: "   " }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/schemas/__tests__/game-setup.test.ts`
Expected: FAIL (schema has no `name`/`governmentType`/`doctrine`).

- [ ] **Step 3: Extend the schema**

In `lib/schemas/game-setup.ts`, import the guards and add the fields (type-guard `.refine` narrows the output to the union, so no `as`):

```ts
import { isGovernmentType, isDoctrine } from "@/lib/types/guards";
```
```ts
export const newGameSchema = z.object({
  systemCount: z
    .number("System count is required")
    .int("System count must be a whole number")
    .min(50, "System count must be at least 50")
    .max(20000, "System count must be at most 20,000"),
  seed: z.number("Seed must be a number").int("Seed must be a whole number").optional(),
  name: z
    .string()
    .trim()
    .min(1, "Faction name is required")
    .max(40, "Faction name must be at most 40 characters"),
  governmentType: z.string().refine(isGovernmentType, "Choose a government type"),
  doctrine: z.string().refine(isDoctrine, "Choose a doctrine"),
});
```

- [ ] **Step 4: Run the schema tests**

Run: `npx vitest run lib/schemas/__tests__/game-setup.test.ts`
Expected: PASS.

- [ ] **Step 5: Build the player faction in the service**

In `lib/services/game.ts`, change `newGame` to accept the full input and forward a `playerFaction`:

```ts
import type { NewGameInput } from "@/lib/schemas/game-setup";
```
```ts
export function newGame(input: NewGameInput): WorldMeta {
  const seed = input.seed ?? Math.floor(Math.random() * 2_000_000_000);
  tickLoop.setSpeed("paused");
  const world = generateWorld({
    systemCount: input.systemCount,
    seed,
    playerFaction: {
      name: input.name,
      governmentType: input.governmentType,
      doctrine: input.doctrine,
    },
  });
  setWorld(world);
  return world.meta;
}
```

- [ ] **Step 6: Widen the route's parsed-body type**

In `app/api/game/new/route.ts`:

```ts
const body = await parseJsonBody<{
  systemCount?: number;
  seed?: number;
  name?: string;
  governmentType?: string;
  doctrine?: string;
}>(request);
```

(The rest — `newGameSchema.safeParse(body)` → `newGame(result.data)` — is unchanged.)

- [ ] **Step 7: Verify types + tests**

Run: `npx tsc --noEmit`
Expected: PASS (`result.data` now carries the narrowed `governmentType: GovernmentType` / `doctrine: Doctrine` into `newGame`).
Run: `npx vitest run lib/schemas/__tests__/game-setup.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit
# subject: feat(player-seat): accept an authored faction on New Game
```

---

### Task 5: Atlas player exposure + homeworld auto-focus

Expose the player through the atlas and land the camera on their homeworld — reusing `StarMap`'s existing `initialSelectedSystemId` centring.

**Files:**
- Modify: `lib/types/game.ts` (`AtlasData.player`)
- Modify: `lib/services/atlas.ts` (populate `player`)
- Modify: `app/(game)/page.tsx` (focus the homeworld)
- Test: `lib/services/__tests__/atlas.test.ts` (**create** if absent)

**Interfaces:**
- Consumes: `World.player` (Task 2).
- Produces: `AtlasData.player: { controlledFactionId: string; homeworldSystemId: string } | null`.

- [ ] **Step 1: Write the failing atlas test**

Create `lib/services/__tests__/atlas.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld } from "@/lib/world/store";
import { getAtlas } from "@/lib/services/atlas";

describe("getAtlas — player", () => {
  it("exposes the controlled faction and its homeworld system", () => {
    const world = generateWorld({
      systemCount: 150,
      seed: 99,
      playerFaction: { name: "Focus Test", governmentType: "cooperative", doctrine: "protectionist" },
    });
    setWorld(world);

    const atlas = getAtlas();
    expect(atlas.player).not.toBeNull();
    const seatId = world.factions.find((f) => f.id === world.player?.controlledFactionId)!.id;
    expect(atlas.player?.controlledFactionId).toBe(seatId);
    const faction = world.factions.find((f) => f.id === seatId)!;
    expect(atlas.player?.homeworldSystemId).toBe(faction.homeworldId);
  });

  it("is null for a playerless world", () => {
    setWorld(generateWorld({ systemCount: 150, seed: 99 }));
    expect(getAtlas().player).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/services/__tests__/atlas.test.ts`
Expected: FAIL (`atlas.player` undefined).

- [ ] **Step 3: Add the type**

In `lib/types/game.ts`, extend `AtlasData`:

```ts
export interface AtlasData {
  meta: { mapSize: number; systemCount: number; seed: number };
  regions: RegionInfo[];
  systems: AtlasSystem[];
  connections: SystemConnectionInfo[];
  factions: AtlasFaction[];
  /** The human player's seat + homeworld system for auto-focus; null in a playerless world. */
  player: { controlledFactionId: string; homeworldSystemId: string } | null;
}
```

- [ ] **Step 4: Populate it in the service**

In `lib/services/atlas.ts`, before the `return`, derive the player and add it to the returned object:

```ts
  const playerFactionId = world.player?.controlledFactionId ?? null;
  const playerHomeworldId = playerFactionId
    ? world.factions.find((f) => f.id === playerFactionId)?.homeworldId ?? null
    : null;
```
```ts
    factions: factions.map((f) => ({ id: f.id, name: f.name, color: f.color })),
    player:
      playerFactionId && playerHomeworldId
        ? { controlledFactionId: playerFactionId, homeworldSystemId: playerHomeworldId }
        : null,
  };
```

- [ ] **Step 5: Focus the homeworld on the map page**

In `app/(game)/page.tsx`, in `MapContent`, prefer an explicit `?systemId` deep-link, else the player's homeworld:

```tsx
function MapContent({ initialSystemId }: { initialSystemId?: string }) {
  const { atlas } = useAtlas();

  return (
    <div className="h-[calc(100vh-var(--topbar-height))] w-full relative">
      <StarMap
        atlas={atlas}
        initialSelectedSystemId={initialSystemId ?? atlas.player?.homeworldSystemId}
      />
    </div>
  );
}
```

- [ ] **Step 6: Run types + atlas tests**

Run: `npx tsc --noEmit`
Expected: PASS.
Run: `npx vitest run lib/services/__tests__/atlas.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit
# subject: feat(player-seat): expose player in atlas + auto-focus homeworld
```

---

### Task 6: The `/start/new` setup screen

Route New Game to a dedicated authoring page.

**Files:**
- Create: `components/start/create-faction-form.tsx`
- Create: `app/start/new/page.tsx`
- Modify: `components/start/start-screen.tsx` (New Game card → link)
- Delete: `components/start/new-game-form.tsx`

**Interfaces:**
- Consumes: `newGameSchema`/`NewGameInput` (Task 4); `GOVERNMENT_TYPES`, `DOCTRINES`, `ALL_GOVERNMENT_TYPES`, `ALL_DOCTRINES`.

- [ ] **Step 1: Create the authoring form**

`components/start/create-faction-form.tsx` — react-hook-form with `Controller` for the two react-select `SelectInput`s (they are controlled `value`/`onChange`, not native, so `register` does not work on them):

```tsx
"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/form/number-input";
import { TextInput } from "@/components/form/text-input";
import { SelectInput } from "@/components/form/select-input";
import { FormError } from "@/components/form/form-error";
import { apiMutate } from "@/lib/query/fetcher";
import { newGameSchema, type NewGameInput } from "@/lib/schemas/game-setup";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import { DOCTRINES } from "@/lib/constants/doctrines";
import { ALL_GOVERNMENT_TYPES, ALL_DOCTRINES } from "@/lib/types/guards";
import type { WorldMeta } from "@/lib/world/types";

const GOV_OPTIONS = ALL_GOVERNMENT_TYPES.map((g) => ({ value: g, label: GOVERNMENT_TYPES[g].name }));
const DOC_OPTIONS = ALL_DOCTRINES.map((d) => ({ value: d, label: DOCTRINES[d].name }));

export function CreateFactionForm() {
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<NewGameInput>({
    resolver: zodResolver(newGameSchema),
    defaultValues: {
      systemCount: 600,
      name: "",
      governmentType: "federation",
      doctrine: "expansionist",
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await apiMutate<WorldMeta>("/api/game/new", values);
      window.location.href = "/";
    } catch (error) {
      setError("root", {
        message: error instanceof Error ? error.message : "Failed to create game",
      });
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <TextInput
        id="faction-name"
        label="Faction name"
        placeholder="e.g. Aurelian League"
        error={errors.name?.message}
        {...register("name")}
      />
      <Controller
        name="governmentType"
        control={control}
        render={({ field }) => (
          <SelectInput
            label="Government"
            options={GOV_OPTIONS}
            value={field.value}
            onChange={field.onChange}
            error={errors.governmentType?.message}
          />
        )}
      />
      <Controller
        name="doctrine"
        control={control}
        render={({ field }) => (
          <SelectInput
            label="Doctrine"
            options={DOC_OPTIONS}
            value={field.value}
            onChange={field.onChange}
            error={errors.doctrine?.message}
          />
        )}
      />
      <NumberInput
        id="new-game-system-count"
        label="Systems"
        min={50}
        max={20000}
        step={50}
        hint="50 – 20,000. Bigger galaxies take longer to generate."
        error={errors.systemCount?.message}
        {...register("systemCount", { valueAsNumber: true })}
      />
      <TextInput
        id="new-game-seed"
        label="Seed (optional)"
        inputMode="numeric"
        placeholder="Random"
        error={errors.seed?.message}
        {...register("seed", { setValueAs: (v) => (v === "" ? undefined : Number(v)) })}
      />
      <FormError message={errors.root?.message} />
      <Button type="submit" fullWidth disabled={isSubmitting}>
        {isSubmitting ? "Generating…" : "Launch New Galaxy"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Create the setup page**

`app/start/new/page.tsx` — mirrors `/start`'s standalone shell, with a Back link and the form in a card:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader } from "@/components/ui/card";
import { CreateFactionForm } from "@/components/start/create-faction-form";

export const metadata: Metadata = {
  title: "Stellar Trader — New Game",
};

export default function NewGamePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-6 py-12">
      <div className="w-full max-w-md">
        <Link href="/start" className="text-sm text-text-tertiary hover:text-text-secondary">
          ← Back
        </Link>
        <Card className="mt-4">
          <CardHeader title="New Game" subtitle="Author the faction you'll rule." />
          <CreateFactionForm />
        </Card>
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Point the start screen at the new route**

In `components/start/start-screen.tsx`: remove the `NewGameForm` import, add `import { useRouter } from "next/navigation";`, and call `const router = useRouter();` at the top of `StartScreen` (alongside the existing `useState` hooks). Navigate on click rather than nesting a `<button>` inside an `<a>`. Replace the New Game `<Card>` with:

```tsx
      <Card>
        <CardHeader title="New Game" subtitle="Author a faction and drop into a fresh galaxy." />
        <Button fullWidth onClick={() => router.push("/start/new")}>
          New Game
        </Button>
      </Card>
```

- [ ] **Step 4: Delete the old inline form**

Run: `git rm components/start/new-game-form.tsx`

- [ ] **Step 5: Verify types + build**

Run: `npx tsc --noEmit`
Expected: PASS (no dangling `new-game-form` import).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit
# subject: feat(player-seat): dedicated /start/new faction authoring screen
```

---

### Task 7: The "You" tag on faction surfaces

Mark the controlled faction with a service-resolved flag; render it once in `FactionCard` (used by both the list and the panel header).

**Files:**
- Modify: `lib/services/factions.ts` (`FactionSummary.isPlayer`)
- Modify: `components/factions/faction-card.tsx` (render the badge)
- Test: `lib/services/__tests__/factions.test.ts` (**create** if absent)

**Interfaces:**
- Consumes: `World.player` (Task 2).
- Produces: `FactionSummary.isPlayer: boolean` (inherited by `FactionDetail`).

- [ ] **Step 1: Write the failing service test**

Create `lib/services/__tests__/factions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateWorld } from "@/lib/world/gen";
import { setWorld } from "@/lib/world/store";
import { listFactions, getFactionDetail } from "@/lib/services/factions";

describe("factions service — isPlayer", () => {
  it("flags exactly the controlled faction", () => {
    const world = generateWorld({
      systemCount: 150,
      seed: 5,
      playerFaction: { name: "Seat Holders", governmentType: "militarist", doctrine: "opportunistic" },
    });
    setWorld(world);
    expect(world.player).not.toBeNull();
    const playerId = world.factions.find((f) => f.id === world.player?.controlledFactionId)!.id;

    const summaries = listFactions();
    expect(summaries.filter((f) => f.isPlayer).map((f) => f.id)).toEqual([playerId]);
    expect(getFactionDetail(playerId).isPlayer).toBe(true);
    const otherId = summaries.find((f) => f.id !== playerId)!.id;
    expect(getFactionDetail(otherId).isPlayer).toBe(false);
  });

  it("flags nobody in a playerless world", () => {
    setWorld(generateWorld({ systemCount: 150, seed: 5 }));
    expect(listFactions().some((f) => f.isPlayer)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run lib/services/__tests__/factions.test.ts`
Expected: FAIL (`isPlayer` missing).

- [ ] **Step 3: Add the field to the type + builder**

In `lib/services/factions.ts`, add to the `FactionSummary` interface:

```ts
  /** True for the faction the human player controls (world.player); false for AI factions. */
  isPlayer: boolean;
```

In `toSummary(...)` (the function returning a `FactionSummary`), add to the returned object:

```ts
    isPlayer: world.player?.controlledFactionId === faction.id,
```

Making `isPlayer` required will make `tsc` flag `getFactionDetail` if it builds a `FactionDetail` without it — add the same `isPlayer: world.player?.controlledFactionId === faction.id` there too (using that function's `world`/`faction` locals).

- [ ] **Step 4: Render the badge in `FactionCard`**

In `components/factions/faction-card.tsx` (`Badge` is already imported), replace the name/status header row:

```tsx
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <h3
                className={
                  size === "md"
                    ? "font-display text-lg text-text-primary"
                    : "font-display text-base text-text-primary truncate"
                }
              >
                {faction.name}
              </h3>
              {faction.isPlayer && <Badge color="amber">You</Badge>}
            </div>
            <FactionStatusBadge status={faction.status} />
          </div>
```

- [ ] **Step 5: Run types + service tests**

Run: `npx tsc --noEmit`
Expected: PASS (all `FactionSummary`/`FactionDetail` construction sites set `isPlayer`).
Run: `npx vitest run lib/services/__tests__/factions.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit
# subject: feat(player-seat): mark the controlled faction with a "You" tag
```

---

### Task 8: Docs + terminology cleanup

Reconcile the docs with the shipped seat and remove the stale `startingSystemId` prose.

**Files:**
- Modify: `docs/SPEC.md` (Single-Player Runtime + Factions sections: the seat now exists; you author a faction)
- Modify: `docs/active/gameplay/faction-system.md` (§5 Starting Position: `startingSystemId` gone; player = authored faction)
- Modify: `docs/active/gameplay/universe.md`, `docs/active/engineering/single-player-runtime.md` (remove `startingSystemId` mentions)
- Modify: `docs/planned/grand-strategy-vision.md` (§3: seat is an *authored* faction, not a *picked* one)

**Interfaces:** none (docs only).

- [ ] **Step 1: Find the doc references**

Run: `git grep -n "startingSystemId" docs/`
Expected: matches in `universe.md`, `faction-system.md`, `single-player-runtime.md`.

- [ ] **Step 2: Update the docs**

- `faction-system.md` §5 "Starting Position": replace the `meta.startingSystemId` paragraph with a statement that the player authors a faction on New Game (name/government/doctrine), seeded as an additional major placed like any other, and `world.player.controlledFactionId` marks the seat.
- `universe.md` / `single-player-runtime.md`: delete the `startingSystemId` sentences (in `single-player-runtime.md`, "picking a faction is part of the planned player seat" becomes: the player authors a faction on New Game and `world.player` records the seat).
- `SPEC.md`: in the Single-Player Runtime section, replace "picking a faction is part of the planned player seat" with the shipped behaviour (author a faction on New Game; `world.player` holds the controlled faction; the map auto-focuses your homeworld). In the Factions section, note the player is an authored ninth major.
- `grand-strategy-vision.md` §3: change "an existing faction, from the first minute" to authoring your own faction (name/government/doctrine) from the first minute.
- Where any of these edited sentences say "month", use "cycle"/"pulse" instead. Do not touch unrelated "monthly pulse" prose elsewhere, and do not rename code fields/constants.

- [ ] **Step 3: Verify no stale references remain**

Run: `git grep -n "startingSystemId"`
Expected: no matches anywhere (code + docs).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit
# subject: docs(player-seat): reconcile SPEC + specs with the shipped seat
```

---

## Final verification (before opening the PR)

- [ ] `npx tsc --noEmit` — PASS
- [ ] `npx vitest run` — PASS (whole suite)
- [ ] `npx next build --webpack` — PASS (the PR build gate)
- [ ] `npm run simulate` — completes; economy-health metrics match a pre-change run (playerless path unmoved)
- [ ] **Manual smoke** (`npm run dev`):
  1. `/start` → **New Game** routes to `/start/new`.
  2. Author a faction (name + government + doctrine + systems) → **Launch** → the map opens centred on a developed homeworld (no galaxy-view flash).
  3. Open the Factions panel → your faction shows the **You** badge; open its detail → **You** badge in the header.
  4. Save, return to `/start`, **Continue**/**Load** → the map again lands on your homeworld.
  5. Confirm the eight preset majors still exist alongside yours.
