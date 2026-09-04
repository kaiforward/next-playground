"use client";

import { useState } from "react";
import { useGameSlice } from "@/lib/store/use-game-store";
import { useSystemInfo } from "@/lib/hooks/use-system-info";
import { useUniverse } from "@/lib/hooks/use-universe";
import { useAtlas } from "@/lib/hooks/use-atlas";
import { useInterest } from "@/lib/store/interest";
import { useDetailPresent } from "@/lib/hooks/detail-read";
import { useLaneDetail } from "@/lib/hooks/use-lane-detail";
import { useOrderLaneUpgrade, useCancelOrder } from "@/lib/hooks/use-construction-orders";
import { useNavigate, useRouteInfo, useLinkComponent } from "@/components/ui/link-provider";
import { DetailPanel } from "@/components/ui/detail-panel";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { VitalTile, VitalGrid } from "@/components/ui/vital-tile";
import { ConstructionRow } from "@/components/construction/construction-row";
import { NumberInput } from "@/components/form/number-input";
import { TermLabel } from "@/components/ui/term-label";
import { MapPinIcon } from "@/components/ui/icons";
import { laneTier } from "@/components/map/pixi/objects/lane-style";
import { LANES } from "@/lib/constants/lanes";
import { formatDuration } from "@/lib/utils/calendar";
import type { LaneDetailData } from "@/lib/types/api";

/**
 * The lane panel's route component (`/lane/:key`).
 * A route-docked `DetailPanel` naming both endpoints (`components/panels/system-panel.tsx`'s own
 * shape), with body: a vitals grid, the ledger's cargo in flight, and the open upgrade project
 * with the invest verb. Selecting a system while this panel is open re-points to the system
 * panel, same as system-to-system today (it's just a navigation).
 *
 * `laneKey` arrives from the URL (a player can type garbage into the address bar), so it's split
 * here without the throwing `laneEndpoints` (`lib/engine/lanes.ts`) — that helper's contract is for
 * keys minted internally by `laneKey()` itself, not untrusted route input.
 */
function splitLaneKey(key: string): [string, string] | null {
  const idx = key.indexOf("|");
  if (idx < 0) return null;
  return [key.slice(0, idx), key.slice(idx + 1)];
}

/** The invest verb's three states — computed client-side from the
 *  lane's endpoint ownership and the viewer's own faction, never persisted: `"hidden"` covers both
 *  "no player seat" and "an AI faction already qualifies as investor" (verbs hidden, card
 *  read-only in both); `"blocked"` names the ONE endpoint standing in the way, preferring an
 *  unclaimed endpoint over a foreign one when both would otherwise apply. */
export type LaneInvestState =
  | { kind: "hidden" }
  | { kind: "ready" }
  | { kind: "blocked"; reason: "unclaimed"; systemId: string; systemName: string }
  | { kind: "blocked"; reason: "foreign"; systemName: string; factionName: string };

export function laneInvestState(
  detail: LaneDetailData,
  playerFactionId: string | null,
  factionNameOf: (factionId: string) => string,
): LaneInvestState {
  if (playerFactionId === null) return { kind: "hidden" };
  if (detail.investorFactionId === playerFactionId) return { kind: "ready" };
  // Some other single faction already qualifies as investor (both ends claimed, both by them) —
  // an AI lane the player has no verb over, not a "you're missing an endpoint" case.
  if (detail.investorFactionId !== null) return { kind: "hidden" };
  if (detail.a.unclaimed) {
    return { kind: "blocked", reason: "unclaimed", systemId: detail.a.systemId, systemName: detail.a.systemName };
  }
  if (detail.b.unclaimed) {
    return { kind: "blocked", reason: "unclaimed", systemId: detail.b.systemId, systemName: detail.b.systemName };
  }
  const foreign = detail.a.factionId !== playerFactionId ? detail.a : detail.b;
  return {
    kind: "blocked",
    reason: "foreign",
    systemName: foreign.systemName,
    factionName: foreign.factionId !== null ? factionNameOf(foreign.factionId) : "an unknown faction",
  };
}

function LaneVitals({ detail }: { detail: LaneDetailData }) {
  const loadPct = detail.capacity > 0 ? Math.min(100, (detail.bookedLoad / detail.capacity) * 100) : 0;
  const upkeep = detail.level * LANES.UPGRADE_WORK_PER_LEVEL;
  return (
    <VitalGrid columns={3}>
      <VitalTile
        label={<TermLabel id="laneLevel">Level</TermLabel>}
        dotColor="var(--color-accent)"
        value={detail.level % 1 === 0 ? String(detail.level) : detail.level.toFixed(1)}
        hint={<>capacity <span className="font-mono text-text-primary">{Math.round(detail.capacity)}</span>/cyc</>}
      />
      <VitalTile
        label={<TermLabel id="laneCapacity">Booked</TermLabel>}
        dotColor="var(--color-status-amber)"
        value={String(Math.round(loadPct))}
        unit="%"
        meter={{ pct: loadPct, color: "var(--color-status-amber)" }}
        hint={<><span className="font-mono text-text-primary">{Math.round(detail.bookedLoad)}</span> of {Math.round(detail.capacity)} this run</>}
      />
      <VitalTile
        label={<TermLabel id="inTransit">In transit</TermLabel>}
        dotColor="var(--color-secondary)"
        value={String(Math.round(detail.inFlight))}
        hint={`${detail.cargo.length} haul${detail.cargo.length === 1 ? "" : "s"} on this lane`}
      />
      <VitalTile
        label={<TermLabel id="blockedVolume">Turned away</TermLabel>}
        dotColor="var(--color-status-red)"
        value={String(Math.round(detail.blockedVolume))}
        hint={
          detail.blockedVolume === 0 ? (
            "nothing blocked this run"
          ) : (
            <><TermLabel id="congested">congested</TermLabel> — turned away this run</>
          )
        }
      />
      <VitalTile
        label="Upkeep"
        dotColor="var(--color-text-tertiary)"
        value={String(Math.round(upkeep))}
        hint="work/cyc · in maintenance"
      />
      <VitalTile
        label="Idle"
        dotColor="var(--color-text-tertiary)"
        value={String(detail.idleCycles)}
        unit={`/${LANES.IDLE_BUFFER_CYCLES}`}
        hint="cycles toward decay"
      />
    </VitalGrid>
  );
}

function CargoInFlightCard({ detail, currentTick }: { detail: LaneDetailData; currentTick: number }) {
  const LinkComponent = useLinkComponent();
  return (
    <Card variant="bordered" padding="md" className="mt-4">
      <CardHeader
        title="Cargo in flight"
        subtitle="what is on this lane right now, by good — from the freight ledger"
      />
      <CardContent>
        {detail.cargo.length === 0 ? (
          <EmptyState message="Nothing is moving on this lane right now." />
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th className="border-b border-border-strong px-1.5 py-1 text-left font-display font-normal uppercase tracking-wider text-text-tertiary">Good</th>
                <th className="border-b border-border-strong px-1.5 py-1 text-left font-display font-normal uppercase tracking-wider text-text-tertiary">Route</th>
                <th className="border-b border-border-strong px-1 py-1 text-right font-display font-normal uppercase tracking-wider text-text-tertiary">Units</th>
                <th className="border-b border-border-strong px-1 py-1 text-right font-display font-normal uppercase tracking-wider text-text-tertiary">Arrives</th>
              </tr>
            </thead>
            <tbody>
              {detail.cargo.map((row, i) => (
                <tr key={`${row.goodId}-${i}`} className="hover:bg-surface-hover">
                  <td className="px-1.5 py-1 text-text-secondary">{row.goodName}</td>
                  <td className="px-1.5 py-1">
                    <LinkComponent href={`/system/${row.fromSystemId}`} className="text-text-accent transition-colors hover:text-text-accent-hover">
                      {row.fromSystemName}
                    </LinkComponent>
                    {" → "}
                    <LinkComponent href={`/system/${row.toSystemId}`} className="text-text-accent transition-colors hover:text-text-accent-hover">
                      {row.toSystemName}
                    </LinkComponent>
                  </td>
                  <td className="px-1 py-1 text-right font-mono text-text-primary">{row.quantity.toFixed(1)}</td>
                  <td className="px-1 py-1 text-right font-mono text-text-secondary">
                    {formatDuration(Math.max(0, row.arrivalTick - currentTick))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function ConstructionCard({
  laneKey,
  detail,
  investState,
}: {
  laneKey: string;
  detail: LaneDetailData;
  investState: LaneInvestState;
}) {
  const LinkComponent = useLinkComponent();
  const orderLaneUpgrade = useOrderLaneUpgrade(laneKey);
  const cancel = useCancelOrder();
  const [levels, setLevels] = useState(1);

  return (
    <Card variant="bordered" padding="md" className="mt-4">
      <CardHeader title="Construction" />
      <CardContent>
        {detail.openProjects.map((project) => (
          <ConstructionRow
            key={project.id}
            row={project}
            showSystem={false}
            onCancel={project.origin === "player" ? (id) => cancel.mutate({ projectId: id }) : undefined}
          />
        ))}

        {investState.kind === "ready" && (
          <>
            <div className="mt-3.5 flex items-center gap-2.5">
              <Button
                variant="action"
                color="accent"
                size="sm"
                disabled={orderLaneUpgrade.isPending}
                onClick={() => orderLaneUpgrade.mutate({ levels })}
              >
                ◆ Invest
              </Button>
              <NumberInput
                aria-label="Levels"
                size="sm"
                className="w-16"
                min={1}
                value={levels}
                onChange={(e) => setLevels(Math.max(1, Number(e.target.value) || 1))}
              />
              <span className="text-xs text-text-secondary">level{levels === 1 ? "" : "s"}</span>
            </div>
            <p className="mt-2 text-xs text-text-secondary">
              adds <span className="font-mono text-text-primary">{LANES.BASE_LANE_CAPACITY}</span>/cyc capacity per
              level · <span className="font-mono text-text-primary">{LANES.UPGRADE_WORK_PER_LEVEL}</span> work per
              level from the construction pool · upkeep rises{" "}
              <span className="font-mono text-text-primary">{LANES.UPGRADE_WORK_PER_LEVEL}</span> work/cyc per level
            </p>
          </>
        )}

        {investState.kind === "blocked" && (
          <>
            <div className="mt-3.5 flex items-center gap-2.5 opacity-50">
              <Button variant="action" color="accent" size="sm" disabled>
                ◆ Invest
              </Button>
            </div>
            <p className="mt-2 text-xs text-status-amber-light">
              {investState.reason === "unclaimed" ? (
                <>
                  {investState.systemName} is unclaimed. A lane can only be invested in once you hold both ends —{" "}
                  <LinkComponent href={`/system/${investState.systemId}`} className="text-text-accent transition-colors hover:text-text-accent-hover">
                    claim {investState.systemName}
                  </LinkComponent>
                  .
                </>
              ) : (
                <>
                  {investState.systemName} belongs to {investState.factionName}. Only the faction holding both ends
                  can invest in a lane.
                </>
              )}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function LanePanel({ laneKey }: { laneKey: string }) {
  const endpoints = splitLaneKey(laneKey);
  const { systemInfo: aSystem } = useSystemInfo(endpoints?.[0] ?? "");
  const { systemInfo: bSystem } = useSystemInfo(endpoints?.[1] ?? "");
  // Pre-boot guard: `worldVersion` is null until the worker's first state frame lands, and
  // `useSystemInfo` reads its slice's empty default until then — indistinguishable at this point
  // from a genuinely absent lane. Render nothing rather than flashing not-found for an entity that
  // is really just not loaded yet, same as `SystemPanel`/`FactionPanel`.
  const booted = useGameSlice((state) => state.worldVersion !== null);
  const currentTick = useGameSlice((state) => state.pacing?.currentTick ?? 0);

  useInterest("lane", laneKey);
  const detail = useLaneDetail(laneKey);
  const detailPresent = useDetailPresent("laneDetail", laneKey);
  const { data: universeData } = useUniverse();
  const { atlas } = useAtlas();
  const { pathname, searchParams } = useRouteInfo();
  const navigate = useNavigate();

  if (!booted) return null;

  if (!endpoints || !aSystem || !bSystem) {
    return (
      <DetailPanel title="Lane">
        <EmptyState message="This lane no longer exists in the current galaxy." />
      </DetailPanel>
    );
  }

  const showOnMap = () => {
    const loc = Number(searchParams.get("loc") ?? 0) + 1;
    const x = (aSystem.x + bSystem.x) / 2;
    const y = (aSystem.y + bSystem.y) / 2;
    navigate(`${pathname}?focus=${x},${y}&loc=${loc}`, { replace: true });
  };

  const headerAction = (
    <Button variant="ghost" size="xs" onClick={showOnMap} aria-label="Show on map">
      <MapPinIcon />
      <span className="ml-1">Show on Map</span>
    </Button>
  );

  const tier = detail ? laneTier(detail.fuelCost) : null;

  const subtitle = (
    <span className="inline-flex items-center gap-2">
      <Badge color="amber">Lane</Badge>
      {detail && (
        <span className="text-text-secondary">
          fuel {detail.fuelCost.toFixed(1)} · {tier}
        </span>
      )}
    </span>
  );

  return (
    <DetailPanel
      title={`${aSystem.name} — ${bSystem.name}`}
      subtitle={subtitle}
      headerAction={headerAction}
      scrollResetKey={laneKey}
    >
      {detailPresent && detail && (
        <>
          <LaneVitals detail={detail} />
          <CargoInFlightCard detail={detail} currentTick={currentTick} />
          <ConstructionCard
            laneKey={laneKey}
            detail={detail}
            investState={laneInvestState(
              detail,
              atlas.player?.controlledFactionId ?? null,
              (factionId) => universeData.factions.find((f) => f.id === factionId)?.name ?? "Unknown Faction",
            )}
          />
        </>
      )}
    </DetailPanel>
  );
}
