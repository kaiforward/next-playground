"use client";

import { useOrderBuild } from "@/lib/hooks/use-construction-orders";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { formatEta } from "@/lib/utils/construction-format";
import type { BuildOptionData } from "@/lib/types/api";

const BLOCK_COPY = {
  no_space: "No space left for this building here.",
  no_deposit_slots: "No free deposit slots here.",
} as const;

/**
 * One-click "+1 level" order for a ledger row. The ledger itself is the feasibility readout, so the
 * tooltip carries only the quick numbers (work · ≈pulses); a hard-blocked row disables with its
 * reason. Bare TooltipTrigger — a square icon button already reads as a control.
 */
export function QuickAddButton({ systemId, option }: { systemId: string; option: BuildOptionData }) {
  const order = useOrderBuild(systemId);
  const blocked = option.maxLevels === 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`Queue +1 ${option.label} level`}
          disabled={blocked || order.isPending}
          onClick={() => order.mutate({ buildingType: option.buildingType, levels: 1 })}
          className="inline-flex h-5 w-5 items-center justify-center border border-accent/40 bg-accent/10 font-mono text-[13px] leading-none text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-35 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          +
        </button>
      </TooltipTrigger>
      <TooltipContent side="left">
        {blocked && option.blocked ? (
          <p className="text-[11px] text-text-secondary">{BLOCK_COPY[option.blocked]}</p>
        ) : (
          <p className="font-mono text-[11px] text-text-secondary">
            +1 level · {option.workPerLevel} work · {formatEta(option.etaPulses)}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
