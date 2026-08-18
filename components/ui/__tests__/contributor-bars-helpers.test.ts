import { describe, it, expect } from "vitest";
import {
  contributorBarWidths,
  type Contributor,
} from "@/components/ui/contributor-bars-helpers";

const contributor = (label: string, value: number): Contributor => ({
  label,
  value,
  color: `${label}-color`,
});

describe("contributorBarWidths", () => {
  it("measures every contributor against the shared scale", () => {
    const widths = contributorBarWidths(
      [contributor("Goods shortfall", 0.4), contributor("Tax pressure", 0.1), contributor("Crowding", 0.05)],
      1,
    );
    expect(widths.map((w) => w.barPct)).toEqual([40, 10, 5]);
    expect(widths.map((w) => w.pct)).toEqual([40, 10, 5]);
  });

  it("clamps the BAR at the track's limit while the reading keeps its true value", () => {
    // The distinction the component exists for: a contributor at 2.4x the scale fills its bar
    // completely but still reads 240%, so it cannot be mistaken for one sitting at the ceiling.
    const [only] = contributorBarWidths([contributor("Goods shortfall", 2.4)], 1);
    expect(only.barPct).toBe(100);
    expect(only.pct).toBe(240);
  });

  it("a total of zero gives every contributor 0% rather than dividing by zero", () => {
    const widths = contributorBarWidths([contributor("A", 0.5), contributor("B", 0)], 0);
    for (const w of widths) {
      expect(w.pct).toBe(0);
      expect(w.barPct).toBe(0);
      expect(Number.isFinite(w.pct)).toBe(true);
    }
  });

  it("a negative total is treated as no scale at all, not as an inverted one", () => {
    // Guarded with `total > 0`, not `total !== 0`: a negative scale would otherwise flip every
    // bar's sign and clamp them all to 0 anyway, but by a route that reads as arithmetic.
    expect(contributorBarWidths([contributor("A", 0.5)], -1)[0].pct).toBe(0);
  });

  it("carries each contributor's label and colour through untouched", () => {
    const [only] = contributorBarWidths([contributor("Crowding", 0.25)], 1);
    expect(only.label).toBe("Crowding");
    expect(only.color).toBe("Crowding-color");
  });
});
