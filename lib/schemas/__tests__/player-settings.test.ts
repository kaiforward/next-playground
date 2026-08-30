import { describe, it, expect } from "vitest";
import { alertCategorySchema, trackerSectionSchema } from "@/lib/schemas/player-settings";

describe("alertCategorySchema", () => {
  it("accepts a live category id", () => {
    expect(alertCategorySchema.safeParse({ categoryId: "overcrowded", on: false }).success).toBe(true);
  });

  // The write boundary's own defence against a removed category id: `z.enum(ALERT_CATEGORY_IDS)`
  // shrinks with the array, so a category the events strip deleted (crisis / disruption / windfall)
  // is rejected here rather than reaching the service at all.
  it("rejects a category id the events strip removed", () => {
    expect(alertCategorySchema.safeParse({ categoryId: "crisis", on: true }).success).toBe(false);
    expect(alertCategorySchema.safeParse({ categoryId: "disruption", on: true }).success).toBe(false);
    expect(alertCategorySchema.safeParse({ categoryId: "windfall", on: true }).success).toBe(false);
  });

  it("rejects a body with a non-boolean on field", () => {
    expect(alertCategorySchema.safeParse({ categoryId: "overcrowded", on: "false" }).success).toBe(false);
  });
});

describe("trackerSectionSchema", () => {
  it("accepts a live section", () => {
    expect(trackerSectionSchema.safeParse({ section: "building", on: false }).success).toBe(true);
  });

  it("rejects an unknown section", () => {
    expect(trackerSectionSchema.safeParse({ section: "nonexistent", on: false }).success).toBe(false);
  });
});
