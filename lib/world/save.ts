/**
 * Pure save serialisation for `World`. No `fs`/`process.env`/Node imports —
 * the disk adapter lives in `save-files.ts`, the only Node-edge file in
 * `lib/world`; this module only turns a `World` into a JSON string and back.
 *
 * Bump `SAVE_FORMAT_VERSION` for any `World`-shape (types.ts) change that would
 * make an old save invalid or misread — i.e. a new REQUIRED field, or a changed
 * meaning/shape of an existing one. An additive OPTIONAL field that old saves can
 * legitimately omit does NOT need a bump: the field simply stays `undefined` on
 * load, which is correct.
 *
 * A REMOVED field needs a bump only where losing its value misreads the world.
 * Removing purely transient state does not: `WorldBuilding.collapseDebt` moved to
 * `WorldSystem.collapseDebt` unbumped because the decay channel's debt is a regime
 * accumulator that resets whenever unrest falls back below the threshold, never a
 * balance anything is owed. An older save loads with the system field absent (read
 * as 0), and the stale per-building value is dropped the first time `flattenBuildings`
 * rebuilds the rows — so the worst case is one system starting its next collapse from
 * zero rather than mid-accrual.
 * `deserialiseWorld` does structural spot-checks, not exhaustive validation,
 * so an old save's shape can drift from the current `World` type without
 * tripping any of the checks below — the version bump is what makes old
 * saves fail cleanly ("saves break on upgrade") instead of loading a stale
 * shape that happens to pass the spot-checks.
 */

import type { World, WorldSystem } from "./types";
import { slottedBodiesBySystem, workedYieldVectors } from "@/lib/engine/worked-deposits";
import { effColumns, yieldColumns } from "@/lib/engine/resources";

// v17 bumps for two shape changes riding the same commit: `world.player.alertCategories`'s key set
// shrinks from sixteen to thirteen (the three event alert categories — crisis/disruption/windfall —
// are deleted, not merely defaulted), and `WorldEvent.type`'s union shrinks to the relations-owned
// trio (the fourteen random-spawn event definitions are deleted). A pre-bump save can carry either
// stale key: an old alertCategories record with a now-nonexistent key would leave a category with no
// stored preference, and an old world.events row naming a stripped type would be silently expired by
// the events processor's stale-type guard (`lib/tick/processors/events.ts`) rather than surfacing
// anywhere — the bump makes both fail loudly at load instead of drifting unnoticed.
export const SAVE_FORMAT_VERSION = 17;

/** Reserved save name the tick loop autosaves to; the start screen's "Continue" loads it. */
export const AUTOSAVE_NAME = "autosave";

/**
 * Canonical save-name sanitiser — strips everything but `[a-z0-9-_]` so a
 * player-typed name can never escape `saves/` via path separators or
 * traversal sequences (`../`). Lives here (pure) rather than in the disk
 * adapter so the save-name form schema can reject names that sanitise to
 * empty without importing Node-edge code.
 */
export function sanitiseSaveName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-_]/g, "");
}

interface SaveFile {
  formatVersion: number;
  world: World;
}

export type DeserialiseResult =
  | { ok: true; world: World }
  | { ok: false; error: string };

export function serialiseWorld(world: World): string {
  const save: SaveFile = { formatVersion: SAVE_FORMAT_VERSION, world };
  return JSON.stringify(save);
}

/**
 * Narrows a `JSON.parse` result into a typed `World`. Per the JSON-boundary
 * convention, the parsed value is checked with `typeof`/`in` immediately
 * rather than threaded through as `unknown` — these are structural
 * spot-checks (top-level shape, `formatVersion`, and the numeric `meta`
 * fields the map/tile geometry depends on), not exhaustive validation:
 * pre-1.0 saves are trusted local files, not untrusted network input.
 */
export function deserialiseWorld(json: string): DeserialiseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: "Save file is not valid JSON" };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: "Save file is not a JSON object" };
  }
  if (!("formatVersion" in parsed) || parsed.formatVersion !== SAVE_FORMAT_VERSION) {
    return {
      ok: false,
      error: `Unsupported save formatVersion (expected ${SAVE_FORMAT_VERSION})`,
    };
  }
  if (!("world" in parsed) || !isWorldShaped(parsed.world)) {
    return { ok: false, error: "Save file's world is missing required meta fields" };
  }

  return { ok: true, world: rebuildWorkedYieldColumns(parsed.world) };
}

/**
 * The worked-prefix load hook: recomputes every system's `yields`/`extractionEff` columns from
 * `world.bodies` + `world.buildings`, the same fold the tick's write path uses
 * (`workedYieldVectors`, `lib/engine/worked-deposits.ts`). Pure, deterministic, no RNG — so a
 * pre-change save's generation-frozen pooled columns are replaced with worked-prefix values
 * before anything else in the game reads them, and a current-format save that was already
 * worked-fold-correct round-trips unchanged. A body-less system's columns are left as-is (no
 * slots to fold, and the fold's own neutral 1.0 is not a reading a body-less row earned) —
 * mirrors `refoldWorkedYields`'s same guard in the tick write path (`lib/world/tick.ts`).
 *
 * This is the one seam every load path passes through (`deserialiseWorld` itself, called by
 * `loadGame`/the worker boot/save-files/the harness) — so this hook, not a second transform in
 * any caller, is what pre-change saves and file vs. IndexedDB loads share.
 */
export function rebuildWorkedYieldColumns(world: World): World {
  const bodiesBySystem = slottedBodiesBySystem(world.bodies);
  const buildingsBySystem = new Map<string, Record<string, number>>();
  for (const b of world.buildings) {
    let counts = buildingsBySystem.get(b.systemId);
    if (!counts) {
      counts = {};
      buildingsBySystem.set(b.systemId, counts);
    }
    counts[b.buildingType] = b.count;
  }

  const systems: WorldSystem[] = world.systems.map((s) => {
    const bodies = bodiesBySystem.get(s.id);
    if (bodies === undefined || bodies.length === 0) return s;
    const buildings = buildingsBySystem.get(s.id) ?? {};
    const worked = workedYieldVectors(bodies, buildings);
    return { ...s, ...yieldColumns(worked.yieldMult), ...effColumns(worked.eff) };
  });

  return { ...world, systems };
}

/**
 * Spot-check every save's world must pass: an object with a `meta` object
 * whose `currentTick`/`seed`/`mapSize`/`systemCount` are numeric, plus
 * `systems`/`bodies`/`buildings` each present as an array. The three arrays are
 * checked because `rebuildWorkedYieldColumns` (below, in this same `ok` arm)
 * dereferences `world.bodies`/`world.buildings`/`world.systems` unconditionally —
 * without this guard a save missing one of them would throw out of
 * `deserialiseWorld` instead of failing cleanly with `{ ok: false }`. `mapSize`
 * and `systemCount` are checked because the client tile geometry divides by
 * `mapSize` — a save missing it would silently produce NaN tile bounds
 * downstream. Not exhaustive — see the module doc comment. A user-defined
 * type guard asserts the rest of `World`'s shape; it is the caller's
 * responsibility (formatVersion bump) to keep that assertion honest as
 * `World` evolves.
 */
function isWorldShaped(value: unknown): value is World {
  if (typeof value !== "object" || value === null) return false;
  if (!("meta" in value) || typeof value.meta !== "object" || value.meta === null) {
    return false;
  }
  const meta = value.meta;
  if (
    !(
      "currentTick" in meta &&
      typeof meta.currentTick === "number" &&
      "seed" in meta &&
      typeof meta.seed === "number" &&
      "mapSize" in meta &&
      typeof meta.mapSize === "number" &&
      "systemCount" in meta &&
      typeof meta.systemCount === "number"
    )
  ) {
    return false;
  }
  return (
    "systems" in value && Array.isArray(value.systems) &&
    "bodies" in value && Array.isArray(value.bodies) &&
    "buildings" in value && Array.isArray(value.buildings)
  );
}
