import { z } from "zod";
import { sanitiseSaveName, AUTOSAVE_NAME } from "@/lib/world/save";
import { ALL_GOVERNMENT_TYPES, ALL_DOCTRINES } from "@/lib/types/guards";

/**
 * The galaxy-shape structure knobs (spec `docs/planned/logistics-lanes.md` §5) plus the placement
 * levers the styleguide's preview surface explored, exposed to New Game at clamped ranges — the
 * unclamped dev-exploration ranges live only in `components/styleguide/styleguide-page.tsx`. All
 * optional: an omitted field keeps `buildGenParams`'s (`lib/world/gen.ts`) engine default, which is
 * what keeps a knob-free `newGame` byte-identical to today's world. `starSpacing`/`clusterTightness`
 * name the same levers `GenParams` calls `minDistanceScale`/`densityRadiusExponent` — the player-
 * facing names match the styleguide's slider labels ("Star spacing", "Cluster tightness").
 */
export const galaxyShapeSchema = z.object({
  clusterCount: z
    .number("Cluster count must be a number")
    .int("Cluster count must be a whole number")
    .min(1, "Cluster count must be at least 1")
    .max(100, "Cluster count must be at most 100")
    .optional(),
  sizeSkew: z
    .number("Size skew must be a number")
    .min(0, "Size skew must be at least 0")
    .max(1, "Size skew must be at most 1")
    .optional(),
  clusterSpacing: z
    .number("Cluster spacing must be a number")
    .min(100, "Cluster spacing must be at least 100")
    // Covers the engine's own default at the largest galaxy New Game offers (≈3,431 at 20,000
    // systems) — a lower ceiling would reject the value an untouched form submits there.
    .max(4000, "Cluster spacing must be at most 4,000")
    .optional(),
  voidFloor: z
    .number("Void floor must be a number")
    .min(0, "Void floor must be at least 0")
    .max(0.9, "Void floor must be at most 0.9")
    .optional(),
  corridorsPerCluster: z
    .number("Corridors per cluster must be a number")
    .min(0, "Corridors per cluster must be at least 0")
    .max(2, "Corridors per cluster must be at most 2")
    .optional(),
  corridorStyle: z
    .number("Corridor style must be a number")
    .min(0, "Corridor style must be at least 0")
    .max(1, "Corridor style must be at most 1")
    .optional(),
  clusterTurbulence: z
    .number("Cluster turbulence must be a number")
    .min(0, "Cluster turbulence must be at least 0")
    .max(1, "Cluster turbulence must be at most 1")
    .optional(),
  starSpacing: z
    .number("Star spacing must be a number")
    .min(0.2, "Star spacing must be at least 0.2")
    .max(1.5, "Star spacing must be at most 1.5")
    .optional(),
  clusterTightness: z
    .number("Cluster tightness must be a number")
    .min(0, "Cluster tightness must be at least 0")
    .max(1, "Cluster tightness must be at most 1")
    .optional(),
  mapSizeScale: z
    .number("Map size must be a number")
    .min(0.5, "Map size must be at least ×0.5")
    .max(2, "Map size must be at most ×2")
    .optional(),
});

export const newGameSchema = z.object({
  systemCount: z
    .number("System count is required")
    .int("System count must be a whole number")
    .min(50, "System count must be at least 50")
    .max(20000, "System count must be at most 20,000"),
  seed: z.number("Seed must be a number").int("Seed must be a whole number").optional(),
  name: z
    .string()
    .trim()
    .min(1, "Faction name is required")
    .max(40, "Faction name must be at most 40 characters"),
  governmentType: z.enum(ALL_GOVERNMENT_TYPES),
  doctrine: z.enum(ALL_DOCTRINES),
  shape: galaxyShapeSchema.optional(),
});

export const speedSchema = z.object({
  speed: z.union([z.literal("paused"), z.literal(1), z.literal(5), z.literal("max")], {
    error: 'Speed must be one of "paused", 1, 5, "max".',
  }),
});

/**
 * Save names are sanitised to `[a-z0-9-_]` on disk (`sanitiseSaveName`), so a
 * name that sanitises to nothing (e.g. "???") would silently collide on
 * `saves/.json` — reject it here at the boundary instead. Shared by the save
 * and load schemas so both apply the same length + sanitise constraints.
 */
const saveName = z
  .string()
  .trim()
  .min(1, "Save name is required")
  .max(40, "Save name must be at most 40 characters")
  .refine((name) => sanitiseSaveName(name).length > 0, {
    message: "Save name must contain at least one letter or number",
  });

// A player-typed name that sanitises to the reserved autosave slot would silently clobber (and be
// clobbered by) the ambient autosave — reject it. Shared by every schema that writes a NEW named
// save (saveGame, importSave); loadGame/exportSave read an EXISTING save, where the autosave name
// is exactly the legitimate "Continue" case, so they keep the plain `saveName` instead.
const writableSaveName = saveName.refine((name) => sanitiseSaveName(name) !== AUTOSAVE_NAME, {
  message: `"${AUTOSAVE_NAME}" is a reserved save name`,
});

export const saveGameSchema = z.object({ name: writableSaveName });

export const loadGameSchema = z.object({ name: saveName });

export const exportSaveSchema = z.object({ name: saveName });

export const importSaveSchema = z.object({
  name: writableSaveName,
  json: z.string().min(1, "Save file is empty"),
});

export type GalaxyShapeInput = z.infer<typeof galaxyShapeSchema>;
export type NewGameInput = z.infer<typeof newGameSchema>;
export type SpeedInput = z.infer<typeof speedSchema>;
export type SaveGameInput = z.infer<typeof saveGameSchema>;
export type LoadGameInput = z.infer<typeof loadGameSchema>;
export type ExportSaveInput = z.infer<typeof exportSaveSchema>;
export type ImportSaveInput = z.infer<typeof importSaveSchema>;
