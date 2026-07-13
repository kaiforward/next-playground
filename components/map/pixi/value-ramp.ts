export type ValueMode = "population" | "development" | "stability";

type Stop = readonly [number, readonly [number, number, number]];

// Black (ABSENT) means "nothing here" — no system / no data / out of sensor range. Absence is decided
// by the CONSUMER (a cell missing from the value map is black); the ramps below only cover a mode's
// PRESENT range. population/development additionally reserve black for a literal 0 (0 people / 0
// development = nothing built). stability does NOT: every present system has a stability, and 0
// (maximal unrest) rides the red floor, not black. Population is the classic red→amber→green heat ramp
// (green = most); stability runs red (unstable) → teal → cyan (calm); development rides a grey floor →
// warm hue. Stops are [t, [r,g,b]] with t ascending 0..1.
const ABSENT = 0x08090c;
const RAMPS: Record<ValueMode, readonly Stop[]> = {
  population: [[0, [239, 68, 68]], [0.5, [245, 158, 11]], [1, [34, 197, 94]]], // red → amber → green
  development: [[0, [80, 84, 92]], [0.5, [158, 74, 44]], [1, [224, 132, 95]]], // grey floor → warm hue
  stability: [[0, [239, 68, 68]], [0.5, [26, 120, 140]], [1, [103, 232, 249]]], // red (unstable) → teal → cyan (calm)
};

// Modes where a literal 0 means "nothing" and is drawn black (rather than the ramp floor). Stability is
// excluded — its 0 is "maximally unstable", a real state that rides the red floor.
const RESERVES_ABSENT_ZERO: Record<ValueMode, boolean> = {
  population: true,
  development: true,
  stability: false,
};

function pack(c: readonly [number, number, number]): number {
  return (c[0] << 16) | (c[1] << 8) | c[2];
}
function sample(stops: readonly Stop[], t: number): number {
  const c = Math.max(0, Math.min(1, t));
  for (let i = 1; i < stops.length; i++) {
    if (c <= stops[i][0]) {
      const [p0, c0] = stops[i - 1];
      const [p1, c1] = stops[i];
      const f = (c - p0) / (p1 - p0 || 1);
      return pack([
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ]);
    }
  }
  return pack(stops[stops.length - 1][1]);
}

/**
 * Colour for a PRESENT system's value. pop/development reserve black for a literal 0 (nothing built);
 * stability (and any non-reserving mode) rides its floor at 0. Absent systems are handled by the caller
 * (they never reach here). Normalised to referenceMax.
 */
export function valueRampColorPixi(value: number, referenceMax: number, mode: ValueMode): number {
  if (RESERVES_ABSENT_ZERO[mode] && !(value > 0)) return ABSENT;
  const v = value > 0 ? value : 0;
  const max = referenceMax > 0 ? referenceMax : 1;
  return sample(RAMPS[mode], v / max);
}
export function rampFloorPixi(mode: ValueMode): number { return pack(RAMPS[mode][0][1]); }
export function rampTopPixi(mode: ValueMode): number { return pack(RAMPS[mode][RAMPS[mode].length - 1][1]); }
export const ABSENT_COLOR = ABSENT;

/**
 * CSS `rgb(...)` stops (low→high) for a mode's ramp — the single source the map
 * legend renders from, so the legend swatch can never drift from the cell fill.
 */
export function rampCssStops(mode: ValueMode): string[] {
  return RAMPS[mode].map(([, [r, g, b]]) => `rgb(${r}, ${g}, ${b})`);
}

/** CSS colour for the reserved "no value / absent" fill (value 0). */
export const ABSENT_CSS = "#08090c";
