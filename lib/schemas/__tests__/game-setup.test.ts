import { describe, it, expect } from "vitest";
import {
  saveGameSchema,
  loadGameSchema,
  newGameSchema,
  exportSaveSchema,
  importSaveSchema,
  galaxyShapeSchema,
} from "@/lib/schemas/game-setup";
import { AUTOSAVE_NAME } from "@/lib/world/save";

describe("saveGameSchema", () => {
  it("accepts an ordinary save name", () => {
    expect(saveGameSchema.safeParse({ name: "My Save 1" }).success).toBe(true);
  });

  it("rejects a name that sanitises to empty", () => {
    expect(saveGameSchema.safeParse({ name: "???" }).success).toBe(false);
  });

  it("rejects a name reserved for the autosave slot", () => {
    // "autosave", "AUTOSAVE", "Auto Save" all sanitise to AUTOSAVE_NAME and
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

  it("rejects empty / empty-sanitising names (mirrors saveGameSchema)", () => {
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

  it("rejects an overlong name (over the 40-char bound)", () => {
    expect(newGameSchema.safeParse({ ...valid, name: "x".repeat(41) }).success).toBe(false);
  });
});

describe("newGameSchema — shape (galaxy structure knobs)", () => {
  const valid = {
    systemCount: 600,
    name: "Aurelian League",
    governmentType: "federation",
    doctrine: "expansionist",
  };

  it("accepts an omitted shape — every knob is optional", () => {
    const r = newGameSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.shape).toBeUndefined();
  });

  it("accepts a fully-specified shape at the edges of every clamp", () => {
    const shape = {
      clusterCount: 100,
      sizeSkew: 1,
      clusterSpacing: 2000,
      voidFloor: 0.9,
      corridorsPerCluster: 2,
      corridorStyle: 1,
      clusterTurbulence: 1,
      starSpacing: 1.5,
      clusterTightness: 1,
      mapSizeScale: 2,
    };
    const r = newGameSchema.safeParse({ ...valid, shape });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.shape).toEqual(shape);
  });

  it("accepts a shape with only one knob set — the rest stay undefined, not defaulted here", () => {
    const r = newGameSchema.safeParse({ ...valid, shape: { clusterCount: 40 } });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.shape).toEqual({ clusterCount: 40 });
      expect(r.data.shape?.starSpacing).toBeUndefined();
    }
  });

  it.each([
    ["clusterCount", 0],
    ["clusterCount", 101],
    ["sizeSkew", -0.01],
    ["sizeSkew", 1.01],
    ["clusterSpacing", 99],
    ["clusterSpacing", 4001],
    ["voidFloor", -0.01],
    ["voidFloor", 1.0], // 1.0 would be all-void — explicitly rejected, not just "out of range"
    ["corridorsPerCluster", -0.01],
    ["corridorsPerCluster", 2.01],
    ["corridorStyle", -0.01],
    ["corridorStyle", 1.01],
    ["clusterTurbulence", -0.01],
    ["clusterTurbulence", 1.01],
    ["starSpacing", 0.19],
    ["starSpacing", 1.51],
    ["clusterTightness", -0.01],
    ["clusterTightness", 1.01],
    ["mapSizeScale", 0.49],
    ["mapSizeScale", 2.01],
  ])("rejects %s out of clamp range (%p) at the schema, naming the field", (field, value) => {
    const r = newGameSchema.safeParse({ ...valid, shape: { [field]: value } });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((issue) => issue.path.includes(field))).toBe(true);
    }
  });

  it("galaxyShapeSchema alone accepts an empty object (every knob optional)", () => {
    expect(galaxyShapeSchema.safeParse({}).success).toBe(true);
  });
});

describe("exportSaveSchema", () => {
  it("accepts any existing save name, including the autosave slot", () => {
    expect(exportSaveSchema.safeParse({ name: "roundtrip" }).success).toBe(true);
    expect(exportSaveSchema.safeParse({ name: AUTOSAVE_NAME }).success).toBe(true);
  });

  it("rejects a name that sanitises to empty", () => {
    expect(exportSaveSchema.safeParse({ name: "???" }).success).toBe(false);
  });
});

describe("importSaveSchema", () => {
  it("accepts a normal name plus non-empty json", () => {
    expect(importSaveSchema.safeParse({ name: "imported", json: "{}" }).success).toBe(true);
  });

  it("rejects an empty json payload", () => {
    expect(importSaveSchema.safeParse({ name: "imported", json: "" }).success).toBe(false);
  });

  it("rejects a name reserved for the autosave slot (mirrors saveGameSchema)", () => {
    expect(importSaveSchema.safeParse({ name: AUTOSAVE_NAME, json: "{}" }).success).toBe(false);
  });
});
