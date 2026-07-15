export type ValueMode = "population" | "development" | "stability" | "migration";

type Stop = readonly [number, readonly [number, number, number]];

// Black (ABSENT) means "nothing here" — no system / no data / out of sensor range. Absence is decided
// by the CONSUMER (a cell missing from the value map is black); the ramps below only cover a mode's
// PRESENT range. population additionally reserves black for a literal 0 (0 people = nothing there).
// stability/migration do NOT: every present (developed) system has a real value there, and its
// floor (maximal unrest / least attractive) rides the red end of the ramp, not black —
// absence is reserved for undeveloped/marketless systems, decided by the caller. Population and
// migration share one two-pole red→green ramp (green = most/best) — a single value-mode colour language;
// stability runs red (unstable) → teal → cyan (calm); development rides a grey floor → warm hue. Stops
// are [t, [r,g,b]] with t ascending 0..1.
const ABSENT = 0x08090c;
const RAMPS: Record<ValueMode, readonly Stop[]> = {
  population: [[0, [239, 68, 68]], [1, [34, 197, 94]]], // red → green
  development: [[0, [80, 84, 92]], [0.5, [158, 74, 44]], [1, [224, 132, 95]]], // grey floor → warm hue
  stability: [[0, [239, 68, 68]], [0.5, [26, 120, 140]], [1, [103, 232, 249]]], // red (unstable) → teal → cyan (calm)
  migration: [[0, [239, 68, 68]], [1, [34, 197, 94]]], // red → green (attractiveness)
};

// Modes where a literal 0 means "nothing" and is drawn black (rather than the ramp floor). Stability
// and migration are excluded — their 0 (or negative) is a real, present-system value that rides
// the red floor; absence for migration is the developed/market gate, not a literal-0 check.
const RESERVES_ABSENT_ZERO: Record<ValueMode, boolean> = {
  population: true,
  development: true,
  stability: false,
  migration: false,
};

// De-emphasis treatments for out-of-scope cells (faction focus). "desat" mixes each channel toward the
// luminance grey; "dim" multiplies each channel down; "both" applies desat then dim and is the only
// treatment currently wired up by the layer. "hide" (full suppression) is a future toggle, not built.
const DESAT_AMOUNT = 0.6; // 0 = no change, 1 = full grey — calibration knob
const DIM_FACTOR = 0.5; // channel multiplier — calibration knob

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

/** De-emphasis treatments for an out-of-scope cell (faction focus). "both" desaturates then dims. */
export type DeEmphasis = "both" | "dim" | "desat";

function desatChannels(r: number, g: number, b: number): [number, number, number] {
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return [
    r + (lum - r) * DESAT_AMOUNT,
    g + (lum - g) * DESAT_AMOUNT,
    b + (lum - b) * DESAT_AMOUNT,
  ];
}
function dimChannels(r: number, g: number, b: number): [number, number, number] {
  return [r * DIM_FACTOR, g * DIM_FACTOR, b * DIM_FACTOR];
}

/**
 * Colour for an out-of-scope cell under faction focus: greys toward luminance and/or darkens a ramp
 * colour so the focused faction's cells read as clearly brighter. Never returns `ABSENT_COLOR` for a
 * ramp colour (every ramp stop sits well above rgb(8,9,12), so desat+dim can't collide with it).
 */
export function deEmphasize(color: number, treatment: DeEmphasis): number {
  const r0 = (color >> 16) & 0xff;
  const g0 = (color >> 8) & 0xff;
  const b0 = color & 0xff;
  let [r, g, b] = [r0, g0, b0];
  if (treatment === "desat" || treatment === "both") [r, g, b] = desatChannels(r, g, b);
  if (treatment === "dim" || treatment === "both") [r, g, b] = dimChannels(r, g, b);
  return pack([Math.round(r), Math.round(g), Math.round(b)]);
}

/**
 * CSS `rgb(...)` stops (low→high) for a mode's ramp — the single source the map
 * legend renders from, so the legend swatch can never drift from the cell fill.
 */
export function rampCssStops(mode: ValueMode): string[] {
  return RAMPS[mode].map(([, [r, g, b]]) => `rgb(${r}, ${g}, ${b})`);
}

/** CSS colour for the reserved "no value / absent" fill (value 0). */
export const ABSENT_CSS = "#08090c";
