"use client";

import { useState } from "react";
import Link from "next/link";
import { usePlayerMissions } from "@/lib/hooks/use-player-missions";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useDeliverMission, useAbandonMission } from "@/lib/hooks/use-mission-mutations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCredits } from "@/lib/utils/format";
import { InlineAlert } from "@/components/ui/inline-alert";

export function MissionsTab() {
  const { missions } = usePlayerMissions();
  const { fleet } = useFleet();
  const deliverMutation = useDeliverMission();
  const abandonMutation = useAbandonMission();
  const [error, setError] = useState<string | null>(null);

  if (missions.length === 0) {
    return (
      <div className="p-6 text-center">
        <p className="text-text-faint text-sm">No active missions.</p>
        <p className="text-white/20 text-xs mt-1">
          Visit a station&apos;s Contracts tab to find work.
        </p>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <InlineAlert className="mx-4 mt-3 text-xs">{error}</InlineAlert>
      )}

      <ul className="divide-y divide-white/5">
        {missions.map((m) => {
          // Find ships docked at destination with enough of the right cargo
          const eligibleShip = fleet.ships.find((s) => {
            if (s.status !== "docked" || s.systemId !== m.destinationId) return false;
            const cargoItem = s.cargo.find((c) => c.goodId === m.goodId);
            return (cargoItem?.quantity ?? 0) >= m.quantity;
          });

          return (
            <li key={m.id} className="px-4 py-3 hover:bg-surface-hover transition-colors">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">
                    {m.goodName} x{m.quantity}
                  </span>
                  {m.isImport ? (
                    <Badge color="cyan">Import</Badge>
                  ) : (
                    <Badge color="amber">Export</Badge>
                  )}
                  {m.eventId && (
                    <Badge color="purple">Event</Badge>
                  )}
                </div>
                <span className="text-sm font-medium text-green-400">
                  ~{formatCredits(m.estimatedGoodsValue + m.reward)}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-text-muted">
                <span>
                  Deliver to{" "}
                  <Link
                    href={`/system/${m.destinationId}/contracts`}
                    className="text-indigo-300 hover:text-indigo-200 transition-colors"
                  >
                    {m.destinationName}
                  </Link>
                  {m.hops > 0 && (
                    <span className="ml-1">({m.hops} hop{m.hops !== 1 ? "s" : ""})</span>
                  )}
                </span>
                <span className={m.ticksRemaining < 50 ? "text-amber-400" : ""}>
                  {m.ticksRemaining} ticks left
                </span>
              </div>
              <div className="text-xs text-text-faint mt-0.5">
                {formatCredits(m.estimatedGoodsValue)} sale + {formatCredits(m.reward)} bonus
              </div>
              <div className="flex items-center gap-2 mt-2">
                {eligibleShip && (
                  <Button
                    variant="action"
                    color="green"
                    size="xs"
                    disabled={deliverMutation.isPending}
                    onClick={async () => {
                      setError(null);
                      try {
                        await deliverMutation.mutateAsync({
                          missionId: m.id,
                          shipId: eligibleShip.id,
                        });
                      } catch (e) {
                        setError(e instanceof Error ? e.message : "Failed to deliver");
                      }
                    }}
                  >
                    Deliver via {eligibleShip.name}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={abandonMutation.isPending}
                  onClick={async () => {
                    setError(null);
                    try {
                      await abandonMutation.mutateAsync(m.id);
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Failed to abandon");
                    }
                  }}
                >
                  Abandon
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
