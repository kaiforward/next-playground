"use client";

import type { TransitUnit } from "@/lib/hooks/use-map-data";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export interface CompactTransitCardProps {
  unit: TransitUnit;
  /** Ticks remaining until arrival (already clamped to >= 0). */
  etaTicks: number;
  onClose: () => void;
}

export function CompactTransitCard({ unit, etaTicks, onClose }: CompactTransitCardProps) {
  return (
    <Card
      variant="bordered"
      padding="sm"
      className="absolute top-4 left-1/2 -translate-x-1/2 z-40 w-72 shadow-lg flex flex-col gap-2"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-semibold text-text-primary truncate">{unit.name}</span>
          {unit.kind === "convoy" && <Badge color="cyan">{unit.memberCount} ships</Badge>}
        </div>
        <Button
          variant="ghost"
          size="xs"
          onClick={onClose}
          className="shrink-0"
          aria-label="Deselect ship"
        >
          ✕
        </Button>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-text-tertiary">Destination</dt>
        <dd className="font-mono text-text-secondary text-right truncate">{unit.destinationName}</dd>
        <dt className="text-text-tertiary">ETA</dt>
        <dd className="font-mono text-text-accent text-right">{etaTicks} {etaTicks === 1 ? "tick" : "ticks"}</dd>
        <dt className="text-text-tertiary">Cargo</dt>
        <dd className="font-mono text-text-secondary text-right">{unit.cargoUsed}/{unit.cargoMax}</dd>
      </dl>
      {unit.kind === "ship" && (
        <Button href={`/ship/${unit.id}`} variant="ghost" size="xs" fullWidth>
          Ship details
        </Button>
      )}
    </Card>
  );
}
