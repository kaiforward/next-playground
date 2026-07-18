import { describe, it, expect } from "vitest";
import { saveGameSchema, loadGameSchema, newGameSchema } from "@/lib/schemas/game-setup";
import { AUTOSAVE_NAME } from "@/lib/world/save";

describe("saveGameSchema", () => {
  it("accepts an ordinary save name", () => {
    expect(saveGameSchema.safeParse({ name: "My Save 1" }).success).toBe(true);
  });

  it("rejects a name that sanitizes to empty", () => {
    expect(saveGameSchema.safeParse({ name: "???" }).success).toBe(false);
  });

  it("rejects a name reserved for the autosave slot", () => {
    // "autosave", "AUTOSAVE", "Auto Save" all sanitize to AUTOSAVE_NAME and
    // would otherwise clobber (or be clobbered by) the ambient autosave.
    expect(saveGameSchema.safeParse({ name: AUTOSAVE_NAME }).success).toBe(false);
    expect(saveGameSchema.safeParse({ name: "AUTOSAVE" }).success).toBe(false);
    expect(saveGameSchema.safeParse({ name: "Auto Save" }).success).toBe(false);
  });

  it("rejects a name longer than 40 characters", () => {
    expect(saveGameSchema.safeParse({ name: "a".repeat(41) }).success).toBe(false);
  });
});

describe("loadGameSchema", () => {
  it("accepts a normal save name, including the autosave slot", () => {
    expect(loadGameSchema.safeParse({ name: "roundtrip" }).success).toBe(true);
    // Loading the autosave IS legitimate — it's the start screen's "Continue".
    expect(loadGameSchema.safeParse({ name: AUTOSAVE_NAME }).success).toBe(true);
  });

  it("rejects empty / empty-sanitizing names (mirrors saveGameSchema)", () => {
    expect(loadGameSchema.safeParse({ name: "" }).success).toBe(false);
    expect(loadGameSchema.safeParse({ name: "???" }).success).toBe(false);
  });
});

describe("newGameSchema — authored faction", () => {
  const valid = {
    systemCount: 600,
    name: "Aurelian League",
    governmentType: "federation",
    doctrine: "expansionist",
  };

  it("accepts a valid authored faction", () => {
    const r = newGameSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe("Aurelian League");
      expect(r.data.governmentType).toBe("federation");
      expect(r.data.doctrine).toBe("expansionist");
    }
  });

  it("rejects an out-of-set government", () => {
    expect(newGameSchema.safeParse({ ...valid, governmentType: "monarchy" }).success).toBe(false);
  });

  it("rejects an out-of-set doctrine", () => {
    expect(newGameSchema.safeParse({ ...valid, doctrine: "pacifist" }).success).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(newGameSchema.safeParse({ ...valid, name: "   " }).success).toBe(false);
  });
});
