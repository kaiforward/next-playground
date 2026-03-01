"use client";

import { useState, useMemo } from "react";
import type { ConvoyState, ShipState } from "@/lib/types/game";
import { formatCredits } from "@/lib/utils/format";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { RangeInput } from "@/components/form/range-input";

// ── Normalized plan shape ───────────────────────────────────────

export interface ConvoyActionShipEntry {
  shipId: string;
  shipName: string;
  /** Amount of the resource added (fuel or hull). */
  amount: number;
  /** Value after the action. */
  after: number;
  /** Ship maximum for this resource. */
  max: number;
  cost: number;
}

export interface ConvoyActionPlan {
  ships: ConvoyActionShipEntry[];
  totalUnits: number;
  totalCost: number;
}

// ── Props ───────────────────────────────────────────────────────

interface ConvoyActionDialogProps {
  title: string;
  convoy: ConvoyState;
  playerCredits: number;
  open: boolean;
  onClose: () => void;
  computePlan: (members: ShipState[], fraction: number) => ConvoyActionPlan;
  barLabel: string;
  unitLabel: string;
  totalLabel: string;
  barColor: (pct: number) => "red" | "blue" | "green" | "amber" | "purple";
  actionColor: "blue" | "green";
  actionLabel: string;
  pendingLabel: string;
  mutation: {
    mutateAsync: (fraction: number) => Promise<unknown>;
    isPending: boolean;
    error: Error | null;
  };
}

export function ConvoyActionDialog({
  title,
  convoy,
  playerCredits,
  open,
  onClose,
  computePlan,
  barLabel,
  unitLabel,
  totalLabel,
  barColor,
  actionColor,
  actionLabel,
  pendingLabel,
  mutation,
}: ConvoyActionDialogProps) {
  const [percent, setPercent] = useState(100);
  const fraction = percent / 100;

  const plan = useMemo(
    () => computePlan(convoy.members, fraction),
    [computePlan, convoy.members, fraction],
  );

  const canAfford = playerCredits >= plan.totalCost;
  const hasWork = plan.totalCost > 0;

  const handleAction = async () => {
    await mutation.mutateAsync(fraction);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      modal
      size="sm"
    >
      <h2 className="text-lg font-bold text-text-primary mb-1">
        {title}
      </h2>
      <p className="text-xs text-text-muted mb-5">
        {convoy.name ?? "Convoy"} &mdash; {convoy.members.length} ships
      </p>

      <div className="space-y-4">
        <RangeInput
          id="convoy-action-percent"
          label={`${actionLabel} Amount`}
          valueLabel={`${percent}%`}
          size="md"
          min={0}
          max={100}
          step={5}
          value={percent}
          onChange={(e) => setPercent(Number(e.target.value))}
        />

        {/* Per-ship preview */}
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {plan.ships.map((entry) => {
            if (entry.amount <= 0) return null;
            const pct = entry.max > 0 ? (entry.after / entry.max) * 100 : 100;
            return (
              <div key={entry.shipId} className="py-1.5 px-3 rounded bg-surface">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-text-primary font-medium">{entry.shipName}</span>
                  <span className="text-[10px] text-text-muted">
                    +{entry.amount} {unitLabel} &middot; {formatCredits(entry.cost)}
                  </span>
                </div>
                <ProgressBar
                  label={barLabel}
                  value={entry.after}
                  max={entry.max}
                  color={barColor(pct)}
                  size="sm"
                />
              </div>
            );
          })}
        </div>

        {/* Totals */}
        <div className="flex items-center justify-between text-sm border-t border-border pt-3">
          <span className="text-text-secondary">{totalLabel}</span>
          <span className="text-text-primary font-medium">
            +{plan.totalUnits} {unitLabel} &middot; {formatCredits(plan.totalCost)}
          </span>
        </div>

        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>Balance</span>
          <span className={!canAfford && hasWork ? "text-red-400" : ""}>
            {formatCredits(playerCredits)}
          </span>
        </div>

        {mutation.error && (
          <p className="text-xs text-red-400">{mutation.error.message}</p>
        )}

        <div className="flex gap-2">
          <Button
            variant="action"
            color={actionColor}
            size="md"
            className="flex-1"
            onClick={handleAction}
            disabled={!canAfford || !hasWork || mutation.isPending}
          >
            {mutation.isPending ? pendingLabel : `${actionLabel} ${formatCredits(plan.totalCost)}`}
          </Button>
          <Button variant="ghost" size="md" onClick={onClose} className="flex-1">
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
