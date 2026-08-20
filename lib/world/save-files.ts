/**
 * Node-edge disk adapter for World saves — the Node/file implementation of `SaveBackend`
 * (`lib/world/save-backend.ts`). This is the ONLY `fs` import in `lib/` — `lib/world/save.ts` stays
 * pure (Path-B rule: `lib/engine/`, `lib/world/` except this file, and `lib/services/` contain no
 * Node-only APIs). Saves live as `saves/<name>.json` at the repo root; `saves/` is gitignored —
 * these are local single-player save files, not build output.
 *
 * **Node's `list()` divergence from the interface's index-only contract:** `SaveBackend.list()`'s
 * documented contract is "never parse every save blob" (client-runtime spec §5, this task's Proves
 * 2) — the browser backend (`client/save-indexeddb.ts`) honours this via a real index object store.
 * Node does NOT: it still reads and `deserialiseWorld`s every file to pull `tick` out of its world
 * meta, exactly as it did before this task. This is a stated, accepted divergence, not an
 * oversight — a separate on-disk index file would need its own write-coordination (the same
 * torn-write hazard this task's IndexedDB design solves with a transaction) for a cost this
 * implementation doesn't have today: disk directory listings are cheap at the file counts a
 * single-player save picker deals with, unlike a 5–13 MB save loaded into a browser's async
 * IndexedDB blob store on every list. Revisit only if Node-side save counts or sizes stop making
 * that true.
 */

import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { deserialiseWorld, sanitiseSaveName } from "./save";
import type { SaveBackend, SaveInfo } from "./save-backend";

export type { SaveInfo };

let SAVES_DIR = path.resolve("saves");
const SAVE_EXTENSION = ".json";

/**
 * Test-only override for the on-disk saves directory (default: repo-root
 * `saves/`). Lets `save-files.test.ts` point writes at a throwaway temp dir
 * instead of the real `saves/` folder, without changing the public
 * read/write/list API.
 */
export function setSavesDirForTesting(dir: string): void {
  SAVES_DIR = dir;
}

function saveFilePath(name: string): string {
  return path.join(SAVES_DIR, `${sanitiseSaveName(name)}${SAVE_EXTENSION}`);
}

/**
 * Writes via a temp file in `saves/` then `rename()`s over the final path —
 * `rename` is atomic on the same volume (including Windows), so a reader
 * never observes a partially-written save even if the process dies mid-write.
 * `json` is the caller's already-serialised save text (`lib/world/save.ts`'s
 * `serialiseWorld`) — this backend never touches `World` itself.
 */
async function writeSaveFile(name: string, json: string): Promise<void> {
  await mkdir(SAVES_DIR, { recursive: true });
  const finalPath = saveFilePath(name);
  const tempPath = `${finalPath}.tmp`;
  await writeFile(tempPath, json, "utf-8");
  await rename(tempPath, finalPath);
}

async function readSaveFile(name: string): Promise<string> {
  return readFile(saveFilePath(name), "utf-8");
}

async function removeSaveFile(name: string): Promise<void> {
  await rm(saveFilePath(name), { force: true });
}

/**
 * Lists every save on disk, reading each file to pull `tick` out of its
 * world meta (see this module's header docstring for why this diverges from
 * the interface's index-only listing contract). Saves that fail to
 * parse (partial write, incompatible formatVersion) are skipped rather
 * than surfaced as an error, so an unreadable save file doesn't break
 * the picker. Filesystem-level failures (a file vanishing mid-list)
 * still reject the listing as a whole.
 */
async function listSaveFiles(): Promise<SaveInfo[]> {
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
    const parsed = deserialiseWorld(content);
    if (!parsed.ok) continue;
    infos.push({
      name: fileName.slice(0, -SAVE_EXTENSION.length),
      tick: parsed.world.meta.currentTick,
      savedAt: fileStat.mtime.toISOString(),
      bytes: fileStat.size,
    });
  }
  return infos;
}

/** The Node/file `SaveBackend` — registered as `getSaveBackend()`'s fallback (`save-backend.ts`),
 *  reached only via that module's dynamic `import()`, never a static import from anywhere in `lib/`. */
export const nodeSaveBackend: SaveBackend = {
  write: writeSaveFile,
  read: readSaveFile,
  list: listSaveFiles,
  remove: removeSaveFile,
};
