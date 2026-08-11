import { describe, expect, it, vi } from "vitest";
import {
  bandLabel,
  bandTone,
  provisionScaleSegments,
  provisionTrackTone,
  occupancyBar,
  BAND_LABEL,
  BAND_TONE,
} from "@/components/system/provision-view";
import { SUPPLIED_PROVISION, RATIONING_PROVISION, DEPRIVED_PROVISION } from "@/lib/constants/economy";
import { POPULATION_PARAMS } from "@/lib/constants/population";
import { crowdFactor, type SupplyRegime } from "@/lib/engine/population";

describe("bandLabel / bandTone", () => {
  it("labels the five band words, and 'Strained' is the shipped word, not 'Low reserve'", () => {
    expect(bandLabel("supplied")).toBe("Supplied");
    expect(bandLabel("strained")).toBe("Strained");
    expect(bandLabel("rationing")).toBe("Rationing");
    expect(bandLabel("deprived")).toBe("Deprived");
    expect(bandLabel("famine")).toBe("Famine");
  });

  it("names the survival punch-through Famine, never a milder scarcity word", () => {
    // The word is the mechanic: water or food below the survival line. "Shortage" reads as a deeper
    // Rationing, and a player scanning band chips would rank it under Deprived rather than above it.
    // A rename back to any of the axis's own scarcity vocabulary fails here.
    expect(bandLabel("famine")).toBe("Famine");
    for (const milder of ["Shortage", "Rationing", "Deprived", "Strained", "Short"]) {
      expect(bandLabel("famine")).not.toBe(milder);
    }
  });

  it("every band has a tone, and famine alone escalates to red", () => {
    expect(bandTone("supplied")).toBe("green");
    expect(bandTone("famine")).toBe("red");
    // Every SupplyRegime key has an entry — no band falls through to undefined.
    expect(Object.keys(BAND_LABEL).sort()).toEqual(["deprived", "famine", "rationing", "strained", "supplied"]);
    expect(Object.keys(BAND_TONE).sort()).toEqual(["deprived", "famine", "rationing", "strained", "supplied"]);
  });

  it("gives every band its own tone, so the chip cannot collapse states the stepped map paints apart", () => {
    // The Provisioned map mode is a stepped choropleth with one colour per band. A chip that reused
    // a tone across two bands would disagree with the map about how many states exist — the exact
    // class of UI-contradicting-the-simulation the presentation contract exists to remove. This is
    // an invariant, not a palette preference: it must fail if any two bands are ever given the same
    // colour, whichever pair.
    const tones = Object.values(BAND_TONE);
    expect(new Set(tones).size).toBe(tones.length);
  });
});

describe("provisionScaleSegments", () => {
  it("widths sum to 100 and match today's three Provision edges", () => {
    const byBand = Object.fromEntries(provisionScaleSegments().map((s) => [s.band, s.width]));
    expect(byBand.deprived).toBeCloseTo(DEPRIVED_PROVISION * 100, 6);
    expect(byBand.rationing).toBeCloseTo((RATIONING_PROVISION - DEPRIVED_PROVISION) * 100, 6);
    expect(byBand.strained).toBeCloseTo((SUPPLIED_PROVISION - RATIONING_PROVISION) * 100, 6);
    expect(byBand.supplied).toBeCloseTo((1 - SUPPLIED_PROVISION) * 100, 6);
    // Famine owns no span of the Provision axis — it is a punch-through the chip carries,
    // so the track must not offer it a segment at all (not even a zero-width one).
    expect(Object.keys(byBand).sort()).toEqual(["deprived", "rationing", "strained", "supplied"]);
    const total = provisionScaleSegments().reduce((sum, s) => sum + s.width, 0);
    expect(total).toBeCloseTo(100, 6);
  });

  it("orders the segments left-to-right by ascending Provision, so a raw-percentage rule lands in its own band", () => {
    // The rules are positioned at `left: pct%` against the whole track, not per segment. If the
    // segments were emitted in any other order the geometry would still sum to 100 and every width
    // assertion above would still pass, while a 20%-Provisioned world's rule drew inside the green
    // Supplied block. Only the ORDER catches that.
    expect(provisionScaleSegments().map((s) => s.band)).toEqual(["deprived", "rationing", "strained", "supplied"]);
  });

  // Proof 1: the widths must be DERIVED from the band constants, not authored twice. Hardcoding the
  // widths to today's values (50/20/20/10) would pass the tests above too — it only proves derivation
  // if the widths actually track a change in the constants, which requires moving them.
  it("segment widths move when the band constants move, rather than being authored twice", async () => {
    vi.resetModules();
    vi.doMock("@/lib/constants/economy", () => ({
      SUPPLIED_PROVISION: 0.8, RATIONING_PROVISION: 0.3, DEPRIVED_PROVISION: 0.1,
    }));
    try {
      const { provisionScaleSegments: segmentsWithMovedConstants } = await import("@/components/system/provision-view");
      const byBand = Object.fromEntries(segmentsWithMovedConstants().map((s) => [s.band, s.width]));
      expect(byBand.deprived).toBeCloseTo(10, 6);
      expect(byBand.rationing).toBeCloseTo(20, 6);
      expect(byBand.strained).toBeCloseTo(50, 6);
      expect(byBand.supplied).toBeCloseTo(20, 6);
      // Famine owns no span of the Provision axis — it is a punch-through the chip carries,
      // so the track must not offer it a segment at all (not even a zero-width one).
      expect(Object.keys(byBand).sort()).toEqual(["deprived", "rationing", "strained", "supplied"]);
    } finally {
      vi.doUnmock("@/lib/constants/economy");
      vi.resetModules();
    }
  });
});

describe("provisionTrackTone — the track and the chip cannot disagree", () => {
  const axisBands = ["deprived", "rationing", "strained", "supplied"] as const;

  it("paints every segment its own band's tone while the system is not in famine", () => {
    for (const systemBand of axisBands) {
      for (const segment of axisBands) {
        expect(provisionTrackTone(segment, systemBand), `${segment} @ ${systemBand}`).toBe(bandTone(segment));
      }
    }
  });

  it("recolours the WHOLE track to the famine tone when the system is in famine, high Provision included", () => {
    // The contradiction this removes: famine owns no span of the axis, so a famine world's rule sits
    // at its true Provision — which can be anywhere, the Supplied segment included. A per-segment
    // track would then show a green block under the marker while the chip above read Famine. Every
    // segment, not just the one the marker happens to land in, so no reading of the track is calm.
    for (const segment of axisBands) {
      expect(provisionTrackTone(segment, "famine"), segment).toBe(bandTone("famine"));
    }
    // …and that is a real recolour, not a coincidence of the palette: the Supplied segment's own
    // tone is different, so this assertion fails outright if the famine branch is dropped.
    expect(bandTone("supplied")).not.toBe(bandTone("famine"));
  });

  it("reads the famine tone from BAND_TONE rather than re-authoring a colour", () => {
    // A hardcoded "red" would pass every assertion above. Moving the chip's famine tone must move the
    // track's with it, or the two surfaces can drift into disagreeing about the same system again.
    const tone = provisionTrackTone("supplied", "famine");
    expect(tone).toBe(BAND_TONE.famine);
    expect(tone).not.toBe(BAND_TONE.supplied);
  });

  it("never returns a tone outside the band palette, for any (segment, band) pair", () => {
    const palette = new Set(Object.values(BAND_TONE));
    const allBands: SupplyRegime[] = [...axisBands, "famine"];
    for (const systemBand of allBands) {
      for (const segment of axisBands) {
        expect(palette.has(provisionTrackTone(segment, systemBand)), `${segment} @ ${systemBand}`).toBe(true);
      }
    }
  });
});

describe("occupancyBar", () => {
  it("exactly at capacity has no overshoot; above capacity is sized to the excess", () => {
    const atCap = occupancyBar(1000, 1000);
    expect(atCap.fillPct).toBe(100);
    expect(atCap.overshootPct).toBe(0);

    const halfway = occupancyBar(1075, 1000); // r = 1.075, halfway through the 0.15 brake span
    expect(halfway.overshootPct).toBeCloseTo(7.5, 6);

    const further = occupancyBar(1100, 1000); // r = 1.10, further past capacity
    expect(further.overshootPct).toBeGreaterThan(halfway.overshootPct);
  });

  it("stays bounded at or past the growth-brake end rather than overflowing", () => {
    const brakeEnd = POPULATION_PARAMS.crowdBrakeEnd;
    const atBrakeEnd = occupancyBar(1000 * brakeEnd, 1000);
    const wayOver = occupancyBar(50000, 1000); // r = 50, far past the brake end
    const ceiling = (brakeEnd - 1) * 100;
    expect(atBrakeEnd.overshootPct).toBeCloseTo(ceiling, 6);
    expect(wayOver.overshootPct).toBeCloseTo(ceiling, 6);
    expect(atBrakeEnd.crowdChip).toBe("braked");
    expect(wayOver.crowdChip).toBe("braked");
  });

  it("zero or negative capacity produces a defined result, not a division by zero", () => {
    const zeroCapWithResidents = occupancyBar(500, 0);
    expect(zeroCapWithResidents.fillPct).toBe(0);
    expect(Number.isFinite(zeroCapWithResidents.overshootPct)).toBe(true);
    expect(zeroCapWithResidents.overshootPct).toBeGreaterThan(0);
    expect(zeroCapWithResidents.crowdChip).toBe("braked");

    const negativeCap = occupancyBar(500, -50);
    expect(negativeCap.fillPct).toBe(0);
    expect(Number.isFinite(negativeCap.overshootPct)).toBe(true);

    const emptyZeroCap = occupancyBar(0, 0);
    expect(emptyZeroCap.fillPct).toBe(0);
    expect(emptyZeroCap.overshootPct).toBe(0);
  });

  it("the crowding chip's boundaries are exactly crowdFactor's own boundaries, not an invented cut", () => {
    const brakeEnd = POPULATION_PARAMS.crowdBrakeEnd;

    expect(occupancyBar(1000, 1000).crowdChip).toBe("comfortable");
    expect(crowdFactor(1000, 1000, brakeEnd)).toBe(1);

    const justOver = occupancyBar(1001, 1000);
    expect(justOver.crowdChip).toBe("crowding");
    const justOverFactor = crowdFactor(1001, 1000, brakeEnd);
    expect(justOverFactor).toBeLessThan(1);
    expect(justOverFactor).toBeGreaterThan(0);

    const atEnd = occupancyBar(1000 * brakeEnd, 1000);
    expect(atEnd.crowdChip).toBe("braked");
    expect(crowdFactor(1000 * brakeEnd, 1000, brakeEnd)).toBe(0);
  });
});
