import { generateWorld } from "@/lib/world/gen";
import { getWorld, hasWorld, setWorld } from "@/lib/world/store";
import { deserializeWorld, sanitizeSaveName } from "@/lib/world/save";
import { tickLoop, type Speed } from "@/lib/world/tick-loop";
import type { SaveInfo } from "@/lib/world/save-files";
import type { WorldMeta } from "@/lib/world/types";
import type { NewGameInput } from "@/lib/schemas/game-setup";

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
  });
  setWorld(world);
  return world.meta;
}

/** Set the tick-loop speed and report the value actually applied. */
export function setGameSpeed(speed: Speed): { speed: Speed } {
  tickLoop.setSpeed(speed);
  return { speed: tickLoop.getSpeed() };
}

// The save/load services below dynamic-import `save-files.ts` (the one
// Node-edge file in lib/world) inside their bodies so this module's static
// import graph stays free of `fs` per the Path-B purity rule — same idiom the
// tick loop uses for autosave.

export type SaveGameResult =
  | { ok: true; data: { name: string; tick: number } }
  | { ok: false; error: string };

/** Write the current world to `saves/<sanitized name>.json`. */
export async function saveGame(name: string): Promise<SaveGameResult> {
  if (!hasWorld()) {
    return { ok: false, error: "No world loaded to save" };
  }
  const { writeSave } = await import("@/lib/world/save-files");
  const world = getWorld();
  await writeSave(name, world);
  return {
    ok: true,
    data: { name: sanitizeSaveName(name), tick: world.meta.currentTick },
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
  const { readSave } = await import("@/lib/world/save-files");
  let json: string;
  try {
    json = await readSave(name);
  } catch {
    return { ok: false, error: `Save "${name}" not found` };
  }

  const parsed = deserializeWorld(json);
  if (!parsed.ok) {
    return { ok: false, error: `Incompatible save: ${parsed.error}` };
  }

  tickLoop.setSpeed("paused");
  setWorld(parsed.world);
  return { ok: true, data: parsed.world.meta };
}

/** All saves on disk, newest first (the order every save picker wants). */
export async function listGameSaves(): Promise<SaveInfo[]> {
  const { listSaves } = await import("@/lib/world/save-files");
  const saves = await listSaves();
  return saves.toSorted(
    (a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt) || a.name.localeCompare(b.name),
  );
}
