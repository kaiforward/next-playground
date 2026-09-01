"use client";

import { useForm, Controller, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/form/number-input";
import { RangeInput } from "@/components/form/range-input";
import { SegmentedControl } from "@/components/form/segmented-control";
import { TextInput } from "@/components/form/text-input";
import { SelectInput } from "@/components/form/select-input";
import { FormError } from "@/components/form/form-error";
import { GalaxyPreview } from "@/components/start/galaxy-preview";
import { useNewGameMutation } from "@/lib/hooks/use-game-lifecycle";
import { useNavigate } from "@/components/ui/link-provider";
import { mapHref } from "@/lib/utils/route-hrefs";
import { newGameSchema, type NewGameInput, type GalaxyShapeInput } from "@/lib/schemas/game-setup";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import { DOCTRINES } from "@/lib/constants/doctrines";
import { ALL_GOVERNMENT_TYPES, ALL_DOCTRINES } from "@/lib/types/guards";
import { DEFAULT_SYSTEM_COUNT } from "@/lib/constants/universe-gen";
import { defaultGalaxyShapeKnobs, type GalaxyShapeKnobs } from "@/lib/engine/density-field";
import { DENSITY_RADIUS_EXPONENT } from "@/lib/engine/system-placement";

const GOV_OPTIONS = ALL_GOVERNMENT_TYPES.map((g) => ({ value: g, label: GOVERNMENT_TYPES[g].name }));
const DOC_OPTIONS = ALL_DOCTRINES.map((d) => ({ value: d, label: DOCTRINES[d].name }));

import {
  CORRIDOR_STYLE_PRESETS,
  CORRIDOR_STYLE_OPTIONS,
  type CorridorStylePreset,
} from "./corridor-style-presets";

/** Nearest preset to an arbitrary `corridorStyle` value — every value this form itself ever writes
 *  is exactly one of the three presets, so this only matters for the schema's own default (0.5,
 *  already "mixed") and guards against a future preset re-tuning drifting the reverse mapping. */
function presetFor(value: number): CorridorStylePreset {
  let best: CorridorStylePreset = "mixed";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [preset, presetValue] of Object.entries(CORRIDOR_STYLE_PRESETS) as Array<
    [CorridorStylePreset, number]
  >) {
    const distance = Math.abs(value - presetValue);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = preset;
    }
  }
  return best;
}

/** The Gate-A defaults, as concrete numbers rather than `undefined` — submitting these produces a
 *  world byte-identical to omitting `shape` entirely (`buildGenParams`, `lib/world/gen.ts`), which
 *  is what keeps "the form's default knob values" and "no knobs at all" the same played galaxy.
 *  Filling every field also means the preview always has a real number to render, never a
 *  half-drawn slider waiting on a first change. */
const DEFAULT_SHAPE: Required<GalaxyShapeInput> = {
  ...defaultGalaxyShapeKnobs(DEFAULT_SYSTEM_COUNT),
  starSpacing: 1,
  clusterTightness: DENSITY_RADIUS_EXPONENT,
  mapSizeScale: 1,
};

/** Preview-only fallback for an unset seed — the schema's `seed` field stays genuinely optional
 *  (omitted means "randomise" all the way to `lib/services/game.ts`), so a blank field previews a
 *  fixed candidate seed rather than showing nothing; typing an explicit seed is what makes the
 *  previewed galaxy and the played one the same galaxy. */
const PREVIEW_FALLBACK_SEED = 42;

interface CreateFactionFormProps {
  /** Called after a successful `newGame` command, before navigating to the map root — the start
   *  screen's dialog (`components/start/start-screen.tsx`) closes itself here. Optional. */
  onSuccess?: () => void;
}

/** Author the faction that generates a fresh galaxy (`newGame` command, world-less-valid,
 *  client-runtime spec §9) and land on the map root on success. The galaxy-shape knob section
 *  (spec `docs/planned/logistics-lanes.md` §5) and its embedded `GalaxyPreview` share this form's
 *  own state (`shape.*` fields) — the values the preview renders are exactly what `newGame`
 *  receives on submit, never a second copy that could drift from it. */
export function CreateFactionForm({ onSuccess }: CreateFactionFormProps) {
  const navigate = useNavigate();
  const newGame = useNewGameMutation();
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<NewGameInput>({
    resolver: zodResolver(newGameSchema),
    defaultValues: {
      systemCount: DEFAULT_SYSTEM_COUNT,
      name: "",
      governmentType: "federation",
      doctrine: "expansionist",
      shape: DEFAULT_SHAPE,
    },
  });

  const systemCount = useWatch({ control, name: "systemCount" }) ?? DEFAULT_SYSTEM_COUNT;
  const seed = useWatch({ control, name: "seed" });
  const shape = useWatch({ control, name: "shape" }) ?? DEFAULT_SHAPE;

  const previewKnobs: GalaxyShapeKnobs = {
    clusterCount: shape.clusterCount ?? DEFAULT_SHAPE.clusterCount,
    sizeSkew: shape.sizeSkew ?? DEFAULT_SHAPE.sizeSkew,
    clusterSpacing: shape.clusterSpacing ?? DEFAULT_SHAPE.clusterSpacing,
    voidFloor: shape.voidFloor ?? DEFAULT_SHAPE.voidFloor,
    corridorsPerCluster: shape.corridorsPerCluster ?? DEFAULT_SHAPE.corridorsPerCluster,
    corridorStyle: shape.corridorStyle ?? DEFAULT_SHAPE.corridorStyle,
    clusterTurbulence: shape.clusterTurbulence ?? DEFAULT_SHAPE.clusterTurbulence,
  };
  const mapSizeScale = shape.mapSizeScale ?? DEFAULT_SHAPE.mapSizeScale;
  const starSpacing = shape.starSpacing ?? DEFAULT_SHAPE.starSpacing;
  const clusterTightness = shape.clusterTightness ?? DEFAULT_SHAPE.clusterTightness;

  const onSubmit = handleSubmit(async (values) => {
    try {
      await newGame.mutateAsync(values);
      onSuccess?.();
      navigate(mapHref());
    } catch (error) {
      setError("root", {
        message: error instanceof Error ? error.message : "Failed to create game",
      });
    }
  });

  const pending = isSubmitting || newGame.isPending;

  return (
    <form onSubmit={onSubmit} className="flex flex-col lg:flex-row gap-6" noValidate>
      <div className="flex flex-col gap-4 lg:w-[380px] shrink-0">
        <TextInput
          id="faction-name"
          label="Faction name"
          placeholder="e.g. Aurelian League"
          error={errors.name?.message}
          {...register("name")}
        />
        <Controller
          name="governmentType"
          control={control}
          render={({ field }) => (
            <SelectInput
              label="Government"
              options={GOV_OPTIONS}
              value={field.value}
              onChange={field.onChange}
              error={errors.governmentType?.message}
            />
          )}
        />
        <Controller
          name="doctrine"
          control={control}
          render={({ field }) => (
            <SelectInput
              label="Doctrine"
              options={DOC_OPTIONS}
              value={field.value}
              onChange={field.onChange}
              error={errors.doctrine?.message}
            />
          )}
        />
        <NumberInput
          id="new-game-system-count"
          label="Systems"
          min={50}
          max={20000}
          step={50}
          hint="50 – 20,000. Bigger galaxies take longer to generate."
          error={errors.systemCount?.message}
          {...register("systemCount", { valueAsNumber: true })}
        />
        <TextInput
          id="new-game-seed"
          label="Seed (optional)"
          inputMode="numeric"
          placeholder="Random"
          error={errors.seed?.message}
          {...register("seed", {
            setValueAs: (value) => (value === "" ? undefined : Number(value)),
          })}
        />

        <div className="border-t border-border pt-4 space-y-3">
          <h3 className="text-xs font-display font-bold text-text-accent uppercase tracking-wider">
            Galaxy shape
          </h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <NumberInput
              id="shape-cluster-count"
              label="Cluster count"
              min={1}
              max={100}
              error={errors.shape?.clusterCount?.message}
              {...register("shape.clusterCount", { valueAsNumber: true })}
            />
            <RangeInput
              id="shape-size-skew"
              label="Size skew"
              valueLabel={(shape.sizeSkew ?? DEFAULT_SHAPE.sizeSkew).toFixed(2)}
              min={0}
              max={1}
              step={0.05}
              {...register("shape.sizeSkew", { valueAsNumber: true })}
            />
            <RangeInput
              id="shape-cluster-spacing"
              label="Cluster spacing"
              valueLabel={String(shape.clusterSpacing ?? DEFAULT_SHAPE.clusterSpacing)}
              min={100}
              max={2000}
              step={50}
              {...register("shape.clusterSpacing", { valueAsNumber: true })}
            />
            <RangeInput
              id="shape-void-floor"
              label="Void floor"
              valueLabel={(shape.voidFloor ?? DEFAULT_SHAPE.voidFloor).toFixed(2)}
              min={0}
              max={0.9}
              step={0.02}
              {...register("shape.voidFloor", { valueAsNumber: true })}
            />
            <RangeInput
              id="shape-corridors-per-cluster"
              label="Corridors per cluster"
              valueLabel={(shape.corridorsPerCluster ?? DEFAULT_SHAPE.corridorsPerCluster).toFixed(2)}
              min={0}
              max={2}
              step={0.1}
              {...register("shape.corridorsPerCluster", { valueAsNumber: true })}
            />
            <RangeInput
              id="shape-cluster-turbulence"
              label="Cluster turbulence"
              valueLabel={(shape.clusterTurbulence ?? DEFAULT_SHAPE.clusterTurbulence).toFixed(2)}
              min={0}
              max={1}
              step={0.05}
              {...register("shape.clusterTurbulence", { valueAsNumber: true })}
            />
            <Controller
              name="shape.corridorStyle"
              control={control}
              render={({ field }) => (
                <SegmentedControl
                  name="shape-corridor-style"
                  label="Corridor style"
                  value={presetFor(field.value ?? DEFAULT_SHAPE.corridorStyle)}
                  onChange={(preset) => field.onChange(CORRIDOR_STYLE_PRESETS[preset])}
                  options={CORRIDOR_STYLE_OPTIONS}
                />
              )}
            />
            <RangeInput
              id="shape-star-spacing"
              label="Star spacing"
              valueLabel={`×${starSpacing.toFixed(2)}`}
              min={0.2}
              max={1.5}
              step={0.05}
              {...register("shape.starSpacing", { valueAsNumber: true })}
            />
            <RangeInput
              id="shape-cluster-tightness"
              label="Cluster tightness"
              valueLabel={clusterTightness.toFixed(2)}
              min={0}
              max={1}
              step={0.05}
              {...register("shape.clusterTightness", { valueAsNumber: true })}
            />
            <RangeInput
              id="shape-map-size-scale"
              label="Map size"
              valueLabel={`×${mapSizeScale.toFixed(1)}`}
              min={0.5}
              max={2}
              step={0.1}
              {...register("shape.mapSizeScale", { valueAsNumber: true })}
            />
          </div>
        </div>

        <FormError message={errors.root?.message} />
        <Button type="submit" fullWidth disabled={pending}>
          {pending ? "Generating…" : "Launch New Galaxy"}
        </Button>
      </div>

      <div className="flex-1 flex items-center justify-center min-w-0">
        <GalaxyPreview
          knobs={previewKnobs}
          seed={seed ?? PREVIEW_FALLBACK_SEED}
          systemCount={systemCount}
          overrides={{ mapSizeScale, minDistanceScale: starSpacing, densityRadiusExponent: clusterTightness }}
        />
      </div>
    </form>
  );
}
