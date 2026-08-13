import { describe, it, expect } from "vitest";
import { pinSchema } from "@/lib/schemas/player-pins";

describe("pinSchema", () => {
  it("accepts a valid pin and unpin body", () => {
    expect(pinSchema.safeParse({ systemId: "system-1", pinned: true }).success).toBe(true);
    expect(pinSchema.safeParse({ systemId: "system-1", pinned: false }).success).toBe(true);
  });

  it("rejects a body with a missing pinned field", () => {
    expect(pinSchema.safeParse({ systemId: "system-1" }).success).toBe(false);
  });

  it("rejects a body with a non-boolean pinned field", () => {
    expect(pinSchema.safeParse({ systemId: "system-1", pinned: "true" }).success).toBe(false);
  });

  it("rejects a body with a missing systemId", () => {
    expect(pinSchema.safeParse({ pinned: true }).success).toBe(false);
  });

  it("rejects an empty systemId", () => {
    expect(pinSchema.safeParse({ systemId: "", pinned: true }).success).toBe(false);
  });

  it("accepts a systemId at the 64-character bound", () => {
    expect(pinSchema.safeParse({ systemId: "s".repeat(64), pinned: true }).success).toBe(true);
  });

  it("rejects a systemId past the 64-character bound", () => {
    expect(pinSchema.safeParse({ systemId: "s".repeat(65), pinned: true }).success).toBe(false);
  });
});
