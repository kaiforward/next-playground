"use client";

import { useState, useCallback, useMemo } from "react";
import type { ShipState } from "@/lib/types/game";
import {
  useCreateConvoyMutation,
  useAddMembersBatchMutation,
  useRemoveMembersBatchMutation,
} from "@/lib/hooks/use-convoy";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { ShipPickerList } from "./ship-picker-list";

type ConvoyShipDialogProps = {
  open: boolean;
  onClose: () => void;
  availableShips: ShipState[];
  showSystem?: boolean;
} & (
  | { mode: "create" }
  | { mode: "add"; convoyId: string; convoyName: string }
  | { mode: "manage"; convoyId: string; convoyName: string; members: ShipState[] }
);

export function ConvoyShipDialog(props: ConvoyShipDialogProps) {
  const { open, onClose, availableShips, showSystem, mode } = props;

  const initialMemberIds = useMemo(
    () => new Set(mode === "manage" ? props.members.map((m) => m.id) : []),
    [mode, mode === "manage" ? props.members : null],
  );

  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialMemberIds));

  // Reset selected when dialog opens with new initial members
  const [prevOpen, setPrevOpen] = useState(open);
  if (open && !prevOpen) {
    setSelected(new Set(initialMemberIds));
  }
  if (open !== prevOpen) {
    setPrevOpen(open);
  }

  const createMutation = useCreateConvoyMutation();
  const addBatchMutation = useAddMembersBatchMutation(
    mode === "add" || mode === "manage" ? props.convoyId : "",
  );
  const removeBatchMutation = useRemoveMembersBatchMutation(
    mode === "manage" ? props.convoyId : "",
  );

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
    createMutation.reset();
    addBatchMutation.reset();
    removeBatchMutation.reset();
    onClose();
  }, [onClose, createMutation, addBatchMutation, removeBatchMutation]);

  // Compute diffs for manage mode
  const toAdd = mode === "manage"
    ? [...selected].filter((id) => !initialMemberIds.has(id))
    : [];
  const toRemove = mode === "manage"
    ? [...initialMemberIds].filter((id) => !selected.has(id))
    : [];
  const hasChanges = toAdd.length > 0 || toRemove.length > 0;

  // For create/add modes, selected from available ships
  const selectedArr = mode === "manage"
    ? [] // not used in manage mode
    : availableShips.filter((s) => selected.has(s.id));

  // Same-system check for create mode when ships span systems
  const systemIds = mode !== "manage" ? new Set(selectedArr.map((s) => s.systemId)) : new Set<string>();
  const sameSystem = systemIds.size <= 1;

  const isPending = createMutation.isPending || addBatchMutation.isPending || removeBatchMutation.isPending;
  const mutationError = createMutation.error || addBatchMutation.error || removeBatchMutation.error;

  // Validation
  const canSubmit = (() => {
    if (isPending) return false;
    if (mode === "create") return selectedArr.length >= 2 && sameSystem;
    if (mode === "add") return selectedArr.length >= 1;
    // manage: must have changes and keep at least 2 members
    if (!hasChanges) return false;
    const keptMembers = mode === "manage" ? props.members.filter((m) => selected.has(m.id)).length : 0;
    const totalAfter = keptMembers + toAdd.length;
    return totalAfter >= 2;
  })();

  const handleSubmit = async () => {
    if (mode === "create") {
      const shipIds = selectedArr.map((s) => s.id);
      await createMutation.mutateAsync({ shipIds });
    } else if (mode === "add") {
      const shipIds = selectedArr.map((s) => s.id);
      await addBatchMutation.mutateAsync(shipIds);
    } else {
      // Manage mode: batch add new, batch remove deselected
      if (toAdd.length > 0) await addBatchMutation.mutateAsync(toAdd);
      if (toRemove.length > 0) await removeBatchMutation.mutateAsync(toRemove);
    }
    handleClose();
  };

  // Title & button label
  const title = mode === "create"
    ? "Form Convoy"
    : mode === "add"
      ? `Add Ships to ${props.convoyName}`
      : `Manage Ships — ${props.convoyName}`;

  const buttonLabel = (() => {
    if (mode === "create") return `Form Convoy (${selectedArr.length} ships)`;
    if (mode === "add") return `Add ${selectedArr.length} ship${selectedArr.length !== 1 ? "s" : ""}`;
    // manage
    if (!hasChanges) return "No changes";
    const parts: string[] = [];
    if (toAdd.length > 0) parts.push(`+${toAdd.length}`);
    if (toRemove.length > 0) parts.push(`-${toRemove.length}`);
    return `Save Changes (${parts.join(", ")})`;
  })();

  const description = mode === "create"
    ? "Select 2 or more ships to form a convoy."
    : mode === "add"
      ? "Select ships to add to the convoy."
      : "Toggle ships in or out of the convoy. At least 2 must remain.";

  // Manage mode: warn if total would be < 2
  const manageMembers = mode === "manage" ? props.members : [];
  const keptCount = manageMembers.filter((m) => selected.has(m.id)).length;
  const totalAfter = keptCount + toAdd.length;
  const showMinWarning = mode === "manage" && hasChanges && totalAfter < 2;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      modal
      size="sm"
    >
      <h2 className="text-lg font-bold text-white mb-1">{title}</h2>
      <p className="text-xs text-text-muted mb-4">{description}</p>

      {mode === "manage" ? (
        <>
          {manageMembers.length > 0 && (
            <div className="mb-3">
              <SectionHeader className="mb-1.5">
                In Convoy ({manageMembers.filter((m) => selected.has(m.id)).length})
              </SectionHeader>
              <ShipPickerList
                ships={manageMembers}
                selected={selected}
                onToggle={toggleShip}
              />
            </div>
          )}
          {availableShips.length > 0 && (
            <div>
              <SectionHeader className="mb-1.5">
                Available ({availableShips.filter((s) => selected.has(s.id)).length}/{availableShips.length})
              </SectionHeader>
              <ShipPickerList
                ships={availableShips}
                selected={selected}
                onToggle={toggleShip}
              />
            </div>
          )}
        </>
      ) : (
        <ShipPickerList
          ships={availableShips}
          selected={selected}
          onToggle={toggleShip}
          showSystem={showSystem}
        />
      )}

      {showSystem && selectedArr.length >= 2 && !sameSystem && (
        <p className="text-xs text-amber-400 mt-2">Selected ships must be at the same station.</p>
      )}

      {showMinWarning && (
        <p className="text-xs text-amber-400 mt-2">A convoy requires at least 2 ships. It will be disbanded.</p>
      )}

      {mutationError && (
        <p className="text-sm text-red-400 mt-2">{mutationError.message}</p>
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
          {isPending ? "Working..." : buttonLabel}
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
