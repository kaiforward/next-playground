/**
 * Red-proofs for the IndexedDB `SaveBackend` (client-runtime build plan Task 12, Proves 1–3).
 * `fake-indexeddb` polyfills `indexedDB`/`IDBKeyRange` under plain Node — this file runs in the
 * "unit" vitest project (pure logic, no jsdom needed for IndexedDB itself).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBKeyRange, IDBObjectStore } from "fake-indexeddb";
import {
  indexedDbSaveBackend,
  writeBlob,
  resetDatabaseConnectionForTesting,
} from "@/client/save-indexeddb";

declare global {
  // eslint-disable-next-line no-var
  var indexedDB: IDBFactory;
}

beforeEach(() => {
  // A fresh factory per test — genuine storage isolation, not just a connection reset.
  globalThis.indexedDB = new IDBFactory();
  globalThis.IDBKeyRange = IDBKeyRange;
  resetDatabaseConnectionForTesting();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetDatabaseConnectionForTesting();
});

function saveJson(tick: number): string {
  return JSON.stringify({ formatVersion: 15, world: { meta: { currentTick: tick, seed: 1 } } });
}

describe("indexedDbSaveBackend — round trip", () => {
  it("writes then reads back the exact same bytes", async () => {
    await indexedDbSaveBackend.write("slot-1", saveJson(10));
    const raw = await indexedDbSaveBackend.read("slot-1");
    expect(raw).toBe(saveJson(10));
  });

  it("list() surfaces an index record (name, tick, savedAt, bytes) per save", async () => {
    await indexedDbSaveBackend.write("slot-1", saveJson(10));
    const saves = await indexedDbSaveBackend.list();
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ name: "slot-1", tick: 10 });
    expect(saves[0].bytes).toBeGreaterThan(0);
    expect(typeof saves[0].savedAt).toBe("string");
  });

  it("a second write to the same name replaces the first — read/list reflect only the latest", async () => {
    await indexedDbSaveBackend.write("slot-1", saveJson(10));
    await indexedDbSaveBackend.write("slot-1", saveJson(20));

    expect(await indexedDbSaveBackend.read("slot-1")).toBe(saveJson(20));
    const saves = await indexedDbSaveBackend.list();
    expect(saves).toHaveLength(1);
    expect(saves[0].tick).toBe(20);
  });

  it("read() of a name that was never written rejects (mirrors the Node backend's ENOENT)", async () => {
    await expect(indexedDbSaveBackend.read("never-written")).rejects.toThrow();
  });

  it("remove() deletes both the index record and the blob", async () => {
    await indexedDbSaveBackend.write("slot-1", saveJson(10));
    await indexedDbSaveBackend.remove("slot-1");

    expect(await indexedDbSaveBackend.list()).toHaveLength(0);
    await expect(indexedDbSaveBackend.read("slot-1")).rejects.toThrow();
  });
});

// Proves 1: an interrupted write (value/blob committed, index not) recovers to the last good save.
describe("indexedDbSaveBackend — Proves 1: interrupted write recovers to the last good save", () => {
  it("a blob committed without its index swap is invisible to read()/list() — no prior save existed", async () => {
    // Simulates the exact torn window write-then-swap-key names: step 1 (writeBlob) commits,
    // step 2 (the index swap inside write()) never runs.
    await writeBlob("slot-1", saveJson(999));

    await expect(indexedDbSaveBackend.read("slot-1")).rejects.toThrow();
    expect(await indexedDbSaveBackend.list()).toHaveLength(0);
  });

  it("a blob committed without its index swap leaves a PRIOR good save fully intact and current", async () => {
    await indexedDbSaveBackend.write("slot-1", saveJson(10));

    // A later write is interrupted after its blob commits but before the index swap runs.
    await writeBlob("slot-1", saveJson(999));

    // Recovery: read()/list() still return the last GOOD save (tick 10), never the torn one, and
    // never an error — the whole point of write-then-swap-key.
    expect(await indexedDbSaveBackend.read("slot-1")).toBe(saveJson(10));
    const saves = await indexedDbSaveBackend.list();
    expect(saves).toEqual([expect.objectContaining({ name: "slot-1", tick: 10 })]);
  });

  it("a SUBSEQUENT successful write after the interruption still lands correctly (the torn blob doesn't wedge the slot)", async () => {
    await indexedDbSaveBackend.write("slot-1", saveJson(10));
    await writeBlob("slot-1", saveJson(999)); // torn, per above
    await indexedDbSaveBackend.write("slot-1", saveJson(30)); // a real, complete write

    expect(await indexedDbSaveBackend.read("slot-1")).toBe(saveJson(30));
  });
});

// Proves 2: listing never parses save blobs — proven by making any blob-store read during list()
// throw (a structural proof, not a timing guess), then separately confirmed at the size class saves
// actually run at (spec §5: 5.8–13 MB).
describe("indexedDbSaveBackend — Proves 2: listing never opens the blob store", () => {
  it("list() never reads the blob store — a blob-store read during list() is made to throw", async () => {
    await indexedDbSaveBackend.write("slot-1", saveJson(10));
    await indexedDbSaveBackend.write("slot-2", saveJson(20));

    const originalGet = IDBObjectStore.prototype.get;
    vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore["get"]>
    ) {
      if (this.name === "blobs") {
        throw new Error("list() must never read the blob store");
      }
      return originalGet.apply(this, args);
    });

    const saves = await indexedDbSaveBackend.list();
    expect(saves.map((s) => s.name).sort()).toEqual(["slot-1", "slot-2"]);
  });

  it("list() cost does not grow with a multi-MB save's blob size (informational timing floor)", async () => {
    await indexedDbSaveBackend.write("small-save", saveJson(1));
    const smallStart = performance.now();
    await indexedDbSaveBackend.list();
    const smallElapsed = performance.now() - smallStart;

    const bigJson = saveJson(2) + "x".repeat(8 * 1024 * 1024); // ~8 MB — spec §5's real save size class
    await indexedDbSaveBackend.write("big-save", bigJson);
    const bigStart = performance.now();
    await indexedDbSaveBackend.list();
    const bigElapsed = performance.now() - bigStart;

    // Generous bound (not "equal") — asserts listing isn't proportional to blob size; timing
    // assertions are inherently noisy, so this is a floor, with the structural proof above as the
    // load-bearing one.
    expect(bigElapsed).toBeLessThan(Math.max(smallElapsed * 10, 200));
  });
});

// Proves 3 (this layer's half — see lib/world/__tests__/tick-loop.test.ts for the autosave-channel
// half): a quota-like failure from the underlying IndexedDB write is never swallowed — it rejects
// the returned promise with a real error a caller (TickLoop.autosave) can catch and surface.
describe("indexedDbSaveBackend — Proves 3: a write failure is never swallowed", () => {
  it("write() rejects when the underlying blob-store put throws a quota error — not caught, not resolved", async () => {
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });

    await expect(indexedDbSaveBackend.write("slot-1", saveJson(1))).rejects.toThrow(/quota/i);
  });
});
