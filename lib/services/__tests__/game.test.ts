import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, getWorld, clearWorld, hasWorld } from "@/lib/world/store";
import { setSavesDirForTesting } from "@/lib/world/save-files";
import { saveGame, loadGame, listGameSaves } from "@/lib/services/game";

describe("game lifecycle services (save/load)", () => {
  const world = generateWorld({ systemCount: 60, seed: 7 });
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stellar-trader-game-"));
    setSavesDirForTesting(tempDir);
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  afterEach(() => {
    clearWorld();
  });

  describe("saveGame", () => {
    it("fails with ok:false when no world is loaded", async () => {
      const result = await saveGame("mysave");
      expect(result.ok).toBe(false);
    });

    it("writes the current world and reports the sanitized name + tick", async () => {
      setWorld(world);
      const result = await saveGame("My Save! #1");
      expect(result).toEqual({
        ok: true,
        data: { name: "mysave1", tick: world.meta.currentTick },
      });

      const saves = await listGameSaves();
      expect(saves.some((s) => s.name === "mysave1")).toBe(true);
    });
  });

  describe("loadGame", () => {
    it("round-trips: a saved world loads back into the store", async () => {
      setWorld(world);
      await saveGame("roundtrip");
      clearWorld();
      expect(hasWorld()).toBe(false);

      const result = await loadGame("roundtrip");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual(world.meta);
      }
      expect(getWorld()).toEqual(world);
    });

    it("fails with ok:false for a save that does not exist", async () => {
      const result = await loadGame("no-such-save");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/not found/i);
      }
    });

    it("fails with ok:false for an incompatible save (wrong formatVersion)", async () => {
      await writeFile(
        path.join(tempDir, "oldsave.json"),
        JSON.stringify({ formatVersion: 0, world }),
        "utf-8",
      );

      const result = await loadGame("oldsave");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/incompatible/i);
      }
      // A failed load must not clobber the store.
      expect(hasWorld()).toBe(false);
    });
  });

  it("listGameSaves lists saves newest-first", async () => {
    const saves = await listGameSaves();
    const times = saves.map((s) => Date.parse(s.savedAt));
    const sorted = [...times].sort((a, b) => b - a);
    expect(times).toEqual(sorted);
  });
});
