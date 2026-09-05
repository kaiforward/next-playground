import { SUPPLIED_PROVISION, RATIONING_PROVISION, DEPRIVED_PROVISION } from "@/lib/constants/economy";
import { LANE_BANDS, laneBandCss } from "./objects/lane-band";
import { LANE_BAND_COLOR } from "./theme";

export type ValueMode = "population" | "development" | "stability" | "migration" | "provision" | "lanes";

/**
 * The four modes whose fill is a CONTINUOUS ramp (RAMPS + sample() below) — provision and lanes are
 * excluded and handled by their own stepped paths (PROVISION_BANDS + sampleStepped() below;
 * `laneBandColorForValue` further down) so `RAMPS[mode]` can never silently treat a stepped mode as
 * continuous (a missing key would be a compile error, not a runtime surprise).
 */
export type ContinuousMode = Exclude<ValueMode, "provision" | "lanes">;

type Stop = readonly [number, readonly [number, number, number]];

// Black (ABSENT) means "nothing here" — no system / no data / out of sensor range. Absence is decided
// by the CONSUMER (a cell missing from the value map is black); the ramps below only cover a mode's
// PRESENT range. population additionally reserves black for a literal 0 (0 people = nothing there).
// stability/migration do NOT: every present (developed) system has a real value there, and its
// floor (maximal unrest / least attractive) rides the red end of the ramp, not black —
// absence is reserved for undeveloped/marketless systems, decided by the caller. provision follows
// the same caller-decided convention (an unassessed system is simply absent from the value map — see
// `getProvisionBySystem`) rather than RESERVES_ABSENT_ZERO: its "absent" is a missing FIELD
// (never assessed), not a zero VALUE (0% Provisioned is a real, if dire, reading). Population and
// migration share one two-pole red→green ramp (green = most/best) — a single value-mode colour language;
// stability runs red (unstable) → teal → cyan (calm); development rides a grey floor → warm hue. Stops
// are [t, [r,g,b]] with t ascending 0..1.
const ABSENT = 0x08090c;
const RAMPS: Record<ContinuousMode, readonly Stop[]> = {
  population: [[0, [239, 68, 68]], [1, [34, 197, 94]]], // red → green
  development: [[0, [80, 84, 92]], [0.5, [158, 74, 44]], [1, [224, 132, 95]]], // grey floor → warm hue
  stability: [[0, [239, 68, 68]], [0.5, [26, 120, 140]], [1, [103, 232, 249]]], // red (unstable) → teal → cyan (calm)
  migration: [[0, [239, 68, 68]], [1, [34, 197, 94]]], // red → green (attractiveness)
};

// Modes where a literal 0 means "nothing" and is drawn black (rather than the ramp floor). Stability
// and migration are excluded — their 0 (or negative) is a real, present-system value that rides
// the red floor; absence for migration is the developed/market gate, not a literal-0 check.
const RESERVES_ABSENT_ZERO: Record<ContinuousMode, boolean> = {
  population: true,
  development: true,
  stability: false,
  migration: false,
};

// Provisioned steps FLAT at the three edges the band classifier itself uses (`DEPRIVED_PROVISION`,
// `RATIONING_PROVISION`, `SUPPLIED_PROVISION`) instead of interpolating between them: a mature
// galaxy sits mostly at ~92-96% Supplied, so a continuous ramp would paint almost everything one
// colour. Every value within a band renders IDENTICALLY — this is what makes it "stepped" rather
// than "a ramp with custom stop positions" (sample() below would still blend between these four
// points). Colours run as one heat scale down the axis — deep maroon (the Deprived band, below
// DEPRIVED_PROVISION), red (Rationing), amber (Strained), green (at/above SUPPLIED_PROVISION —
// Supplied). Maroon rather than the chip's purple: within the map's own language, darker-than-red
// reads as off the bottom of a heat scale, where a bright violet would read as a different data
// dimension entirely; each surface stays internally consistent, and what the two must agree on is
// how many states exist, not which hue each wears. The map paints the Provision axis and only that:
// Famine (the survival punch-through) owns no span of the axis, since it can occur at any Provision
// level, so it is not a fifth colour here — it is a per-system signal, carried by the per-system
// read's band (`SystemProvisionRead.band`) and shown on the Population tab's chip and track.
// Absolute scale, never referenceMax-normalised: see valueRampColorPixi below.
const PROVISION_BANDS: readonly Stop[] = [
  [0, [127, 29, 29]], // deep maroon — Deprived, Provision < DEPRIVED_PROVISION
  [DEPRIVED_PROVISION, [239, 68, 68]], // red — Rationing
  [RATIONING_PROVISION, [217, 119, 6]], // amber — Strained
  [SUPPLIED_PROVISION, [34, 197, 94]], // green — Supplied, Provision >= SUPPLIED_PROVISION
];

/**
 * The Lanes mode's cell/lane fill: stepped on `laneBandIndex` (0 fine, 1 busy, 2 congested), never
 * interpolated and never `referenceMax`-normalised — the same "one band = one colour" contract as
 * PROVISION_BANDS, but the input here is already a discrete index rather than a fraction, so the
 * step is a floor-and-clamp rather than a threshold table. Colours come straight from
 * `LANE_BAND_COLOR` (`theme.ts`) so the fill can never drift from the band definition
 * (`objects/lane-band.ts`) the alert bar and the base lane layer both read.
 */
function laneBandColorForValue(value: number): number {
  const idx = Math.max(0, Math.min(LANE_BANDS.length - 1, Math.floor(value)));
  return LANE_BAND_COLOR[LANE_BANDS[idx]];
}

/** Flat step lookup: the colour of the highest band edge at or below `t` (edges ascending, inclusive
 *  low side — matches `foldSupplyState`'s `>=` boundaries). Unlike sample(), never blends. */
function sampleStepped(bands: readonly Stop[], t: number): number {
  const c = Math.max(0, Math.min(1, t));
  let color = bands[0][1];
  for (const [edge, rgb] of bands) {
    if (c >= edge) color = rgb;
  }
  return pack(color);
}

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
 * (they never reach here). Continuous modes normalise to `referenceMax`; `provision` is the one
 * exception — its band edges are absolute percentages, so it steps at PROVISION_BANDS and ignores
 * `referenceMax` entirely (never re-scales to a focused faction's maximum, unlike population/
 * development/migration).
 */
export function valueRampColorPixi(value: number, referenceMax: number, mode: ValueMode): number {
  if (mode === "provision") return sampleStepped(PROVISION_BANDS, value > 0 ? value : 0);
  if (mode === "lanes") return laneBandColorForValue(value);
  if (RESERVES_ABSENT_ZERO[mode] && !(value > 0)) return ABSENT;
  const v = value > 0 ? value : 0;
  const max = referenceMax > 0 ? referenceMax : 1;
  return sample(RAMPS[mode], v / max);
}
export function rampFloorPixi(mode: ContinuousMode): number { return pack(RAMPS[mode][0][1]); }
export function rampTopPixi(mode: ContinuousMode): number { return pack(RAMPS[mode][RAMPS[mode].length - 1][1]); }
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
export function deEmphasise(color: number, treatment: DeEmphasis): number {
  const r0 = (color >> 16) & 0xff;
  const g0 = (color >> 8) & 0xff;
  const b0 = color & 0xff;
  let [r, g, b] = [r0, g0, b0];
  if (treatment === "desat" || treatment === "both") [r, g, b] = desatChannels(r, g, b);
  if (treatment === "dim" || treatment === "both") [r, g, b] = dimChannels(r, g, b);
  return pack([Math.round(r), Math.round(g), Math.round(b)]);
}

/**
 * CSS `rgb(...)` stops (low→high) for a CONTINUOUS mode's ramp — the single source the map
 * legend renders from, so the legend swatch can never drift from the cell fill. Discards stop
 * POSITIONS, which is lossless only while a ramp's stops are evenly spaced — every continuous ramp
 * here is. `provision`'s stepped fill is not, so it is excluded from this type and reads its
 * legend from `provisionLegendStops` instead, which carries positions.
 */
export function rampCssStops(mode: ContinuousMode): string[] {
  return RAMPS[mode].map(([, [r, g, b]]) => `rgb(${r}, ${g}, ${b})`);
}

/** A stepped-fill legend stop: the value where a flat colour band BEGINS (unlike `rampCssStops`, the
 *  position is not discarded — provision's bands sit at the real classifier edges, not evenly spaced). */
export interface SteppedLegendStop {
  position: number;
  css: string;
}

/**
 * Legend stops for the `provision` stepped fill, in the same order and at the same edges
 * (`DEPRIVED_PROVISION`, `RATIONING_PROVISION`, `SUPPLIED_PROVISION`) the cell fill itself steps at —
 * so a legend built from this can never drift from PROVISION_BANDS, the way `rampCssStops` can't
 * drift from RAMPS.
 */
export function provisionLegendStops(): SteppedLegendStop[] {
  return PROVISION_BANDS.map(([position, [r, g, b]]) => ({ position, css: `rgb(${r}, ${g}, ${b})` }));
}

/**
 * Legend stops for the Lanes mode's stepped fill, in band order (fine, busy, congested). Positions
 * are the band INDEX (0, 1, 2), not a 0..1 fraction like `provisionLegendStops` — there is no
 * continuous domain here, just three fixed states — so a legend renderer spaces them evenly rather
 * than by a real span. Reads `laneBandCss`, the same colour source `valueRampColorPixi("lanes", …)`
 * steps through, so the legend can never drift from the fill.
 */
export function lanesLegendStops(): SteppedLegendStop[] {
  return LANE_BANDS.map((band, position) => ({ position, css: laneBandCss(band) }));
}

/** CSS colour for the reserved "no value / absent" fill (value 0). */
export const ABSENT_CSS = "#08090c";
