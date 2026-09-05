import { describe, it, expect } from "vitest";
import { laneBand, worstLaneBand, laneBandIndex, laneBandCss, LANE_BANDS, type LaneBand } from "../lane-band";
import { LANE_BUSY_LOAD_FRACTION, LANE_BAND_COLOR } from "../../theme";
import { pixiHexToCss } from "@/lib/constants/good-colors";

describe("laneBand", () => {
  it("is congested when blocked, whatever the load, including load 0", () => {
    expect(laneBand({ load: 0, blocked: true })).toBe("congested");
    expect(laneBand({ load: 1, blocked: true })).toBe("congested");
  });

  it("is busy at exactly the busy fraction", () => {
    expect(laneBand({ load: LANE_BUSY_LOAD_FRACTION, blocked: false })).toBe("busy");
  });

  it("is fine a hair below the busy fraction", () => {
    expect(laneBand({ load: LANE_BUSY_LOAD_FRACTION - 0.001, blocked: false })).toBe("fine");
  });

  it("stays busy, never congested, for unclamped load above 1", () => {
    expect(laneBand({ load: 1.5, blocked: false })).toBe("busy");
  });
});

describe("worstLaneBand", () => {
  it("takes congested over busy over fine, regardless of input order", () => {
    const orders: LaneBand[][] = [
      ["fine", "busy", "congested"],
      ["congested", "fine", "busy"],
      ["busy", "congested", "fine"],
    ];
    for (const bands of orders) {
      expect(worstLaneBand(bands)).toBe("congested");
    }
  });

  it("returns null, not fine, for an empty input", () => {
    expect(worstLaneBand([])).toBeNull();
  });

  it("picks busy over fine when no lane is congested", () => {
    expect(worstLaneBand(["fine", "busy"])).toBe("busy");
  });
});

describe("laneBandIndex", () => {
  it("orders the bands fine < busy < congested", () => {
    expect(laneBandIndex("fine")).toBe(0);
    expect(laneBandIndex("busy")).toBe(1);
    expect(laneBandIndex("congested")).toBe(2);
    expect(LANE_BANDS).toEqual(["fine", "busy", "congested"]);
  });
});

describe("laneBandCss", () => {
  it("renders each band's theme hex as CSS", () => {
    for (const band of LANE_BANDS) {
      expect(laneBandCss(band)).toBe(pixiHexToCss(LANE_BAND_COLOR[band]));
    }
  });
});
