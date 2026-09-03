import { generateWorld } from "@/lib/world/gen";
import { getWorld, hasWorld, setWorld } from "@/lib/world/store";
import { deserialiseWorld, sanitiseSaveName, serialiseWorld } from "@/lib/world/save";
import { tickLoop, type Speed } from "@/lib/world/tick-loop";
import { getSaveBackend } from "@/lib/world/save-backend";
import type { SaveInfo } from "@/lib/world/save-backend";
import type { WorldMeta } from "@/lib/world/types";
import type { NewGameInput } from "@/lib/schemas/game-setup";
import type { GenShapeOverrides } from "@/lib/engine/universe-gen";

/** Constraint-carrying identity: instantiating it with an `A` outside `B` is a compile error. */
type AssertExtends<A extends B, B> = A;

/**
 * Compile-time pin, no runtime cost: every galaxy-shape knob the New Game schema accepts must be a
 * field the engine's own override type carries. `buildGenParams` reads those fields one by one, so
 * a knob added to `galaxyShapeSchema` alone would validate, ride the command, and then be dropped
 * without a word. Exported so the alias is a declaration rather than an unused local.
 */
export type SchemaShapeKnobsReachTheEngine =
  AssertExtends<keyof NonNullable<NewGameInput["shape"]>, keyof GenShapeOverrides>;

/**
 * Create a fresh world and swap it into the store. Pauses the tick loop first
 * so the swap can't race a tick mid-generation; the player resumes pacing
 * explicitly from the UI.
 */
export function newGame(input: NewGameInput): WorldMeta {
  // The only permissible Math.random — a default seed picked outside the
  // deterministic tick path.
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
    shape: input.shape,
  });
  setWorld(world);
  return world.meta;
}

/** Set the tick-loop speed and report the value actually applied. */
export function setGameSpeed(speed: Speed): { speed: Speed } {
  tickLoop.setSpeed(speed);
  return { speed: tickLoop.getSpeed() };
}

// The save/load/export/import services below resolve their backend through
// `getSaveBackend()` (`lib/world/save-backend.ts`) rather than importing
// `save-files.ts` directly — that keeps this module's static import graph
// free of `fs` per the Path-B purity rule AND makes it the same module the
// browser worker dynamic-imports (it must never statically pull in the Node
// disk adapter). See `save-backend.ts`'s header docstring for the resolution
// design.

export type SaveGameResult =
  | { ok: true; data: { name: string; tick: number } }
  | { ok: false; error: string };

/** Write the current world through the active save backend. */
export async function saveGame(name: string): Promise<SaveGameResult> {
  if (!hasWorld()) {
    return { ok: false, error: "No world loaded to save" };
  }
  const world = getWorld();
  const backend = await getSaveBackend();
  await backend.write(name, serialiseWorld(world));
  return {
    ok: true,
    data: { name: sanitiseSaveName(name), tick: world.meta.currentTick },
  };
}

export type LoadGameResult =
  | { ok: true; data: WorldMeta }
  | { ok: false; error: string };

/**
 * Load a save into the store. Pauses the tick loop before the swap so a tick
 * can't race the load; a failed load leaves the current world untouched.
 */
export async function loadGame(name: string): Promise<LoadGameResult> {
  const backend = await getSaveBackend();
  let json: string;
  try {
    json = await backend.read(name);
  } catch {
    return { ok: false, error: `Save "${name}" not found` };
  }

  const parsed = deserialiseWorld(json);
  if (!parsed.ok) {
    return { ok: false, error: `Incompatible save: ${parsed.error}` };
  }

  tickLoop.setSpeed("paused");
  setWorld(parsed.world);
  return { ok: true, data: parsed.world.meta };
}

/** All saves the active backend knows about, newest first (the order every save picker wants). */
export async function listGameSaves(): Promise<SaveInfo[]> {
  const backend = await getSaveBackend();
  const saves = await backend.list();
  return saves.toSorted(
    (a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt) || a.name.localeCompare(b.name),
  );
}

export type ExportSaveResult =
  | { ok: true; data: { name: string; json: string } }
  | { ok: false; error: string };

/** Read a save's raw JSON back out — the start screen's Export control (build plan Task 12). Never
 *  touches the world store: exporting doesn't load the save, only moves its bytes. */
export async function exportSave(name: string): Promise<ExportSaveResult> {
  const backend = await getSaveBackend();
  try {
    const json = await backend.read(name);
    return { ok: true, data: { name: sanitiseSaveName(name), json } };
  } catch {
    return { ok: false, error: `Save "${name}" not found` };
  }
}

export type ImportSaveResult =
  | { ok: true; data: { name: string; tick: number } }
  | { ok: false; error: string };

/**
 * Write a caller-supplied save JSON through the active backend under `name` — the start screen's
 * Import control. Validated via the same `deserialiseWorld` path a load uses, BEFORE anything is
 * written, so an invalid file is rejected with a message rather than corrupting a slot; the world
 * store itself is untouched either way (import stages a save, it does not load one).
 */
export async function importSave(name: string, json: string): Promise<ImportSaveResult> {
  const parsed = deserialiseWorld(json);
  if (!parsed.ok) {
    return { ok: false, error: `Incompatible save: ${parsed.error}` };
  }
  const backend = await getSaveBackend();
  await backend.write(name, json);
  return { ok: true, data: { name: sanitiseSaveName(name), tick: parsed.world.meta.currentTick } };
}
