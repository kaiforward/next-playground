"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/form/number-input";
import { TextInput } from "@/components/form/text-input";
import { FormError } from "@/components/form/form-error";
import { apiMutate } from "@/lib/query/fetcher";
import { newGameSchema, type NewGameInput } from "@/lib/schemas/game-setup";
import type { WorldMeta } from "@/lib/world/types";

export function NewGameForm() {
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<NewGameInput>({
    resolver: zodResolver(newGameSchema),
    defaultValues: { systemCount: 600 },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await apiMutate<WorldMeta>("/api/game/new", values);
      // Hard navigation on purpose — fresh document, fresh TanStack cache
      // against the newly generated world.
      window.location.href = "/";
    } catch (error) {
      setError("root", {
        message: error instanceof Error ? error.message : "Failed to create game",
      });
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
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
