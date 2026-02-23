"use client";

import { useState, useCallback } from "react";
import type { ShipState } from "@/lib/types/game";
import {
  useCreateConvoyMutation,
  useAddMembersBatchMutation,
} from "@/lib/hooks/use-convoy";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShipPickerList } from "./ship-picker-list";

type ConvoyShipDialogProps = {
  open: boolean;
  onClose: () => void;
  availableShips: ShipState[];
  showSystem?: boolean;
} & (
  | { mode: "create" }
  | { mode: "add"; convoyId: string; convoyName: string }
);

export function ConvoyShipDialog(props: ConvoyShipDialogProps) {
  const { open, onClose, availableShips, showSystem, mode } = props;
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const createMutation = useCreateConvoyMutation();
  const addBatchMutation = useAddMembersBatchMutation(
    mode === "add" ? props.convoyId : "",
  );

  const mutation = mode === "create" ? createMutation : addBatchMutation;

  const toggleShip = useCallback((shipId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(shipId)) {
        next.delete(shipId);
      } else {
        next.add(shipId);
      }
      return next;
    });
  }, []);

  const handleClose = useCallback(() => {
    setSelected(new Set());
    mutation.reset();
    onClose();
  }, [onClose, mutation]);

  const selectedArr = availableShips.filter((s) => selected.has(s.id));

  // Same-system check for create mode when ships span systems
  const systemIds = new Set(selectedArr.map((s) => s.systemId));
  const sameSystem = systemIds.size <= 1;

  const minRequired = mode === "create" ? 2 : 1;
  const canSubmit = selectedArr.length >= minRequired && sameSystem && !mutation.isPending;

  const handleSubmit = async () => {
    const shipIds = selectedArr.map((s) => s.id);
    if (mode === "create") {
      await createMutation.mutateAsync({ shipIds });
    } else {
      await addBatchMutation.mutateAsync(shipIds);
    }
    handleClose();
  };

  const title = mode === "create" ? "Form Convoy" : `Add Ships to ${props.mode === "add" ? props.convoyName : ""}`;
  const buttonLabel = mode === "create"
    ? `Form Convoy (${selectedArr.length} ships)`
    : `Add ${selectedArr.length} ship${selectedArr.length !== 1 ? "s" : ""}`;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      modal
      size="sm"
    >
      <h2 className="text-lg font-bold text-white mb-1">{title}</h2>
      <p className="text-xs text-white/40 mb-4">
        {mode === "create"
          ? "Select 2 or more ships to form a convoy."
          : "Select ships to add to the convoy."}
      </p>

      <ShipPickerList
        ships={availableShips}
        selected={selected}
        onToggle={toggleShip}
        showSystem={showSystem}
      />

      {showSystem && selectedArr.length >= 2 && !sameSystem && (
        <p className="text-xs text-amber-400 mt-2">Selected ships must be at the same station.</p>
      )}

      {mutation.error && (
        <p className="text-sm text-red-400 mt-2">{mutation.error.message}</p>
      )}

      <div className="mt-4 space-y-2">
        <Button
          variant="action"
          color="blue"
          size="md"
          fullWidth
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {mutation.isPending ? "Working..." : buttonLabel}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          fullWidth
          onClick={handleClose}
        >
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}
