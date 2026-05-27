import { describe, it, expect } from "vitest";
import { deriveFactionStatus } from "@/lib/types/guards";

// Default-scale universe is 600 systems; thresholds (% of total) at this
// scale match the prior absolute values: 80/40/15/1.
const DEFAULT_TOTAL = 600;

describe("deriveFactionStatus — gain thresholds (no prior status) at default scale", () => {
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
    it(`size ${size} / 600 → ${expected}`, () => {
      expect(deriveFactionStatus(size, DEFAULT_TOTAL)).toBe(expected);
    });
  }
});

describe("deriveFactionStatus — hysteresis (with prior status) at default scale", () => {
  it("dominant stays dominant down to 60 systems", () => {
    expect(deriveFactionStatus(70, DEFAULT_TOTAL, "dominant")).toBe("dominant");
    expect(deriveFactionStatus(60, DEFAULT_TOTAL, "dominant")).toBe("dominant");
  });

  it("dominant demotes when territory drops below 60", () => {
    expect(deriveFactionStatus(59, DEFAULT_TOTAL, "dominant")).toBe("major");
    expect(deriveFactionStatus(50, DEFAULT_TOTAL, "dominant")).toBe("major");
  });

  it("major stays major down to 25 systems", () => {
    expect(deriveFactionStatus(30, DEFAULT_TOTAL, "major")).toBe("major");
    expect(deriveFactionStatus(25, DEFAULT_TOTAL, "major")).toBe("major");
  });

  it("major demotes to regional when territory drops below 25", () => {
    expect(deriveFactionStatus(24, DEFAULT_TOTAL, "major")).toBe("regional");
  });

  it("regional stays regional down to 10 systems", () => {
    expect(deriveFactionStatus(12, DEFAULT_TOTAL, "regional")).toBe("regional");
    expect(deriveFactionStatus(10, DEFAULT_TOTAL, "regional")).toBe("regional");
  });

  it("regional demotes to minor when territory drops below 10", () => {
    expect(deriveFactionStatus(9, DEFAULT_TOTAL, "regional")).toBe("minor");
  });

  it("promotes from a lower tier when territory crosses the higher tier's gain threshold", () => {
    expect(deriveFactionStatus(40, DEFAULT_TOTAL, "regional")).toBe("major");
    expect(deriveFactionStatus(80, DEFAULT_TOTAL, "major")).toBe("dominant");
    expect(deriveFactionStatus(15, DEFAULT_TOTAL, "minor")).toBe("regional");
  });

  it("zero territory always returns minor regardless of prior status", () => {
    expect(deriveFactionStatus(0, DEFAULT_TOTAL, "dominant")).toBe("minor");
    expect(deriveFactionStatus(0, DEFAULT_TOTAL, "major")).toBe("minor");
  });
});

// Regression for the original bug: at 10k scale, absolute thresholds put
// every faction with >80 systems into "dominant" — including 90-system
// minors and 1200-system giants. With percentage-of-pool thresholds the
// giants stand alone in dominant and small holdouts demote correctly.
describe("deriveFactionStatus — 10k-scale spread", () => {
  const TOTAL = 7500; // user's reported actual count for the 10k preset

  it("a 1200-system faction is dominant (16% of pool)", () => {
    expect(deriveFactionStatus(1200, TOTAL)).toBe("dominant");
  });

  it("a 600-system faction is major (8% of pool)", () => {
    expect(deriveFactionStatus(600, TOTAL)).toBe("major");
  });

  it("a 250-system faction is regional (3.3% of pool)", () => {
    expect(deriveFactionStatus(250, TOTAL)).toBe("regional");
  });

  it("a 90-system faction is minor (1.2% of pool — below regional 2.5%)", () => {
    expect(deriveFactionStatus(90, TOTAL)).toBe("minor");
  });

  it("totalSystems=0 defensively returns minor (no division-by-zero)", () => {
    expect(deriveFactionStatus(100, 0)).toBe("minor");
  });
});
