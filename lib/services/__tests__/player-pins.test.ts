import { describe, it, expect, beforeEach } from "vitest";
import { setWorld, clearWorld, getWorld } from "@/lib/world/store";
import { generateWorld } from "@/lib/world/gen";
import { setSystemPin } from "@/lib/services/player-pins";
import { seatWorld } from "./seat-world";

describe("setSystemPin", () => {
  beforeEach(() => {
    clearWorld();
    setWorld(seatWorld());
  });

  it("pins a system, adding it to the list", () => {
    const systemId = getWorld().systems[0].id;
    const result = setSystemPin({ systemId, pinned: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([systemId]);
    expect(getWorld().player?.pinnedSystemIds).toEqual([systemId]);
  });

  it("pinning an already-pinned system leaves the list unchanged rather than adding a second entry", () => {
    const systemId = getWorld().systems[0].id;
    setSystemPin({ systemId, pinned: true });
    const result = setSystemPin({ systemId, pinned: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([systemId]);
    expect(getWorld().player?.pinnedSystemIds).toEqual([systemId]);
  });

  it("unpinning a system that was never pinned succeeds as a no-op instead of erroring", () => {
    const systemId = getWorld().systems[0].id;
    const result = setSystemPin({ systemId, pinned: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([]);
    expect(getWorld().player?.pinnedSystemIds).toEqual([]);
  });

  it("unpins a pinned system, removing exactly that id", () => {
    const [a, b] = getWorld().systems;
    setSystemPin({ systemId: a.id, pinned: true });
    setSystemPin({ systemId: b.id, pinned: true });
    const result = setSystemPin({ systemId: a.id, pinned: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual([b.id]);
    expect(getWorld().player?.pinnedSystemIds).toEqual([b.id]);
  });

  it("preserves insertion order across multiple pins, not sorted or reversed", () => {
    const [a, b, c] = getWorld().systems;
    setSystemPin({ systemId: c.id, pinned: true });
    setSystemPin({ systemId: a.id, pinned: true });
    setSystemPin({ systemId: b.id, pinned: true });
    expect(getWorld().player?.pinnedSystemIds).toEqual([c.id, a.id, b.id]);
  });

  it("rejects the write on a world with no player seat, returning the discriminated error", () => {
    clearWorld();
    setWorld(generateWorld({ systemCount: 60, seed: 42 })); // no playerFaction => player is null
    expect(getWorld().player).toBeNull();
    const systemId = getWorld().systems[0].id;
    const result = setSystemPin({ systemId, pinned: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("This world has no player seat.");
  });

  it("rejects the write when no world is loaded at all", () => {
    clearWorld();
    const result = setSystemPin({ systemId: "anything", pinned: true });
    expect(result.ok).toBe(false);
  });
});
