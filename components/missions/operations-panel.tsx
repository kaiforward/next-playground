"use client";

import { useState } from "react";
import Link from "next/link";
import type { MissionInfo, FleetState } from "@/lib/types/game";
import { useAcceptOpMission, useAbandonOpMission, useStartOpMission } from "@/lib/hooks/use-op-mission-mutations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { SelectInput, type SelectOption } from "@/components/form/select-input";
import { formatCredits } from "@/lib/utils/format";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { MISSION_TYPE_DEFS, type MissionType } from "@/lib/constants/missions";
import { ENEMY_TIERS, type EnemyTier } from "@/lib/constants/combat";
import { MISSION_TYPE_BADGE_COLOR, ENEMY_TIER_BADGE_COLOR } from "@/lib/constants/ui";

type OpRow = MissionInfo & Record<string, unknown>;

interface OperationsPanelProps {
  available: MissionInfo[];
  active: MissionInfo[];
  systemId: string;
  fleet: FleetState | null;
  currentTick: number;
}

export function OperationsPanel({
  available,
  active,
  systemId: _systemId,
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

  const columns: Column<OpRow>[] = [
    {
      key: "type",
      label: "Type",
      render: (row) => {
        const typeDef = MISSION_TYPE_DEFS[row.type as MissionType];
        return (
          <>
            <Badge color={MISSION_TYPE_BADGE_COLOR[row.type as MissionType] ?? "slate"}>
              {typeDef?.name ?? row.type}
            </Badge>
            {row.enemyTier && (
              <Badge color={ENEMY_TIER_BADGE_COLOR[row.enemyTier as EnemyTier] ?? "slate"} className="ml-1">
                {ENEMY_TIERS[row.enemyTier as EnemyTier]?.name ?? row.enemyTier}
              </Badge>
            )}
          </>
        );
      },
    },
    {
      key: "target",
      label: "Target",
      render: (row) => (
        <Link
          href={`/system/${row.targetSystemId}`}
          className="text-accent hover:text-accent-muted transition-colors"
        >
          {row.targetSystemName}
        </Link>
      ),
    },
    {
      key: "requirements",
      label: "Requirements",
      render: (row) => (
        <span className="text-text-tertiary text-xs">
          {Object.entries(row.statRequirements).map(([stat, val]) => (
            <span key={stat} className="mr-2">
              {stat} {val}+
            </span>
          ))}
        </span>
      ),
    },
    {
      key: "reward",
      label: "Reward",
      render: (row) => (
        <span className="text-green-400 font-medium">
          {formatCredits(row.reward)}
        </span>
      ),
    },
    {
      key: "time",
      label: "Time",
      render: (row) => (
        <>
          <span className="text-text-secondary">
            {row.durationTicks != null ? `${row.durationTicks} ticks` : "Battle"}
          </span>
          <div className="text-xs text-text-faint">
            {row.ticksRemaining}t left
          </div>
        </>
      ),
    },
    {
      key: "actions",
      label: "",
      render: (row) => (
        <Button
          variant="primary"
          size="sm"
          disabled={acceptMutation.isPending}
          onClick={async () => {
            setError(null);
            try {
              await acceptMutation.mutateAsync(row.id);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Failed to accept");
            }
          }}
        >
          Accept
        </Button>
      ),
    },
  ];

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
          <DataTable columns={columns} data={missions as OpRow[]} />
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

  const columns: Column<OpRow>[] = [
    {
      key: "type",
      label: "Type",
      render: (row) => {
        const typeDef = MISSION_TYPE_DEFS[row.type as MissionType];
        return (
          <Badge color={MISSION_TYPE_BADGE_COLOR[row.type as MissionType] ?? "slate"}>
            {typeDef?.name ?? row.type}
          </Badge>
        );
      },
    },
    {
      key: "target",
      label: "Target",
      render: (row) => (
        <Link
          href={`/system/${row.targetSystemId}`}
          className="text-accent hover:text-accent-muted transition-colors"
        >
          {row.targetSystemName}
        </Link>
      ),
    },
    {
      key: "status",
      label: "Status",
      render: (row) => {
        let progressText: string = row.status;
        if (row.status === "in_progress" && row.durationTicks != null && row.startedAtTick != null) {
          const elapsed = currentTick - row.startedAtTick;
          const remaining = Math.max(0, row.durationTicks - elapsed);
          progressText = `${remaining} ticks remaining`;
        } else if (row.status === "accepted") {
          progressText = "Assign a ship to start";
        } else if (row.status === "in_progress" && row.type === "bounty") {
          progressText = "In battle";
        }
        return <span className="text-text-secondary">{progressText}</span>;
      },
    },
    {
      key: "reward",
      label: "Reward",
      render: (row) => (
        <span className="text-green-400 font-medium">
          {formatCredits(row.reward)}
        </span>
      ),
    },
    {
      key: "actions",
      label: "",
      render: (row) => {
        // For accepted missions, build eligible ship list
        const eligible: Array<{ id: string; name: string }> = [];
        if (row.status === "accepted" && fleet) {
          const statReqs = row.statRequirements;
          for (const ship of fleet.ships) {
            if (ship.status !== "docked") continue;
            if (ship.systemId !== row.targetSystemId) continue;
            if (ship.disabled) continue;
            if (ship.convoyId) continue;
            if (ship.activeMission) continue;
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

        const selectedShipId = selectedShips[row.id] ?? eligible[0]?.id;

        return (
          <div className="flex items-center gap-2">
            {row.status === "accepted" && (
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
                            setSelectedShips((prev) => ({ ...prev, [row.id]: value }))
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
                            missionId: row.id,
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
                  <span className="text-xs text-text-faint">No ship at target</span>
                )}
              </>
            )}

            {(row.status === "accepted" || (row.status === "in_progress" && row.type !== "bounty")) && (
              <Button
                variant="action"
                color="red"
                size="sm"
                disabled={abandonMutation.isPending}
                onClick={async () => {
                  setError(null);
                  try {
                    await abandonMutation.mutateAsync(row.id);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Failed to abandon");
                  }
                }}
              >
                Abandon
              </Button>
            )}
          </div>
        );
      },
    },
  ];

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
        <DataTable columns={columns} data={missions as OpRow[]} />
      </CardContent>
    </Card>
  );
}
