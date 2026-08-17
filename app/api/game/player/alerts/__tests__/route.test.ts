import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "../route";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld, getWorld } from "@/lib/world/store";

describe("GET /api/game/player/alerts", () => {
  afterEach(() => {
    clearWorld();
  });

  it("returns AlertResponse data behind a private, no-cache Cache-Control header", async () => {
    setWorld(generateWorld({ systemCount: 20, seed: 1 }));

    const res = await GET();

    // Never `immutable` or a long max-age — New game replaces the world, so cached ids mismatch
    // (AGENTS.md → Caching / data shapes).
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
    // Asserted against the body the route really serialised, rather than through a type assertion
    // that would claim the shape instead of checking it.
    expect(await res.json()).toMatchObject({ data: { categories: expect.any(Array) } });
  });

  it("surfaces a service error as an error response rather than a partial payload", async () => {
    // No world loaded: getWorld() (the first call inside getAlertData()) throws a real
    // ServiceError("No world loaded", 409) — not mocked, the actual production condition on a
    // fresh server before "New game".
    clearWorld();

    const res = await GET();

    expect(res.status).toBe(409);
    // `toEqual`, not `toMatchObject`: the error body must carry the message and NOTHING else, so a
    // partial payload served alongside the error fails here.
    expect(await res.json()).toEqual({ error: "No world loaded" });
  });
});

/** A seated world — both settings records hang off `world.player`, so a seatless one has nothing to
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
    new NextRequest("http://localhost/api/game/player/alerts", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("POST /api/game/player/alerts", () => {
  afterEach(() => {
    clearWorld();
  });

  it("writes one category flag onto the player seat and answers with the whole record", async () => {
    setWorld(seatWorld());

    const res = await post({ categoryId: "overcrowded", on: false });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.overcrowded).toBe(false);
    // Every other flag comes back too — the client replaces its copy with this, so a partial record
    // would silently blank fifteen categories.
    expect(Object.keys(body.data)).toHaveLength(16);
    expect(getWorld().player?.alertCategories.overcrowded).toBe(false);
  });

  it("rejects an unknown category id at the schema rather than writing a stray key", async () => {
    setWorld(seatWorld());

    const res = await post({ categoryId: "not_a_category", on: false });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown alert category" });
    expect(Object.keys(getWorld().player?.alertCategories ?? {})).toHaveLength(16);
  });

  it("rejects a non-boolean `on`", async () => {
    setWorld(seatWorld());

    const res = await post({ categoryId: "overcrowded", on: "no" });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "on must be a boolean" });
  });

  it("refuses to hide a critical category, leaving it on", async () => {
    setWorld(seatWorld());

    const res = await post({ categoryId: "famine", on: false });

    expect(res.status).toBe(400);
    expect(getWorld().player?.alertCategories.famine).toBe(true);
  });
});
