"use client";

import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/form/number-input";
import { TextInput } from "@/components/form/text-input";
import { SelectInput } from "@/components/form/select-input";
import { FormError } from "@/components/form/form-error";
import { useNewGameMutation } from "@/lib/hooks/use-game-lifecycle";
import { useNavigate } from "@/components/ui/link-provider";
import { mapHref } from "@/lib/utils/route-hrefs";
import { newGameSchema, type NewGameInput } from "@/lib/schemas/game-setup";
import { GOVERNMENT_TYPES } from "@/lib/constants/government";
import { DOCTRINES } from "@/lib/constants/doctrines";
import { ALL_GOVERNMENT_TYPES, ALL_DOCTRINES } from "@/lib/types/guards";

const GOV_OPTIONS = ALL_GOVERNMENT_TYPES.map((g) => ({ value: g, label: GOVERNMENT_TYPES[g].name }));
const DOC_OPTIONS = ALL_DOCTRINES.map((d) => ({ value: d, label: DOCTRINES[d].name }));

interface CreateFactionFormProps {
  /** Called after a successful `newGame` command, before navigating to the map root — the start
   *  screen's dialog (`components/start/start-screen.tsx`) closes itself here. Optional so the old
   *  standalone `/start/new` Next route (`app/start/new/page.tsx`, kept compiling until Task 14)
   *  needs no change of its own. */
  onSuccess?: () => void;
}

/** Author the faction that generates a fresh galaxy (`newGame` command, world-less-valid,
 *  client-runtime spec §9) and land on the map root on success. */
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
      systemCount: 600,
      name: "",
      governmentType: "federation",
      doctrine: "expansionist",
    },
  });

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
      <Button type="submit" fullWidth disabled={pending}>
        {pending ? "Generating…" : "Launch New Galaxy"}
      </Button>
    </form>
  );
}
