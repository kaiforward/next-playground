"use client";

import { useState } from "react";
import Link from "next/link";
import type { MissionInfo, FleetState } from "@/lib/types/game";
import { useAcceptOpMission, useAbandonOpMission, useStartOpMission } from "@/lib/hooks/use-op-mission-mutations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { SelectInput, type SelectOption } from "@/components/form/select-input";
import { formatCredits } from "@/lib/utils/format";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { MISSION_TYPE_DEFS, type MissionType, type StatGateKey } from "@/lib/constants/missions";
import { ENEMY_TIERS, type EnemyTier } from "@/lib/constants/combat";

interface OperationsPanelProps {
  available: MissionInfo[];
  active: MissionInfo[];
  systemId: string;
  fleet: FleetState | null;
  currentTick: number;
}

const TYPE_COLORS: Record<string, "red" | "cyan" | "purple" | "amber" | "green"> = {
  patrol: "red",
  survey: "cyan",
  bounty: "purple",
  salvage: "amber",
  recon: "green",
};

const TIER_COLORS: Record<string, "green" | "amber" | "red"> = {
  weak: "green",
  moderate: "amber",
  strong: "red",
};

export function OperationsPanel({
  available,
  active,
  systemId,
  fleet,
  currentTick,
}: OperationsPanelProps) {
  return (
    <div className="space-y-8">
      <AvailableOperations missions={available} />
      {active.length > 0 && (
        <ActiveOperations
          missions={active}
          fleet={fleet}
          currentTick={currentTick}
        />
      )}
    </div>
  );
}

// ── Available Operations ────────────────────────────────────────

function AvailableOperations({
  missions,
}: {
  missions: MissionInfo[];
}) {
  const acceptMutation = useAcceptOpMission();
  const [error, setError] = useState<string | null>(null);

  return (
    <Card variant="bordered" padding="md">
      <CardHeader
        title="Available Operations"
        subtitle={`${missions.length} mission${missions.length !== 1 ? "s" : ""} at this station`}
      />
      <CardContent>
        {error && (
          <InlineAlert className="mb-4">{error}</InlineAlert>
        )}

        {missions.length === 0 ? (
          <EmptyState message="No operational missions available right now." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="px-4 py-3 text-xs font-semibold text-white/50 uppercase tracking-wider">Type</th>
                  <th className="px-4 py-3 text-xs font-semibold text-white/50 uppercase tracking-wider">Target</th>
                  <th className="px-4 py-3 text-xs font-semibold text-white/50 uppercase tracking-wider">Requirements</th>
                  <th className="px-4 py-3 text-xs font-semibold text-white/50 uppercase tracking-wider">Reward</th>
                  <th className="px-4 py-3 text-xs font-semibold text-white/50 uppercase tracking-wider">Time</th>
                  <th className="px-4 py-3 text-xs font-semibold text-white/50 uppercase tracking-wider"></th>
                </tr>
              </thead>
              <tbody>
                {missions.map((m) => {
                  const typeDef = MISSION_TYPE_DEFS[m.type as MissionType];

                  return (
                    <tr key={m.id} className="border-b border-white/5">
                      <td className="px-4 py-3">
                        <Badge color={TYPE_COLORS[m.type] ?? "slate"}>
                          {typeDef?.name ?? m.type}
                        </Badge>
                        {m.enemyTier && (
                          <Badge color={TIER_COLORS[m.enemyTier] ?? "slate"} className="ml-1">
                            {ENEMY_TIERS[m.enemyTier as EnemyTier]?.name ?? m.enemyTier}
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-white/80">
                        <Link
                          href={`/system/${m.targetSystemId}`}
                          className="text-indigo-300 hover:text-indigo-200 transition-colors"
                        >
                          {m.targetSystemName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-white/50 text-xs">
                        {Object.entries(m.statRequirements).map(([stat, val]) => (
                          <span key={stat} className="mr-2">
                            {stat} {val}+
                          </span>
                        ))}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-green-400 font-medium">
                          {formatCredits(m.reward)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-white/60">
                        {m.durationTicks != null
                          ? `${m.durationTicks} ticks`
                          : "Battle"}
                        <div className="text-xs text-white/30">
                          {m.ticksRemaining}t left
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={acceptMutation.isPending}
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Active Operations ───────────────────────────────────────────

function ActiveOperations({
  missions,
  fleet,
  currentTick,
}: {
  missions: MissionInfo[];
  fleet: FleetState | null;
  currentTick: number;
}) {
  const abandonMutation = useAbandonOpMission();
  const startMutation = useStartOpMission();
  const [error, setError] = useState<string | null>(null);
  const [selectedShips, setSelectedShips] = useState<Record<string, string>>({});

  return (
    <Card variant="bordered" padding="md">
      <CardHeader
        title="Your Active Operations"
        subtitle={`${missions.length} active mission${missions.length !== 1 ? "s" : ""}`}
      />
      <CardContent>
        {error && (
          <InlineAlert className="mb-4">{error}</InlineAlert>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-white/10">
                <th className="px-4 py-3 text-xs font-semibold text-white/50 uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-xs font-semibold text-white/50 uppercase tracking-wider">Target</th>
                <th className="px-4 py-3 text-xs font-semibold text-white/50 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-xs font-semibold text-white/50 uppercase tracking-wider">Reward</th>
                <th className="px-4 py-3 text-xs font-semibold text-white/50 uppercase tracking-wider"></th>
              </tr>
            </thead>
            <tbody>
              {missions.map((m) => {
                const typeDef = MISSION_TYPE_DEFS[m.type as MissionType];

                // Compute progress for timed missions
                let progressText: string = m.status;
                if (m.status === "in_progress" && m.durationTicks != null && m.startedAtTick != null) {
                  const elapsed = currentTick - m.startedAtTick;
                  const remaining = Math.max(0, m.durationTicks - elapsed);
                  progressText = `${remaining} ticks remaining`;
                } else if (m.status === "accepted") {
                  progressText = "Assign a ship to start";
                } else if (m.status === "in_progress" && m.type === "bounty") {
                  progressText = "In battle";
                }

                // For accepted missions, build eligible ship list
                const eligible: Array<{ id: string; name: string }> = [];
                if (m.status === "accepted" && fleet) {
                  const statReqs = m.statRequirements;
                  for (const ship of fleet.ships) {
                    if (ship.status !== "docked") continue;
                    if (ship.systemId !== m.targetSystemId) continue;
                    if (ship.disabled) continue;
                    if (ship.convoyId) continue;
                    if (ship.activeMission) continue;
                    // Check stat gates
                    const stats: Record<string, number> = {
                      firepower: ship.firepower,
                      sensors: ship.sensors,
                      hullMax: ship.hullMax,
                      stealth: ship.stealth,
                    };
                    let meets = true;
                    for (const [stat, required] of Object.entries(statReqs)) {
                      if ((stats[stat] ?? 0) < required) {
                        meets = false;
                        break;
                      }
                    }
                    if (meets) eligible.push({ id: ship.id, name: ship.name });
                  }
                }

                const selectedShipId = selectedShips[m.id] ?? eligible[0]?.id;

                return (
                  <tr key={m.id} className="border-b border-white/5">
                    <td className="px-4 py-3">
                      <Badge color={TYPE_COLORS[m.type] ?? "slate"}>
                        {typeDef?.name ?? m.type}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-white/80">
                      <Link
                        href={`/system/${m.targetSystemId}`}
                        className="text-indigo-300 hover:text-indigo-200 transition-colors"
                      >
                        {m.targetSystemName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-white/60">
                      {progressText}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-green-400 font-medium">
                        {formatCredits(m.reward)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {/* Start button for accepted missions */}
                        {m.status === "accepted" && (
                          <>
                            {eligible.length > 0 ? (
                              <>
                                {eligible.length > 1 && (
                                  <div className="w-36">
                                    <SelectInput
                                      size="sm"
                                      options={eligible.map((s): SelectOption => ({
                                        value: s.id,
                                        label: s.name,
                                      }))}
                                      value={selectedShipId ?? ""}
                                      onChange={(value) =>
                                        setSelectedShips((prev) => ({ ...prev, [m.id]: value }))
                                      }
                                      isSearchable={false}
                                    />
                                  </div>
                                )}
                                <Button
                                  variant="primary"
                                  size="sm"
                                  disabled={!selectedShipId || startMutation.isPending}
                                  onClick={async () => {
                                    if (!selectedShipId) return;
                                    setError(null);
                                    try {
                                      await startMutation.mutateAsync({
                                        missionId: m.id,
                                        shipId: selectedShipId,
                                      });
                                    } catch (e) {
                                      setError(e instanceof Error ? e.message : "Failed to start");
                                    }
                                  }}
                                >
                                  Start
                                </Button>
                              </>
                            ) : (
                              <span className="text-xs text-white/30">No ship at target</span>
                            )}
                          </>
                        )}

                        {/* Abandon button for accepted and non-bounty in_progress */}
                        {(m.status === "accepted" || (m.status === "in_progress" && m.type !== "bounty")) && (
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
                        )}
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
