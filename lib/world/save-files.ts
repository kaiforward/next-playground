/**
 * Node-edge disk adapter for World saves. This is the ONLY `fs` import in
 * `lib/` — `lib/world/save.ts` stays pure (Path-B rule: `lib/engine/`,
 * `lib/world/` except this file, and `lib/services/` contain no Node-only
 * APIs). Saves live as `saves/<name>.json` at the repo root; `saves/` is
 * gitignored — these are local single-player save files, not build output.
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { deserializeWorld, serializeWorld } from "./save";
import type { World } from "./types";

export const AUTOSAVE_NAME = "autosave";

export interface SaveInfo {
  name: string;
  tick: number;
  savedAt: Date;
  bytes: number;
}

const SAVES_DIR = path.resolve("saves");
const SAVE_EXTENSION = ".json";

/**
 * Save names come from player input (the "new save" text box) — strip
 * everything but `[a-z0-9-_]` so a name can never escape `saves/` via path
 * separators or traversal sequences (`../`).
 */
function sanitizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-_]/g, "");
}

function saveFilePath(name: string): string {
  return path.join(SAVES_DIR, `${sanitizeName(name)}${SAVE_EXTENSION}`);
}

export async function writeSave(name: string, world: World): Promise<void> {
  await mkdir(SAVES_DIR, { recursive: true });
  await writeFile(saveFilePath(name), serializeWorld(world), "utf-8");
}

export async function readSave(name: string): Promise<string> {
  return readFile(saveFilePath(name), "utf-8");
}

/**
 * Lists every save on disk, reading each file to pull `tick` out of its
 * world meta (cheap at the file counts a single-player save picker deals
 * with — no separate index file to keep in sync). Saves that fail to
 * parse (partial write, incompatible formatVersion) are skipped rather
 * than surfaced as an error, so an unreadable save file doesn't break
 * the picker. Filesystem-level failures (a file vanishing mid-list)
 * still reject the listing as a whole.
 */
export async function listSaves(): Promise<SaveInfo[]> {
  await mkdir(SAVES_DIR, { recursive: true });
  const entries = await readdir(SAVES_DIR);
  const saveFiles = entries.filter((entry) => entry.endsWith(SAVE_EXTENSION));

  const infos: SaveInfo[] = [];
  for (const fileName of saveFiles) {
    const filePath = path.join(SAVES_DIR, fileName);
    const [content, fileStat] = await Promise.all([
      readFile(filePath, "utf-8"),
      stat(filePath),
    ]);
    const parsed = deserializeWorld(content);
    if (!parsed.ok) continue;
    infos.push({
      name: fileName.slice(0, -SAVE_EXTENSION.length),
      tick: parsed.world.meta.currentTick,
      savedAt: fileStat.mtime,
      bytes: fileStat.size,
    });
  }
  return infos;
}
