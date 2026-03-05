"use client";

import { useMemo } from "react";
import type { FleetState } from "@/lib/types/game";
import { CircleDollarSign } from "lucide-react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { StatDisplay } from "@/components/ui/stat-display";
import { formatCredits } from "@/lib/utils/format";

interface PlayerSummaryProps {
  fleet: FleetState;
}

export function PlayerSummary({ fleet }: PlayerSummaryProps) {
  const docked = useMemo(() => fleet.ships.filter((s) => s.status === "docked").length, [fleet.ships]);
  const inTransit = useMemo(() => fleet.ships.filter((s) => s.status === "in_transit").length, [fleet.ships]);

  return (
    <Card variant="bordered" padding="md">
      <CardHeader title="Commander Overview" subtitle="Your fleet status" />
      <CardContent className="space-y-4">
        <StatDisplay
          label="Credits"
          value={formatCredits(fleet.credits)}
          icon={<CircleDollarSign className="w-5 h-5" />}
        />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-tertiary">Ships</span>
            <span className="text-sm font-medium text-text-primary">
              {fleet.ships.length}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-text-tertiary">Docked</span>
            <span className="text-sm font-medium text-green-400">
              {docked}
            </span>
          </div>
          {inTransit > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-text-tertiary">In Transit</span>
              <span className="text-sm font-medium text-amber-400">
                {inTransit}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
