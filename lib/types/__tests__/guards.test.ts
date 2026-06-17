import { describe, it, expect } from "vitest";
import {
  isSunClass, toSunClass,
  isBodyArchetypeId, toBodyArchetypeId,
  isRichnessModifierId, toRichnessModifierId,
} from "../guards";

describe("isSunClass / toSunClass", () => {
  it("accepts catalog sun classes", () => {
    expect(isSunClass("yellow")).toBe(true);
    expect(isSunClass("red_dwarf")).toBe(true);
    expect(toSunClass("blue_white")).toBe("blue_white");
  });
  it("rejects unknown values", () => {
    expect(isSunClass("green")).toBe(false);
    expect(isSunClass("")).toBe(false);
    expect(() => toSunClass("green")).toThrow();
  });
});

describe("isBodyArchetypeId / toBodyArchetypeId", () => {
  it("accepts catalog archetypes", () => {
    expect(isBodyArchetypeId("garden_world")).toBe(true);
    expect(toBodyArchetypeId("asteroid_belt")).toBe("asteroid_belt");
  });
  it("rejects unknown values", () => {
    expect(isBodyArchetypeId("moon")).toBe(false);
    expect(() => toBodyArchetypeId("moon")).toThrow();
  });
});

describe("isRichnessModifierId / toRichnessModifierId", () => {
  it("accepts catalog richness ids", () => {
    expect(isRichnessModifierId("fertile_soil")).toBe(true);
    expect(toRichnessModifierId("helium3")).toBe("helium3");
  });
  it("rejects unknown values", () => {
    expect(isRichnessModifierId("magic_dust")).toBe(false);
    expect(() => toRichnessModifierId("magic_dust")).toThrow();
  });
});
