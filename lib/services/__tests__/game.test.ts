import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, getWorld, clearWorld, hasWorld } from "@/lib/world/store";
import { setSavesDirForTesting } from "@/lib/world/save-files";
import { newGame, saveGame, loadGame, listGameSaves, exportSave, importSave } from "@/lib/services/game";

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
      if (!result.ok) {
        expect(result.error).toMatch(/no world/i);
      }
    });

    it("writes the current world and reports the sanitised name + tick", async () => {
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

// Proves 4 (build plan Task 12): export then import round-trips byte-equal.
describe("exportSave / importSave — round trip", () => {
  const world = generateWorld({ systemCount: 60, seed: 11 });

  afterEach(() => {
    clearWorld();
  });

  it("exports a save's exact raw JSON", async () => {
    setWorld(world);
    await saveGame("exportme");

    const result = await exportSave("exportme");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.name).toBe("exportme");
    const parsed = JSON.parse(result.data.json);
    expect(parsed.world.meta.seed).toBe(world.meta.seed);
  });

  it("fails with ok:false exporting a save that does not exist", async () => {
    const result = await exportSave("no-such-export");
    expect(result.ok).toBe(false);
  });

  it("export -> import round-trips the raw JSON byte-for-byte", async () => {
    setWorld(world);
    await saveGame("roundtrip-export");
    const exported = await exportSave("roundtrip-export");
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;

    const imported = await importSave("roundtrip-import", exported.data.json);
    expect(imported).toEqual({
      ok: true,
      data: { name: "roundtrip-import", tick: world.meta.currentTick },
    });

    const reExported = await exportSave("roundtrip-import");
    expect(reExported.ok).toBe(true);
    if (!reExported.ok) return;
    // The load-bearing assertion: the bytes written by importSave are IDENTICAL to what export
    // produced, not merely equivalent after a re-serialise round trip.
    expect(reExported.data.json).toBe(exported.data.json);
  });

  it("rejects an invalid save file without writing anything", async () => {
    const result = await importSave("bad-import", "{ not a valid save at all");
    expect(result.ok).toBe(false);

    const listed = await listGameSaves();
    expect(listed.some((s) => s.name === "bad-import")).toBe(false);
  });
});

describe("newGame — authored player faction", () => {
  afterEach(() => {
    clearWorld();
  });

  it("wires the authored faction into world.player and the roster, then swaps it into the store", () => {
    const meta = newGame({
      systemCount: 120,
      seed: 42,
      name: "Wiring Test",
      governmentType: "technocratic",
      doctrine: "mercantile",
    });
    expect(meta.systemCount).toBeGreaterThan(0);

    const world = getWorld();
    expect(world.player).not.toBeNull();
    const seat = world.factions.find((f) => f.id === world.player?.controlledFactionId)!;
    expect(seat.name).toBe("Wiring Test");
    expect(seat.governmentType).toBe("technocratic");
    expect(seat.doctrine).toBe("mercantile");
  });
});
