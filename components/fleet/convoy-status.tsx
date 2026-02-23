"use client";

import type { ConvoyState } from "@/lib/types/game";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ConvoyStatusProps {
  convoys: ConvoyState[];
}

/** Read-only convoy overview for the dashboard. Shows status and location. */
export function ConvoyStatus({ convoys }: ConvoyStatusProps) {
  if (convoys.length === 0) return null;

  return (
    <div>
      <h2 className="text-lg font-semibold text-white mb-4">
        Convoys
        <span className="text-sm font-normal text-white/40 ml-2">{convoys.length}</span>
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {convoys.map((convoy) => (
          <Card key={convoy.id} variant="bordered" padding="sm">
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-white">
                  {convoy.name ?? "Convoy"}
                </span>
                <Badge color={convoy.status === "docked" ? "green" : "amber"}>
                  {convoy.status === "docked" ? "Docked" : "In Transit"}
                </Badge>
              </div>

              <div className="text-xs text-white/50">
                {convoy.system.name}
                {convoy.status === "in_transit" && convoy.destinationSystem && (
                  <span> → {convoy.destinationSystem.name}</span>
                )}
              </div>

              <div className="flex gap-1.5 flex-wrap">
                {convoy.members.map((ship) => (
                  <Badge key={ship.id} color="slate">{ship.name}</Badge>
                ))}
              </div>

              <div className="flex justify-between text-[10px] text-white/30">
                <span>{convoy.members.length} ships</span>
                <span>Cargo: {convoy.combinedCargoUsed}/{convoy.combinedCargoMax}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
