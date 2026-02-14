"use client";

import { useMemo } from "react";
import type { FleetState } from "@/lib/types/game";
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
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-5 h-5"
            >
              <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.798 7.45c.512-.67 1.135-.95 1.702-.95s1.19.28 1.702.95a.75.75 0 001.192-.91C12.637 5.55 11.596 5 10.5 5s-2.137.55-2.894 1.54A5.205 5.205 0 006.83 8H5.75a.75.75 0 000 1.5h.77a6.333 6.333 0 000 1h-.77a.75.75 0 000 1.5h1.08c.183.528.442 1.023.776 1.46C8.363 14.45 9.404 15 10.5 15s2.137-.55 2.894-1.54a.75.75 0 00-1.192-.91c-.512.67-1.135.95-1.702.95s-1.19-.28-1.702-.95a3.505 3.505 0 01-.343-.55h1.795a.75.75 0 000-1.5H8.026a4.835 4.835 0 010-1h2.224a.75.75 0 000-1.5H8.455c.098-.195.212-.38.343-.55z" />
            </svg>
          }
        />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-white/50">Ships</span>
            <span className="text-sm font-medium text-white">
              {fleet.ships.length}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-white/50">Docked</span>
            <span className="text-sm font-medium text-green-400">
              {docked}
            </span>
          </div>
          {inTransit > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-white/50">In Transit</span>
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
