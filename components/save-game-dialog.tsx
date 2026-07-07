"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/form/text-input";
import { FormError } from "@/components/form/form-error";
import { useSaveGameMutation } from "@/lib/hooks/use-game-lifecycle";
import { saveGameSchema, type SaveGameInput } from "@/lib/schemas/game-setup";

interface SaveGameDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SaveGameDialog({ open, onClose }: SaveGameDialogProps) {
  const saveGame = useSaveGameMutation();
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<SaveGameInput>({
    resolver: zodResolver(saveGameSchema),
    defaultValues: { name: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await saveGame.mutateAsync(values.name);
      reset();
      onClose();
    } catch (error) {
      setError("root", {
        message: error instanceof Error ? error.message : "Failed to save game",
      });
    }
  });

  return (
    <Dialog open={open} onClose={onClose} modal size="sm" initialFocus="input">
      <h2 className="font-display font-semibold text-lg text-text-primary mb-4">Save Game</h2>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <TextInput
          id="save-game-name"
          label="Save name"
          placeholder="my-save"
          error={errors.name?.message}
          {...register("name")}
        />
        <FormError message={errors.root?.message} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="md" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
