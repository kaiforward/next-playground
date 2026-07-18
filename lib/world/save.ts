/**
 * Pure save serialization for `World`. No `fs`/`process.env`/Node imports —
 * the disk adapter lives in `save-files.ts`, the only Node-edge file in
 * `lib/world`; this module only turns a `World` into a JSON string and back.
 *
 * Bump `SAVE_FORMAT_VERSION` for any `World`-shape (types.ts) change that would
 * make an old save invalid or misread — i.e. a new REQUIRED field, or a changed
 * meaning/shape of an existing one. An additive OPTIONAL field that old saves can
 * legitimately omit does NOT need a bump: the field simply stays `undefined` on
 * load, which is correct.
 * `deserializeWorld` does structural spot-checks, not exhaustive validation,
 * so an old save's shape can drift from the current `World` type without
 * tripping any of the checks below — the version bump is what makes old
 * saves fail cleanly ("saves break on upgrade") instead of loading a stale
 * shape that happens to pass the spot-checks.
 */

import type { World } from "./types";

export const SAVE_FORMAT_VERSION = 6;

/** Reserved save name the tick loop autosaves to; the start screen's "Continue" loads it. */
export const AUTOSAVE_NAME = "autosave";

/**
 * Canonical save-name sanitizer — strips everything but `[a-z0-9-_]` so a
 * player-typed name can never escape `saves/` via path separators or
 * traversal sequences (`../`). Lives here (pure) rather than in the disk
 * adapter so the save-name form schema can reject names that sanitize to
 * empty without importing Node-edge code.
 */
export function sanitizeSaveName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-_]/g, "");
}

interface SaveFile {
  formatVersion: number;
  world: World;
}

export type DeserializeResult =
  | { ok: true; world: World }
  | { ok: false; error: string };

export function serializeWorld(world: World): string {
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
export function deserializeWorld(json: string): DeserializeResult {
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

  return { ok: true, world: parsed.world };
}

/**
 * Spot-check every save's world must pass: an object with a `meta` object
 * whose `currentTick`/`seed`/`mapSize`/`systemCount` are numeric. `mapSize`
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
  return (
    "currentTick" in meta &&
    typeof meta.currentTick === "number" &&
    "seed" in meta &&
    typeof meta.seed === "number" &&
    "mapSize" in meta &&
    typeof meta.mapSize === "number" &&
    "systemCount" in meta &&
    typeof meta.systemCount === "number"
  );
}
