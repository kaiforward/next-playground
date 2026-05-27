"use client";

import type { ConvoyState } from "@/lib/types/game";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export interface CompactConvoyCardProps {
  convoy: ConvoyState;
  systemId: string;
  onNavigate: (convoy: ConvoyState) => void;
}

export function CompactConvoyCard({ convoy, systemId, onNavigate }: CompactConvoyCardProps) {
  const memberCount = convoy.members.length;
  return (
    <div className="bg-surface border border-border border-l-2 border-l-violet-500 px-2.5 py-2 flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-semibold text-text-primary truncate">
            {convoy.name ?? "Convoy"}
          </span>
          <Badge color="purple">{memberCount} {memberCount === 1 ? "ship" : "ships"}</Badge>
        </div>
        <span className="text-xs text-text-tertiary shrink-0 font-mono">
          {convoy.combinedCargoMax} cargo
        </span>
      </div>
      <div className="flex gap-1">
        <Button
          onClick={() => onNavigate(convoy)}
          variant="action"
          color="accent"
          size="xs"
          className="flex-1"
        >
          Navigate
        </Button>
        <Button
          href={`/system/${systemId}/market?tradeConvoyId=${convoy.id}`}
          variant="ghost"
          size="xs"
          className="flex-1"
        >
          Trade
        </Button>
      </div>
    </div>
  );
}
