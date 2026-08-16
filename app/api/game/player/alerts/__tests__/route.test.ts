import { describe, it, expect, afterEach } from "vitest";
import { GET } from "../route";
import { generateWorld } from "@/lib/world/gen";
import { setWorld, clearWorld } from "@/lib/world/store";
import type { AlertResponse } from "@/lib/types/api";

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
    const json = (await res.json()) as AlertResponse;
    expect(json.data).toBeDefined();
    expect(Array.isArray(json.data?.categories)).toBe(true);
  });

  it("surfaces a service error as an error response rather than a partial payload", async () => {
    // No world loaded: getWorld() (the first call inside getAlertData()) throws a real
    // ServiceError("No world loaded", 409) — not mocked, the actual production condition on a
    // fresh server before "New game".
    clearWorld();

    const res = await GET();

    expect(res.status).toBe(409);
    const json = (await res.json()) as AlertResponse;
    expect(json.error).toBe("No world loaded");
    expect(json.data).toBeUndefined();
  });
});
