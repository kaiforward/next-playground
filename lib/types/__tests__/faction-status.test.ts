import { describe, it, expect } from "vitest";
import { deriveFactionStatus } from "@/lib/types/guards";

describe("deriveFactionStatus — gain thresholds (no prior status)", () => {
  const cases: ReadonlyArray<[number, string]> = [
    [0, "minor"],
    [1, "minor"],
    [14, "minor"],
    [15, "regional"],
    [39, "regional"],
    [40, "major"],
    [79, "major"],
    [80, "dominant"],
    [500, "dominant"],
  ];

  for (const [size, expected] of cases) {
    it(`size ${size} → ${expected}`, () => {
      expect(deriveFactionStatus(size)).toBe(expected);
    });
  }
});

describe("deriveFactionStatus — hysteresis (with prior status)", () => {
  it("dominant stays dominant down to 60 systems", () => {
    expect(deriveFactionStatus(70, "dominant")).toBe("dominant");
    expect(deriveFactionStatus(60, "dominant")).toBe("dominant");
  });

  it("dominant demotes when territory drops below 60", () => {
    expect(deriveFactionStatus(59, "dominant")).toBe("major");
    expect(deriveFactionStatus(50, "dominant")).toBe("major");
  });

  it("major stays major down to 25 systems", () => {
    expect(deriveFactionStatus(30, "major")).toBe("major");
    expect(deriveFactionStatus(25, "major")).toBe("major");
  });

  it("major demotes to regional when territory drops below 25", () => {
    expect(deriveFactionStatus(24, "major")).toBe("regional");
  });

  it("regional stays regional down to 10 systems", () => {
    expect(deriveFactionStatus(12, "regional")).toBe("regional");
    expect(deriveFactionStatus(10, "regional")).toBe("regional");
  });

  it("regional demotes to minor when territory drops below 10", () => {
    expect(deriveFactionStatus(9, "regional")).toBe("minor");
  });

  it("promotes from a lower tier when territory crosses the higher tier's gain threshold", () => {
    expect(deriveFactionStatus(40, "regional")).toBe("major");
    expect(deriveFactionStatus(80, "major")).toBe("dominant");
    expect(deriveFactionStatus(15, "minor")).toBe("regional");
  });

  it("zero territory always returns minor regardless of prior status", () => {
    expect(deriveFactionStatus(0, "dominant")).toBe("minor");
    expect(deriveFactionStatus(0, "major")).toBe("minor");
  });
});
