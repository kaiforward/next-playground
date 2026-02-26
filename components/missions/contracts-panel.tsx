"use client";

import { useState } from "react";
import Link from "next/link";
import type { TradeMissionInfo, FleetState } from "@/lib/types/game";
import { useAcceptMission, useDeliverMission, useAbandonMission } from "@/lib/hooks/use-mission-mutations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { SelectInput, type SelectOption } from "@/components/form/select-input";
import { formatCredits } from "@/lib/utils/format";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineAlert } from "@/components/ui/inline-alert";

type MissionRow = TradeMissionInfo & Record<string, unknown>;

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

  const columns: Column<MissionRow>[] = [
    {
      key: "type",
      label: "Type",
      render: (row) => (
        <>
          {row.isImport ? (
            <Badge color="cyan">Import</Badge>
          ) : (
            <Badge color="amber">Export</Badge>
          )}
          {row.eventId && (
            <Badge color="purple" className="ml-1">Event</Badge>
          )}
        </>
      ),
    },
    {
      key: "goodName",
      label: "Cargo",
      render: (row) => <>{row.goodName} x{row.quantity}</>,
    },
    {
      key: "destination",
      label: "Destination",
      render: (row) =>
        row.isImport ? (
          <span className="text-text-muted">Here</span>
        ) : (
          <Link
            href={`/system/${row.destinationId}/contracts`}
            className="text-indigo-300 hover:text-indigo-200 transition-colors"
          >
            {row.destinationName}
            <span className="text-text-muted ml-1">({row.hops}h)</span>
          </Link>
        ),
    },
    {
      key: "payout",
      label: "Payout",
      render: (row) => (
        <div>
          <div className="text-green-400 font-medium">
            ~{formatCredits(row.estimatedGoodsValue + row.reward)}
          </div>
          <div className="text-xs text-text-faint">
            {formatCredits(row.estimatedGoodsValue)} sale + {formatCredits(row.reward)} bonus
          </div>
        </div>
      ),
    },
    {
      key: "ticksRemaining",
      label: "Time Left",
      render: (row) => <span className="text-text-secondary">{row.ticksRemaining} ticks</span>,
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
        title="Available Contracts"
        subtitle={`${missions.length} contract${missions.length !== 1 ? "s" : ""} at this station`}
      />
      <CardContent>
        {error && (
          <InlineAlert className="mb-4">{error}</InlineAlert>
        )}

        {missions.length === 0 ? (
          <EmptyState message="No contracts available at this station right now." />
        ) : (
          <DataTable columns={columns} data={missions as MissionRow[]} />
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
          <EmptyState message="Accept contracts above to start earning rewards." />
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

  const columns: Column<MissionRow>[] = [
    {
      key: "goodName",
      label: "Cargo",
      render: (row) => (
        <>
          {row.goodName} x{row.quantity}
          {row.eventId && (
            <Badge color="purple" className="ml-2">Event</Badge>
          )}
        </>
      ),
    },
    {
      key: "destination",
      label: "Destination",
      render: (row) => (
        <Link
          href={`/system/${row.destinationId}/contracts`}
          className="text-indigo-300 hover:text-indigo-200 transition-colors"
        >
          {row.destinationName}
          {row.destinationId !== row.systemId && (
            <span className="text-text-muted ml-1">({row.hops}h)</span>
          )}
        </Link>
      ),
    },
    {
      key: "payout",
      label: "Payout",
      render: (row) => (
        <div>
          <div className="text-green-400 font-medium">
            ~{formatCredits(row.estimatedGoodsValue + row.reward)}
          </div>
          <div className="text-xs text-text-faint">
            {formatCredits(row.estimatedGoodsValue)} sale + {formatCredits(row.reward)} bonus
          </div>
        </div>
      ),
    },
    {
      key: "timeLeft",
      label: "Time Left",
      render: (row) => {
        const isExpired = currentTick > row.deadlineTick;
        return isExpired ? (
          <span className="text-red-400">Expired</span>
        ) : (
          <span className="text-text-secondary">{row.ticksRemaining} ticks</span>
        );
      },
    },
    {
      key: "actions",
      label: "",
      render: (row) => {
        const shipsAtDest = dockedShipsBySystem.get(row.destinationId) ?? [];
        const eligibleShips = fleet
          ? shipsAtDest.filter((s) => {
              const ship = fleet.ships.find((fs) => fs.id === s.id);
              if (!ship) return false;
              const cargoItem = ship.cargo.find((c) => c.goodId === row.goodId);
              return (cargoItem?.quantity ?? 0) >= row.quantity;
            })
          : [];
        const selectedShipId = selectedShips[row.id] ?? eligibleShips[0]?.id;

        return (
          <div className="flex items-center gap-2">
            {shipsAtDest.length > 0 && eligibleShips.length > 1 && (
              <div className="w-36">
                <SelectInput
                  size="sm"
                  options={eligibleShips.map((s): SelectOption => ({
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
                      missionId: row.id,
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
                  await abandonMutation.mutateAsync(row.id);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Failed to abandon");
                }
              }}
            >
              Abandon
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <Card variant="bordered" padding="md">
      <CardHeader
        title="Your Active Missions"
        subtitle={`${missions.length} active mission${missions.length !== 1 ? "s" : ""}`}
      />
      <CardContent>
        {error && (
          <InlineAlert className="mb-4">{error}</InlineAlert>
        )}
        <DataTable columns={columns} data={missions as MissionRow[]} />
      </CardContent>
    </Card>
  );
}
