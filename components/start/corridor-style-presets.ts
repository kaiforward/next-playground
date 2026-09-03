/** The three discrete presets over `GalaxyShapeKnobs.corridorStyle` (a void-fraction threshold
 *  bias): every surface that picks a corridor style — the New Game form and the styleguide's
 *  exploration section — offers exactly these buckets through a `SegmentedControl`, so their
 *  values and player-facing labels live here once. */
export const CORRIDOR_STYLE_PRESETS = {
  bands: 0.15,
  mixed: 0.5,
  crossings: 0.85,
} as const;

export type CorridorStylePreset = keyof typeof CORRIDOR_STYLE_PRESETS;

export const CORRIDOR_STYLE_OPTIONS: Array<{ value: CorridorStylePreset; label: string }> = [
  { value: "bands", label: "Mostly bands" },
  { value: "mixed", label: "Mixed" },
  { value: "crossings", label: "Mostly crossings" },
];
