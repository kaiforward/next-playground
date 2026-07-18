"use client";

import { useCallback, useMemo, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { SelectInput } from "@/components/form/select-input";
import { NumberInput } from "@/components/form/number-input";
import { useOrderBuild } from "@/lib/hooks/use-construction-orders";
import { formatEta } from "@/lib/utils/construction-format";
import { formatPeople } from "@/lib/utils/format";
import type { BuildOptionData } from "@/lib/types/api";

const orderSchema = z.object({
  buildingType: z.string().min(1, "Pick a building"),
  levels: z.number().int().min(1, "At least 1 level"),
});
type OrderForm = z.infer<typeof orderSchema>;

/** Readout row: label left, mono value right; tone colours the value. */
function ReadoutRow({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  const toneClass =
    tone === "ok" ? "text-status-green-light" : tone === "warn" ? "text-status-amber-light" : tone === "bad" ? "text-status-red-light" : "text-text-primary";
  return (
    <div className="flex items-baseline justify-between border-b border-dotted border-border py-1 text-xs last:border-b-0">
      <span className="text-text-tertiary">{label}</span>
      <span className={`font-mono ${toneClass}`}>{value}</span>
    </div>
  );
}

/** "Ux heads + Ty tech (+ Nz eng)" — the engineer clause only appears when the option draws skill2. */
function labourAddedText(added: BuildOptionData["labourAdded"], levels: number): string {
  const n = Math.max(1, levels);
  const parts = [`${formatPeople(added.unskilled * n)}`, `${formatPeople(added.skill1 * n)} tech`];
  if (added.skill2 > 0) parts.push(`${formatPeople(added.skill2 * n)} eng`);
  return parts.join(" + ");
}

/**
 * New-industry order dialog — the one dialog left: types with no ledger row yet, system fixed.
 * Space/slot ceilings hard-block submit; the staffing estimate warns and never blocks.
 */
export function BuildDialog({
  systemId, systemName, options, open, onClose,
}: {
  systemId: string;
  systemName: string;
  options: BuildOptionData[];
  open: boolean;
  onClose: () => void;
}) {
  const order = useOrderBuild(systemId);
  const {
    control, register, handleSubmit, watch, reset,
    formState: { errors },
  } = useForm<OrderForm>({
    resolver: zodResolver(orderSchema),
    defaultValues: { buildingType: options[0]?.buildingType ?? "", levels: 1 },
  });

  // The host <dialog> renders in the browser top layer (showModal()), so the
  // building-select menu must portal into it rather than document.body, or it
  // would render beneath the dialog. Derived via the form's nearest <dialog>
  // ancestor since Dialog doesn't expose its element to children.
  const [dialogEl, setDialogEl] = useState<HTMLDialogElement | null>(null);
  const formRef = useCallback((node: HTMLFormElement | null) => {
    if (!node) {
      setDialogEl(null);
      return;
    }
    const dialog = node.closest("dialog");
    setDialogEl(dialog instanceof HTMLDialogElement ? dialog : null);
  }, []);
  const chosenType = watch("buildingType");
  const levels = watch("levels");
  const option = useMemo(() => options.find((o) => o.buildingType === chosenType), [options, chosenType]);

  const overCeiling = option !== undefined && levels > option.maxLevels;
  const invalidLevels = !Number.isInteger(levels) || levels < 1;
  const staffingShort = option !== undefined && option.estStaffing < 1;
  const totalWork = option !== undefined ? option.workPerLevel * Math.max(1, levels) : 0;

  const submit = handleSubmit((values) => {
    order.mutate(values, { onSuccess: () => { reset(); onClose(); } });
  });

  return (
    <Dialog open={open} onClose={onClose} modal size="md" initialFocus="input">
      <h3 className="font-display text-base font-bold text-text-primary">New industry — {systemName}</h3>
      <p className="mb-4 mt-0.5 text-xs text-text-tertiary">
        Ordered work outranks autonomic proposals in the funding queue.
      </p>
      <form ref={formRef} onSubmit={submit} className="grid grid-cols-1 gap-6 sm:grid-cols-[1fr_260px]" noValidate>
        <div>
          <Controller
            control={control}
            name="buildingType"
            render={({ field }) => (
              <SelectInput
                label="Building"
                value={field.value}
                onChange={field.onChange}
                options={options.map((o) => ({ value: o.buildingType, label: o.label }))}
                error={errors.buildingType?.message}
                menuPortalTarget={dialogEl}
              />
            )}
          />
          <div className="mt-3">
            <NumberInput
              id="build-dialog-levels"
              label="Levels"
              min={1}
              max={option?.maxLevels ?? 1}
              error={errors.levels?.message}
              {...register("levels", { valueAsNumber: true })}
            />
          </div>
          {overCeiling && option && (
            <InlineAlert variant="error" className="mt-3">
              {option.blocked === "no_deposit_slots"
                ? "No free deposit slots for that building here."
                : `Not enough space — ${option.maxLevels} level(s) fit here.`}
            </InlineAlert>
          )}
          {!overCeiling && staffingShort && (
            <InlineAlert variant="warning" className="mt-3">
              Staffing shortfall — this adds labour demand your population can&apos;t fill. It will run
              under-staffed and exposed to decay.
            </InlineAlert>
          )}
        </div>
        <div className="self-start border border-border bg-surface-hover p-3.5">
          <p className="mb-2 font-display text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
            Feasibility — {systemName}
          </p>
          {option && (
            <>
              <ReadoutRow
                label="Max levels"
                value={String(option.maxLevels)}
                tone={overCeiling ? "bad" : "ok"}
              />
              <ReadoutRow label="Labour added" value={labourAddedText(option.labourAdded, levels)} />
              <ReadoutRow
                label="Est. staffing"
                value={`${Math.round(option.estStaffing * 100)}%`}
                tone={staffingShort ? "warn" : "ok"}
              />
              <ReadoutRow label="Work" value={String(totalWork)} />
              <ReadoutRow label="ETA" value={formatEta(option.etaPulses)} />
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!option || overCeiling || invalidLevels || order.isPending}
          >
            Queue build
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
