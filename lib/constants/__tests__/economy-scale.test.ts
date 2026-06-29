import { describe, it, expect } from "vitest";
import {
  toEconomyScale,
  ECONOMY_SCALE,
  scaleValue,
  scaleRecord,
} from "@/lib/constants/economy-scale";

describe("toEconomyScale", () => {
  it("parses positive finite numbers", () => {
    expect(toEconomyScale("1")).toBe(1);
    expect(toEconomyScale("10")).toBe(10);
    expect(toEconomyScale("2.5")).toBe(2.5);
  });

  it("rejects non-positive, non-finite, and non-numeric values", () => {
    expect(() => toEconomyScale("0")).toThrow();
    expect(() => toEconomyScale("-1")).toThrow();
    expect(() => toEconomyScale("abc")).toThrow();
    expect(() => toEconomyScale("Infinity")).toThrow();
    expect(() => toEconomyScale("NaN")).toThrow();
    expect(() => toEconomyScale("")).toThrow();
  });
});

describe("scale helpers at default scale (S = 1)", () => {
  it("defaults ECONOMY_SCALE to 1 when the env var is unset", () => {
    expect(ECONOMY_SCALE).toBe(1);
  });

  it("scaleValue is identity at S = 1", () => {
    expect(scaleValue(8)).toBe(8);
    expect(scaleValue(0.5)).toBe(0.5);
  });

  it("scaleRecord maps every value and preserves keys at S = 1", () => {
    expect(scaleRecord({ a: 2, b: 3 })).toEqual({ a: 2, b: 3 });
  });
});
