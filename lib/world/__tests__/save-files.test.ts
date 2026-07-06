import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { generateWorld } from "../gen";
import {
  writeSave,
  readSave,
  listSaves,
  setSavesDirForTesting,
} from "../save-files";

describe("save-files", () => {
  const world = generateWorld({ systemCount: 60, seed: 7 });
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "stellar-trader-saves-"));
    setSavesDirForTesting(tempDir);
  });

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("name sanitization (via the public writeSave/listSaves API)", () => {
    it("strips path-traversal sequences so a save can never escape saves/", async () => {
      await writeSave("../../etc/passwd", world);
      const names = (await listSaves()).map((s) => s.name);
      expect(names).toContain("etcpasswd");
      expect(names.every((n) => !n.includes("/") && !n.includes("\\") && !n.includes(".."))).toBe(true);
    });

    it("lowercases and strips spaces/uppercase/garbage characters", async () => {
      await writeSave("My Save! #1", world);
      const names = (await listSaves()).map((s) => s.name);
      expect(names).toContain("mysave1");
    });
  });

  it("round-trips a save through write -> list -> read", async () => {
    await writeSave("roundtrip", world);

    const saves = await listSaves();
    const info = saves.find((s) => s.name === "roundtrip")!;
    expect(info).toBeDefined();
    expect(info.tick).toBe(world.meta.currentTick);
    expect(info.bytes).toBeGreaterThan(0);

    const raw = await readSave("roundtrip");
    const parsed = JSON.parse(raw);
    expect(parsed.world.meta.seed).toBe(world.meta.seed);
    expect(parsed.world.meta.currentTick).toBe(world.meta.currentTick);
  });

  it("skips a malformed save file without throwing", async () => {
    await writeFile(path.join(tempDir, "corrupt.json"), "{ not valid json", "utf-8");

    await expect(listSaves()).resolves.not.toThrow();
    const saves = await listSaves();
    expect(saves.some((s) => s.name === "corrupt")).toBe(false);
    // The valid saves written by earlier tests still list fine alongside it.
    expect(saves.some((s) => s.name === "roundtrip")).toBe(true);
  });
});
