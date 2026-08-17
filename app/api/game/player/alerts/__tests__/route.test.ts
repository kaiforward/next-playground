import { describe, it, expect, afterEach } from "vitest";
import { GET } from "../route";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";

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
