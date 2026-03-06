"use client";

import { useState } from "react";
import Link from "next/link";
import { usePlayerMissions } from "@/lib/hooks/use-player-missions";
import { usePlayerOpMissions } from "@/lib/hooks/use-op-missions";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useDeliverMission, useAbandonMission } from "@/lib/hooks/use-mission-mutations";
import { useAbandonOpMission, useStartOpMission } from "@/lib/hooks/use-op-mission-mutations";
import { isShipEligible } from "@/lib/utils/missions";
import { formatCredits } from "@/lib/utils/format";
import { MISSION_TYPE_DEFS } from "@/lib/constants/missions";
import { ENEMY_TIERS } from "@/lib/constants/combat";
import { MISSION_TYPE_BADGE_COLOR, ENEMY_TIER_BADGE_COLOR } from "@/lib/constants/ui";
import { DetailPanel } from "@/components/ui/detail-panel";
import { TabList, Tab } from "@/components/ui/tabs";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { SelectInput, type SelectOption } from "@/components/form/select-input";
import type { TradeMissionInfo, MissionInfo } from "@/lib/types/game";

type MissionTab = "delivery" | "operations";

// ── Delivery Missions ──────────────────────────────────────────

function DeliveryMissions() {
  const { missions } = usePlayerMissions();
  const { fleet } = useFleet();
  const deliverMutation = useDeliverMission();
  const abandonMutation = useAbandonMission();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedShips, setSelectedShips] = useState<Record<string, string>>({});

  if (missions.length === 0) {
    return (
      <EmptyState
        message="No active delivery missions. Visit a station to accept contracts."
        className="py-12"
      />
    );
  }

  // Find ships docked at each destination for delivery
  const dockedShipsBySystem = new Map<string, Array<{ id: string; name: string }>>();
  for (const ship of fleet.ships) {
    if (ship.status !== "docked") continue;
    const existing = dockedShipsBySystem.get(ship.systemId) ?? [];
    existing.push({ id: ship.id, name: ship.name });
    dockedShipsBySystem.set(ship.systemId, existing);
  }

  return (
    <div className="space-y-3">
      {missions.map((mission) => (
        <DeliveryMissionRow
          key={mission.id}
          mission={mission}
          fleet={fleet}
          dockedShipsBySystem={dockedShipsBySystem}
          selectedShipId={selectedShips[mission.id]}
          onSelectShip={(shipId) =>
            setSelectedShips((prev) => ({ ...prev, [mission.id]: shipId }))
          }
          deliverMutation={deliverMutation}
          abandonMutation={abandonMutation}
          error={errors[mission.id] ?? null}
          onError={(msg) =>
            setErrors((prev) => {
              if (msg === null) {
                const { [mission.id]: _, ...rest } = prev;
                return rest;
              }
              return { ...prev, [mission.id]: msg };
            })
          }
        />
      ))}
    </div>
  );
}

interface DeliveryMissionRowProps {
  mission: TradeMissionInfo;
  fleet: { ships: Array<{ id: string; cargo: Array<{ goodId: string; quantity: number }> }> };
  dockedShipsBySystem: Map<string, Array<{ id: string; name: string }>>;
  selectedShipId: string | undefined;
  onSelectShip: (shipId: string) => void;
  deliverMutation: ReturnType<typeof useDeliverMission>;
  abandonMutation: ReturnType<typeof useAbandonMission>;
  error: string | null;
  onError: (msg: string | null) => void;
}

function DeliveryMissionRow({
  mission,
  fleet,
  dockedShipsBySystem,
  selectedShipId,
  onSelectShip,
  deliverMutation,
  abandonMutation,
  error,
  onError,
}: DeliveryMissionRowProps) {
  const shipsAtDest = dockedShipsBySystem.get(mission.destinationId) ?? [];
  const eligibleShips = shipsAtDest.filter((s) => {
    const ship = fleet.ships.find((fs) => fs.id === s.id);
    if (!ship) return false;
    const cargoItem = ship.cargo.find((c) => c.goodId === mission.goodId);
    return (cargoItem?.quantity ?? 0) >= mission.quantity;
  });
  const resolvedShipId = selectedShipId ?? eligibleShips[0]?.id;

  return (
    <div className="space-y-1">
      {error && <InlineAlert className="text-xs">{error}</InlineAlert>}
      <div className="flex items-start gap-3 py-3 px-3 bg-surface-hover/40 border-l-2 border-l-accent">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-text-primary">
            {mission.goodName} x{mission.quantity}
          </span>
          {mission.isImport ? (
            <Badge color="cyan">Import</Badge>
          ) : (
            <Badge color="amber">Export</Badge>
          )}
          {mission.eventId && <Badge color="purple">Event</Badge>}
        </div>
        <Link
          href={`/system/${mission.destinationId}`}
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors mt-0.5 inline-block"
        >
          &rarr; {mission.destinationName}
          <span className="text-text-secondary ml-1">({mission.hops}h)</span>
        </Link>
      </div>

      <div className="text-right shrink-0">
        <div className="text-xs font-mono text-green-400">
          ~{formatCredits(mission.estimatedGoodsValue + mission.reward)}
        </div>
        <div className="text-[10px] text-text-secondary mt-0.5">
          {mission.ticksRemaining} ticks left
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {eligibleShips.length > 1 && (
          <div className="w-28">
            <SelectInput
              size="sm"
              options={eligibleShips.map((s): SelectOption => ({
                value: s.id,
                label: s.name,
              }))}
              value={resolvedShipId ?? ""}
              onChange={onSelectShip}
              isSearchable={false}
            />
          </div>
        )}
        {eligibleShips.length > 0 && resolvedShipId && (
          <Button
            variant="pill"
            color="green"
            size="sm"
            disabled={deliverMutation.isPending}
            onClick={async () => {
              onError(null);
              try {
                await deliverMutation.mutateAsync({
                  missionId: mission.id,
                  shipId: resolvedShipId,
                });
              } catch (e) {
                onError(e instanceof Error ? e.message : "Failed to deliver");
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
            onError(null);
            try {
              await abandonMutation.mutateAsync(mission.id);
            } catch (e) {
              onError(e instanceof Error ? e.message : "Failed to abandon");
            }
          }}
        >
          Abandon
        </Button>
      </div>
      </div>
    </div>
  );
}

// ── Operations Missions ────────────────────────────────────────

function OperationsMissions() {
  const { missions } = usePlayerOpMissions();
  const { fleet } = useFleet();
  const abandonMutation = useAbandonOpMission();
  const startMutation = useStartOpMission();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selectedShips, setSelectedShips] = useState<Record<string, string>>({});

  if (missions.length === 0) {
    return (
      <EmptyState
        message="No active operations. Visit a station to accept missions."
        className="py-12"
      />
    );
  }

  return (
    <div className="space-y-3">
      {missions.map((mission) => (
        <OperationMissionRow
          key={mission.id}
          mission={mission}
          fleet={fleet}
          selectedShipId={selectedShips[mission.id]}
          onSelectShip={(shipId) =>
            setSelectedShips((prev) => ({ ...prev, [mission.id]: shipId }))
          }
          startMutation={startMutation}
          abandonMutation={abandonMutation}
          error={errors[mission.id] ?? null}
          onError={(msg) =>
            setErrors((prev) => {
              if (msg === null) {
                const { [mission.id]: _, ...rest } = prev;
                return rest;
              }
              return { ...prev, [mission.id]: msg };
            })
          }
        />
      ))}
    </div>
  );
}

interface OperationMissionRowProps {
  mission: MissionInfo;
  fleet: ReturnType<typeof useFleet>["fleet"];
  selectedShipId: string | undefined;
  onSelectShip: (shipId: string) => void;
  startMutation: ReturnType<typeof useStartOpMission>;
  abandonMutation: ReturnType<typeof useAbandonOpMission>;
  error: string | null;
  onError: (msg: string | null) => void;
}

function OperationMissionRow({
  mission,
  fleet,
  selectedShipId,
  onSelectShip,
  startMutation,
  abandonMutation,
  error,
  onError,
}: OperationMissionRowProps) {
  const typeDef = MISSION_TYPE_DEFS[mission.type];
  const typeColor = MISSION_TYPE_BADGE_COLOR[mission.type];

  // For accepted missions, build eligible ship list
  const eligible: Array<{ id: string; name: string }> = [];
  if (mission.status === "accepted") {
    for (const ship of fleet.ships) {
      if (ship.status !== "docked") continue;
      if (ship.systemId !== mission.targetSystemId) continue;
      if (ship.disabled) continue;
      if (ship.convoyId) continue;
      if (ship.activeMission) continue;
      if (!isShipEligible(ship, mission.statRequirements)) continue;
      eligible.push({ id: ship.id, name: ship.name });
    }
  }
  const resolvedShipId = selectedShipId ?? eligible[0]?.id;

  function getStatusText(): string {
    if (mission.status === "accepted") return "Assign a ship to start";
    if (mission.status === "in_progress" && mission.type === "bounty") return "In battle";
    return mission.status;
  }

  return (
    <div className="space-y-1">
      {error && <InlineAlert className="text-xs">{error}</InlineAlert>}
      <div className="flex items-start gap-3 py-3 px-3 bg-surface-hover/40 border-l-2 border-l-accent">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge color={typeColor ?? "slate"}>
              {typeDef?.name ?? mission.type}
            </Badge>
          {mission.enemyTier && (
            <Badge color={ENEMY_TIER_BADGE_COLOR[mission.enemyTier] ?? "slate"}>
              {ENEMY_TIERS[mission.enemyTier]?.name ?? mission.enemyTier}
            </Badge>
          )}
        </div>
        <Link
          href={`/system/${mission.targetSystemId}`}
          className="text-xs text-blue-400 hover:text-blue-300 transition-colors mt-0.5 inline-block"
        >
          &rarr; {mission.targetSystemName}
        </Link>
        <div className="text-xs text-text-secondary mt-0.5">
          {getStatusText()}
        </div>
      </div>

      <div className="text-right shrink-0">
        <div className="text-xs font-mono text-green-400">
          {formatCredits(mission.reward)}
        </div>
        <div className="text-[10px] text-text-secondary mt-0.5">
          {mission.ticksRemaining}t left
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {mission.status === "accepted" && eligible.length > 0 && (
          <>
            {eligible.length > 1 && (
              <div className="w-28">
                <SelectInput
                  size="sm"
                  options={eligible.map((s): SelectOption => ({
                    value: s.id,
                    label: s.name,
                  }))}
                  value={resolvedShipId ?? ""}
                  onChange={onSelectShip}
                  isSearchable={false}
                />
              </div>
            )}
            <Button
              variant="primary"
              size="sm"
              disabled={!resolvedShipId || startMutation.isPending}
              onClick={async () => {
                if (!resolvedShipId) return;
                onError(null);
                try {
                  await startMutation.mutateAsync({
                    missionId: mission.id,
                    shipId: resolvedShipId,
                  });
                } catch (e) {
                  onError(e instanceof Error ? e.message : "Failed to start");
                }
              }}
            >
              Start
            </Button>
          </>
        )}
        {(mission.status === "accepted" ||
          (mission.status === "in_progress" && mission.type !== "bounty")) && (
          <Button
            variant="action"
            color="red"
            size="sm"
            disabled={abandonMutation.isPending}
            onClick={async () => {
              onError(null);
              try {
                await abandonMutation.mutateAsync(mission.id);
              } catch (e) {
                onError(e instanceof Error ? e.message : "Failed to abandon");
              }
            }}
          >
            Abandon
          </Button>
        )}
        </div>
      </div>
    </div>
  );
}

// ── Main Content ───────────────────────────────────────────────

function MissionsContent() {
  const [tab, setTab] = useState<MissionTab>("delivery");
  const { missions: tradeMissions } = usePlayerMissions();
  const { missions: opMissions } = usePlayerOpMissions();

  return (
    <>
      <TabList className="mb-4">
        <Tab
          active={tab === "delivery"}
          onClick={() => setTab("delivery")}
          count={tradeMissions.length}
        >
          Delivery
        </Tab>
        <Tab
          active={tab === "operations"}
          onClick={() => setTab("operations")}
          count={opMissions.length}
        >
          Operations
        </Tab>
      </TabList>

      {tab === "delivery" && <DeliveryMissions />}
      {tab === "operations" && <OperationsMissions />}
    </>
  );
}

export default function MissionsPanelPage() {
  return (
    <DetailPanel title="Missions" size="lg">
      <QueryBoundary>
        <MissionsContent />
      </QueryBoundary>
    </DetailPanel>
  );
}
