import { describe, it, expect } from "vitest";
import { claimSystemSchema } from "@/lib/schemas/claims";

describe("claim schema", () => {
  it("accepts a non-empty systemId and rejects an empty one", () => {
    expect(claimSystemSchema.safeParse({ systemId: "sys-1" }).success).toBe(true);
    expect(claimSystemSchema.safeParse({ systemId: "" }).success).toBe(false);
    expect(claimSystemSchema.safeParse({}).success).toBe(false);
  });
});
