"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/form/number-input";
import { TextInput } from "@/components/form/text-input";
import { SelectInput } from "@/components/form/select-input";
import { FormError } from "@/components/form/form-error";
import { apiMutate } from "@/lib/query/fetcher";
import { newGameSchema, type NewGameInput } from "@/lib/schemas/game-setup";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import { DOCTRINES } from "@/lib/constants/doctrines";
import { ALL_GOVERNMENT_TYPES, ALL_DOCTRINES } from "@/lib/types/guards";
import type { WorldMeta } from "@/lib/world/types";

const GOV_OPTIONS = ALL_GOVERNMENT_TYPES.map((g) => ({ value: g, label: GOVERNMENT_TYPES[g].name }));
const DOC_OPTIONS = ALL_DOCTRINES.map((d) => ({ value: d, label: DOCTRINES[d].name }));

export function CreateFactionForm() {
  const {
    register,
    control,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<NewGameInput>({
    resolver: zodResolver(newGameSchema),
    defaultValues: {
      systemCount: 600,
      name: "",
      governmentType: "federation",
      doctrine: "expansionist",
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await apiMutate<WorldMeta>("/api/game/new", values);
      // Hard navigation on purpose — fresh document, fresh TanStack cache
      // against the newly generated world (the map auto-focuses the homeworld).
      window.location.href = "/";
    } catch (error) {
      setError("root", {
        message: error instanceof Error ? error.message : "Failed to create game",
      });
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
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
      <FormError message={errors.root?.message} />
      <Button type="submit" fullWidth disabled={isSubmitting}>
        {isSubmitting ? "Generating…" : "Launch New Galaxy"}
      </Button>
    </form>
  );
}
