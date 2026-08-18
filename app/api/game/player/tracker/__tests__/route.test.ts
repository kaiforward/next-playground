import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "../route";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld, getWorld } from "@/lib/world/store";

/** A seated world — `trackerSections` hangs off `world.player`, so a seatless one has nothing to
 *  write to. */
function seatWorld() {
  return generateWorld({
    systemCount: 20,
    seed: 1,
    playerFaction: { name: "Test Seat", governmentType: "federation", doctrine: "mercantile" },
  });
}

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/game/player/tracker", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("GET /api/game/player/tracker", () => {
  afterEach(() => {
    clearWorld();
  });

  it("returns TrackerResponse data, sections included, behind a private, no-cache header", async () => {
    setWorld(seatWorld());

    const res = await GET();

    // AGENTS.md → Caching / data shapes states why this header and no other.
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
    // The sections ride this payload rather than having a read of their own; both panels index the
    // record directly, so it must be present and complete, not merely well-typed.
    expect(await res.json()).toMatchObject({
      data: { sections: { pinned: true, building: true, colonising: true } },
    });
  });

  it("surfaces a service error as an error response rather than a partial payload", async () => {
    clearWorld();

    const res = await GET();

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "No world loaded" });
  });
});

describe("POST /api/game/player/tracker", () => {
  afterEach(() => {
    clearWorld();
  });

  it("writes one section flag onto the player seat and answers with the whole record", async () => {
    setWorld(seatWorld());

    const res = await post({ section: "building", on: false });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { pinned: true, building: false, colonising: true },
    });
    expect(getWorld().player?.trackerSections.building).toBe(false);
  });

  it("rejects an unknown section key at the schema rather than writing a stray key", async () => {
    setWorld(seatWorld());

    const res = await post({ section: "not_a_section", on: false });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown Tracker section" });
    expect(Object.keys(getWorld().player?.trackerSections ?? {})).toHaveLength(3);
  });

  it("rejects a non-boolean `on`", async () => {
    setWorld(seatWorld());

    const res = await post({ section: "building", on: 1 });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "on must be a boolean" });
  });

  it("answers a service error as a 400 rather than throwing, on a world with no player seat", async () => {
    setWorld(generateWorld({ systemCount: 20, seed: 1 }));

    const res = await post({ section: "building", on: false });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "This world has no player seat." });
  });
});
