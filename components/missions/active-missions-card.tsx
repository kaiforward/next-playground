"use client";

import Link from "next/link";
import { usePlayerMissions } from "@/lib/hooks/use-player-missions";
import { usePlayerOpMissions } from "@/lib/hooks/use-op-missions";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCredits } from "@/lib/utils/format";
import { EmptyState } from "@/components/ui/empty-state";
import type { MissionInfo } from "@/lib/types/game";
import { MISSION_TYPE_DEFS, type MissionType } from "@/lib/constants/missions";

const TYPE_COLORS: Record<string, "red" | "cyan" | "purple" | "amber" | "green"> = {
  patrol: "red",
  survey: "cyan",
  bounty: "purple",
  salvage: "amber",
  recon: "green",
};

export function ActiveMissionsCard() {
  const { missions: tradeMissions } = usePlayerMissions();
  const { missions: opMissions } = usePlayerOpMissions();

  const totalCount = tradeMissions.length + opMissions.length;

  return (
    <Card variant="bordered" padding="md">
      <CardHeader
        title="Active Missions"
        subtitle={totalCount > 0 ? `${totalCount} active` : undefined}
      />
      <CardContent>
        {totalCount === 0 ? (
          <EmptyState message="No active missions. Visit a station's Contracts tab to find work." />
        ) : (
          <ul className="space-y-3">
            {/* Trade missions */}
            {tradeMissions.slice(0, 3).map((m) => (
              <li key={m.id} className="rounded-lg bg-white/5 px-3 py-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-white">
                    {m.goodName} x{m.quantity}
                  </span>
                  <span className="text-sm text-green-400">
                    ~{formatCredits(m.estimatedGoodsValue + m.reward)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-white/40">
                  <Link
                    href={`/system/${m.destinationId}/contracts`}
                    className="text-indigo-300 hover:text-indigo-200 transition-colors"
                  >
                    {m.destinationName}
                  </Link>
                  {m.isImport ? (
                    <Badge color="cyan">Import</Badge>
                  ) : (
                    <Badge color="amber">Export</Badge>
                  )}
                  <span className="ml-auto">{m.ticksRemaining} ticks left</span>
                </div>
              </li>
            ))}

            {/* Operational missions */}
            {opMissions.slice(0, Math.max(1, 3 - tradeMissions.length)).map((m) => (
              <OpMissionItem key={m.id} mission={m} />
            ))}

            {totalCount > 3 && (
              <li className="text-center text-xs text-white/40 pt-1">
                +{totalCount - 3} more mission{totalCount - 3 !== 1 ? "s" : ""}
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function OpMissionItem({ mission: m }: { mission: MissionInfo }) {
  const typeDef = MISSION_TYPE_DEFS[m.type as MissionType];

  return (
    <li className="rounded-lg bg-white/5 px-3 py-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-white">
          {typeDef?.name ?? m.type}
        </span>
        <span className="text-sm text-green-400">
          {formatCredits(m.reward)}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs text-white/40">
        <Link
          href={`/system/${m.targetSystemId}/contracts`}
          className="text-indigo-300 hover:text-indigo-200 transition-colors"
        >
          {m.targetSystemName}
        </Link>
        <Badge color={TYPE_COLORS[m.type] ?? "slate"}>
          {typeDef?.name ?? m.type}
        </Badge>
        {m.status === "in_progress" && m.type === "bounty" && (
          <Badge color="red">In Battle</Badge>
        )}
        <span className="ml-auto">
          {m.status === "accepted" ? "Awaiting ship" : m.status}
        </span>
      </div>
    </li>
  );
}
