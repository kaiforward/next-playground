"use client";

import type { UpgradeSlotState } from "@/lib/types/game";
import { MODULES } from "@/lib/constants/modules";
import { isModuleId } from "@/lib/types/guards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const SLOT_TYPE_LABELS: Record<string, string> = {
  engine: "Engine",
  cargo: "Cargo",
  defence: "Defence",
  systems: "Systems",
};

const SLOT_TYPE_COLORS: Record<string, "blue" | "amber" | "green" | "purple"> = {
  engine: "blue",
  cargo: "amber",
  defence: "green",
  systems: "purple",
};

interface UpgradeSlotProps {
  slot: UpgradeSlotState;
  onInstall?: (slot: UpgradeSlotState) => void;
  onRemove?: (slotId: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
}

export function UpgradeSlot({ slot, onInstall, onRemove, disabled, readOnly }: UpgradeSlotProps) {
  const mod = slot.moduleId && isModuleId(slot.moduleId) ? MODULES[slot.moduleId] : null;
  const tierLabel = mod && slot.moduleTier ? mod.tiers.find((t) => t.tier === slot.moduleTier)?.label : null;

  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-surface">
      <div className="flex items-center gap-2 min-w-0">
        <Badge color={SLOT_TYPE_COLORS[slot.slotType] ?? "slate"}>
          {SLOT_TYPE_LABELS[slot.slotType] ?? slot.slotType}
        </Badge>
        {mod ? (
          <span className="text-sm text-text-primary truncate">
            {mod.name}{tierLabel ? ` ${tierLabel}` : ""}
          </span>
        ) : (
          <span className="text-sm text-text-faint italic">Empty</span>
        )}
      </div>
      {!readOnly && (
        <div className="flex gap-1 shrink-0 ml-2">
          {mod ? (
            <Button
              variant="ghost"
              size="xs"
              className="text-red-400 hover:text-red-300"
              onClick={() => onRemove?.(slot.id)}
              disabled={disabled}
            >
              Remove
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="xs"
              className="text-blue-400 hover:text-blue-300"
              onClick={() => onInstall?.(slot)}
              disabled={disabled}
            >
              Install
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
