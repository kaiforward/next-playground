"use client";

import { useEffect, useState } from "react";
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
import type { GalaxyImpression } from "@/lib/engine/galaxy-impression";
import { useNewGameMutation } from "@/lib/hooks/use-game-lifecycle";
import { useNavigate } from "@/components/ui/link-provider";
import { mapHref } from "@/lib/utils/route-hrefs";
import { finiteOr } from "@/lib/utils/math";
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
  for (const option of CORRIDOR_STYLE_OPTIONS) {
    const distance = Math.abs(value - CORRIDOR_STYLE_PRESETS[option.value]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = option.value;
    }
  }
  return best;
}

/** The engine's own defaults for a galaxy of this size, as concrete numbers rather than
 *  `undefined` — submitting these produces a world byte-identical to omitting `shape` entirely
 *  (`buildGenParams`, `lib/world/gen.ts`), which is what keeps "the form's default knob values" and
 *  "no knobs at all" the same played galaxy. Filling every field also means the preview always has a
 *  real number to render, never a half-drawn slider waiting on a first change. Derived from the
 *  system count rather than frozen at one: `defaultGalaxyShapeKnobs` scales cluster count and
 *  spacing by √N, so a frozen set would submit a 600-system galaxy's structure for a 20,000-system
 *  one and the `?? config.X` fallbacks downstream would never get a chance to fire. */
function defaultShapeFor(systemCount: number): Required<GalaxyShapeInput> {
  return {
    ...defaultGalaxyShapeKnobs(systemCount),
    starSpacing: 1,
    clusterTightness: DENSITY_RADIUS_EXPONENT,
    mapSizeScale: 1,
  };
}

/** The seven structure knobs `defaultShapeFor` rescales with the system count — the placement
 *  levers (`starSpacing`/`clusterTightness`/`mapSizeScale`) are pure multipliers on the engine's
 *  own values and never move with N. */
const SCALED_SHAPE_KEYS = [
  "clusterCount", "sizeSkew", "clusterSpacing", "voidFloor",
  "corridorsPerCluster", "corridorStyle", "clusterTurbulence",
] as const;

/** The form always opens with a concrete random seed already filled in, so the previewed galaxy
 *  IS the one a submit generates — a blank field used to randomise invisibly at generation while
 *  the preview showed a fixed fallback, and the two never matched. "Surprise me" is re-rolling
 *  the visible number, not an invisible one. The schema's `seed` stays optional for API callers;
 *  this form just never submits it blank. */
function rollSeed(): number {
  return Math.floor(Math.random() * 1_000_000);
}

interface CreateFactionFormProps {
  /** Called after a successful `newGame` command, before navigating to the map root — the start
   *  screen (`components/start/start-screen.tsx`) returns itself to the save list here. Optional. */
  onSuccess?: () => void;
  /** Called from the Back control and the Cancel button — the start screen returns to the save
   *  list without submitting. Optional so a bare `<CreateFactionForm />` still renders. */
  onCancel?: () => void;
}

/** Small floating surface over the galaxy preview — the two settings panels and nothing else, so
 *  the shared chrome (semi-opaque surface, square corners, bordered header, internal scroll for a
 *  panel taller than the viewport leaves room for) lives in one place. */
function FloatingPanel({
  title,
  className,
  children,
}: {
  title: string;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`absolute bg-surface/95 border border-border-strong max-h-[calc(100%-2.5rem)] overflow-y-auto ${className}`}>
      <div className="px-3 py-2 border-b border-border">
        <h2 className="text-xs font-display font-semibold uppercase tracking-wider text-text-accent">
          {title}
        </h2>
      </div>
      <div className="p-3 space-y-3">{children}</div>
    </div>
  );
}

/** Author the faction that generates a fresh galaxy (`newGame` command, world-less-valid,
 *  client-runtime spec §9) and land on the map root on success. The galaxy-shape knob section
 *  (spec `docs/planned/logistics-lanes.md` §5) and its embedded `GalaxyPreview` share this form's
 *  own state (`shape.*` fields) — the values the preview renders are exactly what `newGame`
 *  receives on submit, never a second copy that could drift from it. Renders full-screen (the
 *  preview-first layout: a full-bleed `GalaxyPreview` with the settings floating over it in two
 *  panels) rather than as a form-sized card — the galaxy the player is about to play is the thing
 *  worth the most screen space here, not a footnote beside the inputs that shape it. */
export function CreateFactionForm({ onSuccess, onCancel }: CreateFactionFormProps) {
  const navigate = useNavigate();
  const newGame = useNewGameMutation();
  // One roll per mount: the seed field opens pre-filled, and a cleared field still submits this
  // same value, so the preview and the generated galaxy can never diverge.
  const [initialSeed] = useState(rollSeed);
  const {
    register,
    control,
    handleSubmit,
    setError,
    setValue,
    formState: { errors, isSubmitting, dirtyFields },
  } = useForm<NewGameInput>({
    resolver: zodResolver(newGameSchema),
    defaultValues: {
      systemCount: DEFAULT_SYSTEM_COUNT,
      name: "",
      governmentType: "federation",
      doctrine: "expansionist",
      seed: initialSeed,
      shape: defaultShapeFor(DEFAULT_SYSTEM_COUNT),
    },
  });

  const systemCount = finiteOr(useWatch({ control, name: "systemCount" }), DEFAULT_SYSTEM_COUNT);
  const seed = useWatch({ control, name: "seed" });
  const shape = useWatch({ control, name: "shape" }) ?? {};
  const shapeDefaults = defaultShapeFor(systemCount);

  // Re-derive the structure knobs the player has NOT touched whenever the galaxy's size changes, so
  // an untouched form always submits the engine's own √N-scaled values for the count it is actually
  // generating. A knob the player edited is theirs and stays put.
  const touchedShapeFields = dirtyFields.shape;
  useEffect(() => {
    const scaled = defaultShapeFor(systemCount);
    for (const key of SCALED_SHAPE_KEYS) {
      if (touchedShapeFields?.[key]) continue;
      setValue(`shape.${key}`, scaled[key]);
    }
  }, [systemCount, setValue, touchedShapeFields]);

  const previewKnobs: GalaxyShapeKnobs = {
    clusterCount: finiteOr(shape.clusterCount, shapeDefaults.clusterCount),
    sizeSkew: finiteOr(shape.sizeSkew, shapeDefaults.sizeSkew),
    clusterSpacing: finiteOr(shape.clusterSpacing, shapeDefaults.clusterSpacing),
    voidFloor: finiteOr(shape.voidFloor, shapeDefaults.voidFloor),
    corridorsPerCluster: finiteOr(shape.corridorsPerCluster, shapeDefaults.corridorsPerCluster),
    corridorStyle: finiteOr(shape.corridorStyle, shapeDefaults.corridorStyle),
    clusterTurbulence: finiteOr(shape.clusterTurbulence, shapeDefaults.clusterTurbulence),
  };
  const mapSizeScale = finiteOr(shape.mapSizeScale, shapeDefaults.mapSizeScale);
  const starSpacing = finiteOr(shape.starSpacing, shapeDefaults.starSpacing);
  const clusterTightness = finiteOr(shape.clusterTightness, shapeDefaults.clusterTightness);

  // The preview's own "N systems placed · seed · map units" caption, mirrored here so the seed
  // chip can show it without a second copy of the placement maths — `GalaxyPreview` hides its
  // built-in caption (`hideCaption`) and reports the same impression back through this callback.
  const [impression, setImpression] = useState<GalaxyImpression | null>(null);

  function handleReroll() {
    setValue("seed", rollSeed(), { shouldDirty: true });
  }

  const onSubmit = handleSubmit(async (values) => {
    try {
      await newGame.mutateAsync({ ...values, seed: values.seed ?? initialSeed });
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
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      <div className="flex items-center gap-4 px-5 py-3 border-b border-border bg-surface shrink-0">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Back
        </Button>
        <h1 className="font-display font-semibold uppercase tracking-widest text-sm text-text-accent">
          New Game
        </h1>
      </div>

      <form onSubmit={onSubmit} className="relative flex-1 min-h-0" noValidate>
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <GalaxyPreview
            knobs={previewKnobs}
            seed={seed ?? initialSeed}
            systemCount={systemCount}
            overrides={{ mapSizeScale, minDistanceScale: starSpacing, densityRadiusExponent: clusterTightness }}
            fill
            hideCaption
            onImpressionChange={setImpression}
          />
        </div>

        <FloatingPanel title="Faction & galaxy" className="top-5 left-5 w-[360px]">
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
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <RangeInput
              id="shape-map-size-scale"
              label="Map size"
              valueLabel={`×${mapSizeScale.toFixed(1)}`}
              min={0.5}
              max={2}
              step={0.1}
              {...register("shape.mapSizeScale", { valueAsNumber: true })}
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
          </div>
        </FloatingPanel>

        <FloatingPanel title="Cluster shape" className="top-5 right-5 w-[380px]">
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
              valueLabel={previewKnobs.sizeSkew.toFixed(2)}
              min={0}
              max={1}
              step={0.05}
              {...register("shape.sizeSkew", { valueAsNumber: true })}
            />
            <RangeInput
              id="shape-cluster-spacing"
              label="Cluster spacing"
              valueLabel={String(previewKnobs.clusterSpacing)}
              min={100}
              max={4000}
              step={50}
              {...register("shape.clusterSpacing", { valueAsNumber: true })}
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
              id="shape-void-floor"
              label="Void floor"
              valueLabel={previewKnobs.voidFloor.toFixed(2)}
              min={0}
              max={0.9}
              step={0.02}
              {...register("shape.voidFloor", { valueAsNumber: true })}
            />
            <RangeInput
              id="shape-cluster-turbulence"
              label="Cluster turbulence"
              valueLabel={previewKnobs.clusterTurbulence.toFixed(2)}
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
                  value={presetFor(finiteOr(field.value, shapeDefaults.corridorStyle))}
                  onChange={(preset) => field.onChange(CORRIDOR_STYLE_PRESETS[preset])}
                  options={CORRIDOR_STYLE_OPTIONS}
                />
              )}
            />
            <RangeInput
              id="shape-corridors-per-cluster"
              label="Corridors per cluster"
              valueLabel={previewKnobs.corridorsPerCluster.toFixed(2)}
              min={0}
              max={2}
              step={0.1}
              {...register("shape.corridorsPerCluster", { valueAsNumber: true })}
            />
          </div>
        </FloatingPanel>

        <div className="absolute bottom-5 left-5 flex items-end gap-2 bg-surface/95 border border-border-strong px-3 py-2">
          <TextInput
            id="new-game-seed"
            label="Seed"
            inputMode="numeric"
            className="w-28"
            error={errors.seed?.message}
            {...register("seed", {
              setValueAs: (value) => (value === "" ? undefined : Number(value)),
            })}
          />
          <Button type="button" variant="ghost" size="xs" onClick={handleReroll}>
            Reroll
          </Button>
          <span className="self-center text-xs font-mono text-text-secondary">
            {impression
              ? `${impression.points.length.toLocaleString()} systems placed · ${impression.mapSize.toLocaleString()} × ${impression.mapSize.toLocaleString()} units`
              : "Generating…"}
          </span>
        </div>

        <div className="absolute bottom-5 right-5 flex flex-col items-end gap-2">
          <FormError message={errors.root?.message} />
          <div className="flex gap-3">
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Generating…" : "Launch New Galaxy"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
