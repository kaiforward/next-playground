"use client";

import { useState } from "react";
import type { TradeMissionInfo, ShipState } from "@/lib/types/game";
import { useDeliverMission } from "@/lib/hooks/use-mission-mutations";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCredits } from "@/lib/utils/format";
import { InlineAlert } from "@/components/ui/inline-alert";

interface DeliverableMissionsCardProps {
  missions: TradeMissionInfo[];
  ship: ShipState;
}

export function DeliverableMissionsCard({ missions, ship }: DeliverableMissionsCardProps) {
  const deliverMutation = useDeliverMission();
  const [error, setError] = useState<string | null>(null);

  if (missions.length === 0) return null;

  return (
    <Card variant="bordered" padding="md">
      <CardHeader
        title="Deliverable Missions"
        subtitle={`${missions.length} mission${missions.length !== 1 ? "s" : ""} ready to deliver`}
      />
      <CardContent>
        {error && (
          <InlineAlert className="mb-3">{error}</InlineAlert>
        )}

        <ul className="space-y-2">
          {missions.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-surface"
            >
              <div>
                <span className="text-sm font-medium text-white">
                  {m.goodName} x{m.quantity}
                </span>
                <span className="text-sm text-green-400 ml-2">
                  {formatCredits(m.reward)}
                </span>
              </div>
              <Button
                variant="pill"
                color="green"
                size="sm"
                disabled={deliverMutation.isPending}
                onClick={async () => {
                  setError(null);
                  try {
                    await deliverMutation.mutateAsync({
                      missionId: m.id,
                      shipId: ship.id,
                    });
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Failed to deliver");
                  }
                }}
              >
                Deliver
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
