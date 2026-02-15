"use client";

import { useState } from "react";
import Link from "next/link";
import type { TradeMissionInfo, FleetState } from "@/lib/types/game";
import { useAcceptMission, useDeliverMission, useAbandonMission } from "@/lib/hooks/use-mission-mutations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { formatCredits } from "@/lib/utils/format";

interface ContractsPanelProps {
  available: TradeMissionInfo[];
  active: TradeMissionInfo[];
  systemId: string;
  fleet: FleetState | null;
  currentTick: number;
}

export function ContractsPanel({
  available,
  active,
  systemId,
  fleet,
  currentTick,
}: ContractsPanelProps) {
  return (
    <div className="space-y-8">
      <AvailableContracts
        missions={available}
        systemId={systemId}
        fleet={fleet}
      />
      <ActiveMissions
        missions={active}
        systemId={systemId}
        fleet={fleet}
        currentTick={currentTick}
      />
    </div>
  );
}

// ── Available Contracts ─────────────────────────────────────────

function AvailableContracts({
  missions,
  systemId,
  fleet,
}: {
  missions: TradeMissionInfo[];
  systemId: string;
  fleet: FleetState | null;
}) {
  const acceptMutation = useAcceptMission();
  const [error, setError] = useState<string | null>(null);

  const hasDockedShipHere = fleet?.ships.some(
    (s) => s.status === "docked" && s.systemId === systemId,
  ) ?? false;

  return (
    <Card variant="bordered" padding="md">
      <CardHeader
        title="Available Contracts"
        subtitle={`${missions.length} contract${missions.length !== 1 ? "s" : ""} at this station`}
      />
      <CardContent>
        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {missions.length === 0 ? (
          <p className="text-white/30 text-sm text-center py-6">
            No contracts available at this station right now.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="px-4 py-3 text-xs font-semibold text-white/50 uppercase tracking-wider">Type</th>
                  <th className="px-4 py-3 text-xs font-semibold text-white/50 uppercase tracking-wider">Cargo</th>
                  <th className="px-4 py-3 text-xs font-semibold text-white/50 uppercase tracking-wider">Destination</th>
                  <th className="px-4 py-3 text-xs font-semibold text-white/50 uppercase tracking-wider">Payout</th>
                  <th className="px-4 py-3 text-xs font-semibold text-white/50 uppercase tracking-wider">Time Left</th>
                  <th className="px-4 py-3 text-xs font-semibold text-white/50 uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody>
                {missions.map((m) => (
                  <tr key={m.id} className="border-b border-white/5">
                    <td className="px-4 py-3">
                      {m.isImport ? (
                        <Badge color="cyan">Import</Badge>
                      ) : (
                        <Badge color="amber">Export</Badge>
                      )}
                      {m.eventId && (
                        <Badge color="purple" className="ml-1">Event</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-white/80">
                      {m.goodName} x{m.quantity}
                    </td>
                    <td className="px-4 py-3 text-white/80">
                      {m.isImport ? (
                        <span className="text-white/40">Here</span>
                      ) : (
                        <Link
                          href={`/map?systemId=${m.destinationId}`}
                          className="text-indigo-300 hover:text-indigo-200 transition-colors"
                        >
                          {m.destinationName}
                          <span className="text-white/40 ml-1">({m.hops}h)</span>
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-green-400 font-medium">
                        ~{formatCredits(m.estimatedGoodsValue + m.reward)}
                      </div>
                      <div className="text-xs text-white/30">
                        {formatCredits(m.estimatedGoodsValue)} sale + {formatCredits(m.reward)} bonus
                      </div>
                    </td>
                    <td className="px-4 py-3 text-white/60">
                      {m.ticksRemaining} ticks
                    </td>
                    <td className="px-4 py-3">
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={!hasDockedShipHere || acceptMutation.isPending}
                        onClick={async () => {
                          setError(null);
                          try {
                            await acceptMutation.mutateAsync(m.id);
                          } catch (e) {
                            setError(e instanceof Error ? e.message : "Failed to accept");
                          }
                        }}
                      >
                        Accept
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Active Missions ─────────────────────────────────────────────

function ActiveMissions({
  missions,
  systemId,
  fleet,
  currentTick,
}: {
  missions: TradeMissionInfo[];
  systemId: string;
  fleet: FleetState | null;
  currentTick: number;
}) {
  const deliverMutation = useDeliverMission();
  const abandonMutation = useAbandonMission();
  const [error, setError] = useState<string | null>(null);
  const [selectedShips, setSelectedShips] = useState<Record<string, string>>({});

  if (missions.length === 0) {
    return (
      <Card variant="bordered" padding="md">
        <CardHeader title="Your Active Missions" subtitle="No active missions" />
        <CardContent>
          <p className="text-white/30 text-sm text-center py-6">
            Accept contracts above to start earning rewards.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Find ships docked at each destination for delivery
  const dockedShipsBySystem = new Map<string, Array<{ id: string; name: string; cargoQty: number }>>();
  if (fleet) {
    for (const ship of fleet.ships) {
      if (ship.status !== "docked") continue;
      const existing = dockedShipsBySystem.get(ship.systemId) ?? [];
      existing.push({
        id: ship.id,
        name: ship.name,
        cargoQty: ship.cargo.reduce((sum, c) => sum + c.quantity, 0),
      });
      dockedShipsBySystem.set(ship.systemId, existing);
    }
  }

  return (
    <Card variant="bordered" padding="md">
      <CardHeader
        title="Your Active Missions"
        subtitle={`${missions.length} active mission${missions.length !== 1 ? "s" : ""}`}
      />
      <CardContent>
        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-white/10">
                <th className="px-4 py-3 text-xs font-semibold text-white/50 uppercase tracking-wider">Cargo</th>
                <th className="px-4 py-3 text-xs font-semibold text-white/50 uppercase tracking-wider">Destination</th>
                <th className="px-4 py-3 text-xs font-semibold text-white/50 uppercase tracking-wider">Payout</th>
                <th className="px-4 py-3 text-xs font-semibold text-white/50 uppercase tracking-wider">Time Left</th>
                <th className="px-4 py-3 text-xs font-semibold text-white/50 uppercase tracking-wider"></th>
              </tr>
            </thead>
            <tbody>
              {missions.map((m) => {
                const shipsAtDest = dockedShipsBySystem.get(m.destinationId) ?? [];
                const canDeliver = shipsAtDest.length > 0;
                const isExpired = currentTick > m.deadlineTick;

                // Find ships with enough of the right cargo
                const eligibleShips = fleet
                  ? shipsAtDest.filter((s) => {
                      const ship = fleet.ships.find((fs) => fs.id === s.id);
                      if (!ship) return false;
                      const cargoItem = ship.cargo.find((c) => c.goodId === m.goodId);
                      return (cargoItem?.quantity ?? 0) >= m.quantity;
                    })
                  : [];

                const selectedShipId = selectedShips[m.id] ?? eligibleShips[0]?.id;

                return (
                  <tr key={m.id} className="border-b border-white/5">
                    <td className="px-4 py-3 text-white/80">
                      {m.goodName} x{m.quantity}
                      {m.eventId && (
                        <Badge color="purple" className="ml-2">Event</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/map?systemId=${m.destinationId}`}
                        className="text-indigo-300 hover:text-indigo-200 transition-colors"
                      >
                        {m.destinationName}
                        {m.destinationId !== m.systemId && (
                          <span className="text-white/40 ml-1">({m.hops}h)</span>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-green-400 font-medium">
                        ~{formatCredits(m.estimatedGoodsValue + m.reward)}
                      </div>
                      <div className="text-xs text-white/30">
                        {formatCredits(m.estimatedGoodsValue)} sale + {formatCredits(m.reward)} bonus
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {isExpired ? (
                        <span className="text-red-400">Expired</span>
                      ) : (
                        <span className="text-white/60">{m.ticksRemaining} ticks</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {canDeliver && eligibleShips.length > 1 && (
                          <select
                            className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white"
                            value={selectedShipId ?? ""}
                            onChange={(e) =>
                              setSelectedShips((prev) => ({ ...prev, [m.id]: e.target.value }))
                            }
                          >
                            {eligibleShips.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        )}
                        {eligibleShips.length > 0 && selectedShipId && (
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
                                  shipId: selectedShipId,
                                });
                              } catch (e) {
                                setError(e instanceof Error ? e.message : "Failed to deliver");
                              }
                            }}
                          >
                            Deliver
                          </Button>
                        )}
                        <Button
                          variant="action"
                          color="red"
                          size="sm"
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
