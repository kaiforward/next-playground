export type ValueMode = "population" | "development" | "stability";

type Stop = readonly [number, readonly [number, number, number]];

// Black is reserved for value 0 (uncolonised / no value). Present values ride a grey floor → mode-hue
// ceiling, so "has a value" never blurs into "has none". Stops are [t, [r,g,b]] with t ascending 0..1.
const ABSENT = 0x08090c;
const RAMPS: Record<ValueMode, readonly Stop[]> = {
  population: [[0, [78, 84, 94]], [0.5, [168, 120, 52]], [1, [252, 211, 77]]],
  development: [[0, [80, 84, 92]], [0.5, [158, 74, 44]], [1, [224, 132, 95]]],
  stability: [[0, [76, 86, 96]], [0.5, [26, 120, 140]], [1, [103, 232, 249]]],
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

/** value ≤ 0 / NaN → black (absent). Otherwise grey floor → mode hue, normalised to referenceMax. */
export function valueRampColorPixi(value: number, referenceMax: number, mode: ValueMode): number {
  if (!(value > 0)) return ABSENT;
  const max = referenceMax > 0 ? referenceMax : 1;
  return sample(RAMPS[mode], value / max);
}
export function rampFloorPixi(mode: ValueMode): number { return pack(RAMPS[mode][0][1]); }
export function rampTopPixi(mode: ValueMode): number { return pack(RAMPS[mode][RAMPS[mode].length - 1][1]); }
export const ABSENT_COLOR = ABSENT;
