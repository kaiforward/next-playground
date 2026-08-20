import { describe, it, expect } from "vitest";
import {
  DEV_RELOAD_MARKER_KEY,
  markPendingDevReload,
  consumePendingDevReload,
} from "@/client/dev-reload-marker";

/** A trivial in-memory `Storage`-shaped fake — no real `sessionStorage`/DOM needed for the pure
 *  consume-once logic under test (this file runs in the `unit`/node project, not `component`). */
function createFakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

describe("markPendingDevReload / consumePendingDevReload — consume-once marker", () => {
  it("consumePendingDevReload returns false and reads nothing when no marker was ever set", () => {
    const storage = createFakeStorage();
    expect(consumePendingDevReload(storage)).toBe(false);
  });

  it("a marked storage is consumed exactly once — the second consume sees nothing", () => {
    const storage = createFakeStorage();
    markPendingDevReload(storage);

    expect(consumePendingDevReload(storage)).toBe(true);
    // Consumed: a later boot with no HMR reload involved must never find it again.
    expect(consumePendingDevReload(storage)).toBe(false);
  });

  it("writes under the documented key, not an incidental one", () => {
    const storage = createFakeStorage();
    markPendingDevReload(storage);
    expect(storage.getItem(DEV_RELOAD_MARKER_KEY)).not.toBeNull();
  });
});
