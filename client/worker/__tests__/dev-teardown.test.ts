import { describe, it, expect, vi } from "vitest";
import {
  DEV_TEARDOWN_SAVE_NAME,
  saveTeardownSnapshot,
  restoreTeardownSaveIfPresent,
} from "@/client/worker/dev-teardown";
import { generateWorld } from "@/lib/world/gen";
import type { SaveBackend, SaveInfo } from "@/lib/world/save-backend";
import type { World } from "@/lib/world/types";

/** A trivial in-memory `SaveBackend` — this is exactly the "unit coverage honestly possible"
 *  the build plan calls for (the mechanism under a fake backend, never a real worker/IndexedDB). */
function createFakeBackend(initial: SaveInfo[] = []): SaveBackend & { writes: { name: string; json: string }[] } {
  const index = new Map(initial.map((info) => [info.name, info]));
  const blobs = new Map<string, string>();
  const writes: { name: string; json: string }[] = [];
  return {
    writes,
    async write(name, json) {
      writes.push({ name, json });
      blobs.set(name, json);
      index.set(name, { name, tick: 0, savedAt: "2026-01-01T00:00:00.000Z", bytes: json.length });
    },
    async read(name) {
      const json = blobs.get(name);
      if (json === undefined) throw new Error(`no save named ${name}`);
      return json;
    },
    async list() {
      return [...index.values()];
    },
    async remove(name) {
      index.delete(name);
      blobs.delete(name);
    },
  };
}

// A real generated world (smallest config other fixtures in this suite use), not a hand-built
// stand-in — no casts (review finding 3, Task 13).
const WORLD = generateWorld({ systemCount: 20, seed: 1 });

describe("saveTeardownSnapshot — the dispose-time write path", () => {
  it("writes the current world under the reserved teardown name", async () => {
    const backend = createFakeBackend();
    const serialise = vi.fn((world: World) => JSON.stringify(world));

    await saveTeardownSnapshot(backend, WORLD, serialise);

    expect(backend.writes).toHaveLength(1);
    expect(backend.writes[0].name).toBe(DEV_TEARDOWN_SAVE_NAME);
    expect(backend.writes[0].json).toBe(JSON.stringify(WORLD));
    expect(serialise).toHaveBeenCalledWith(WORLD);
  });

  it("is a no-op when no world is running — nothing to preserve, and never writes an empty save", async () => {
    const backend = createFakeBackend();
    const serialise = vi.fn((world: World) => JSON.stringify(world));

    await saveTeardownSnapshot(backend, null, serialise);

    expect(backend.writes).toHaveLength(0);
    expect(serialise).not.toHaveBeenCalled();
  });
});

describe("restoreTeardownSaveIfPresent — the boot-prefers-teardown-save logic", () => {
  it("loads from the teardown save and then removes it, when one exists", async () => {
    const backend = createFakeBackend([
      { name: DEV_TEARDOWN_SAVE_NAME, tick: 42, savedAt: "2026-01-01T00:00:00.000Z", bytes: 10 },
    ]);
    const loadFromTeardown = vi.fn(async () => {});

    await restoreTeardownSaveIfPresent(backend, loadFromTeardown);

    expect(loadFromTeardown).toHaveBeenCalledExactlyOnceWith(DEV_TEARDOWN_SAVE_NAME);
    expect((await backend.list()).some((s) => s.name === DEV_TEARDOWN_SAVE_NAME)).toBe(false);
  });

  it("does nothing when no teardown save exists — a genuinely fresh boot is never hijacked", async () => {
    const backend = createFakeBackend([
      { name: "some-other-save", tick: 1, savedAt: "2026-01-01T00:00:00.000Z", bytes: 10 },
    ]);
    const loadFromTeardown = vi.fn(async () => {});

    await restoreTeardownSaveIfPresent(backend, loadFromTeardown);

    expect(loadFromTeardown).not.toHaveBeenCalled();
    // The unrelated save is untouched — this isn't a blanket "remove everything" pass.
    expect((await backend.list()).some((s) => s.name === "some-other-save")).toBe(true);
  });

  it("removes the teardown save even when the caller's load resolves — consumed exactly once, so a later boot with no HMR involved never finds it again", async () => {
    const backend = createFakeBackend([
      { name: DEV_TEARDOWN_SAVE_NAME, tick: 7, savedAt: "2026-01-01T00:00:00.000Z", bytes: 10 },
    ]);
    let removedBeforeCalling = false;
    const loadFromTeardown = vi.fn(async () => {
      removedBeforeCalling = (await backend.list()).some((s) => s.name === DEV_TEARDOWN_SAVE_NAME);
    });

    await restoreTeardownSaveIfPresent(backend, loadFromTeardown);

    // The save is still present WHILE the load runs (removal happens after, not before) — a
    // restore that failed mid-load should not have already thrown away the only copy.
    expect(removedBeforeCalling).toBe(true);
    expect((await backend.list()).some((s) => s.name === DEV_TEARDOWN_SAVE_NAME)).toBe(false);
  });
});
