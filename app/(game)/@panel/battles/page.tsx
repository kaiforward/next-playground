"use client";

import { useMemo } from "react";
import Link from "next/link";
import { DetailPanel } from "@/components/ui/detail-panel";
import { Badge } from "@/components/ui/badge";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { useActiveBattles } from "@/lib/hooks/use-battles";
import { ENEMY_TIER_BADGE_COLOR } from "@/lib/constants/ui";
import type { BattleInfo } from "@/lib/types/game";

function BattlesContent() {
  const { battles } = useActiveBattles();

  const sorted = useMemo(
    () => [...battles].sort((a, b) => b.createdAtTick - a.createdAtTick),
    [battles],
  );

  if (sorted.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-text-muted text-sm">
        No active battles.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {sorted.map((battle) => (
        <BattleRow key={battle.id} battle={battle} />
      ))}
    </ul>
  );
}

function BattleRow({ battle }: { battle: BattleInfo }) {
  const tierColor = ENEMY_TIER_BADGE_COLOR[battle.enemyTier];
  const playerPct = battle.playerMaxStrength > 0
    ? Math.round((battle.playerStrength / battle.playerMaxStrength) * 100)
    : 0;
  const enemyPct = battle.enemyMaxStrength > 0
    ? Math.round((battle.enemyStrength / battle.enemyMaxStrength) * 100)
    : 0;

  return (
    <li className="py-3 px-3 rounded-lg bg-surface-hover/40 hover:bg-surface-hover transition-colors">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <Badge color="purple">{battle.type.replace("_", " ")}</Badge>
          <Badge color={tierColor}>{battle.enemyTier}</Badge>
          <Badge color={battle.status === "active" ? "amber" : "slate"}>
            {battle.status.replace("_", " ")}
          </Badge>
        </div>
        <span className="text-[10px] text-text-muted">
          Round {battle.roundsCompleted}
        </span>
      </div>

      <div className="flex items-center justify-between text-xs mb-1">
        <div className="flex items-center gap-2">
          {battle.shipName && (
            <Link
              href={`/ship/${battle.shipId}`}
              className="text-cyan-400 hover:text-cyan-300 transition-colors"
            >
              {battle.shipName}
            </Link>
          )}
          <span className="text-text-muted">vs</span>
          <span className="text-red-400">{battle.enemyType}</span>
        </div>
        <Link
          href={`/system/${battle.systemId}`}
          className="text-blue-400 hover:text-blue-300 transition-colors"
        >
          {battle.systemName}
        </Link>
      </div>

      {/* Strength bars */}
      <div className="flex gap-4 mt-2">
        <div className="flex-1">
          <div className="flex justify-between text-[10px] text-text-muted mb-0.5">
            <span>Player</span>
            <span>{playerPct}%</span>
          </div>
          <div className="h-1.5 bg-surface rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all"
              style={{ width: `${playerPct}%` }}
            />
          </div>
        </div>
        <div className="flex-1">
          <div className="flex justify-between text-[10px] text-text-muted mb-0.5">
            <span>Enemy</span>
            <span>{enemyPct}%</span>
          </div>
          <div className="h-1.5 bg-surface rounded-full overflow-hidden">
            <div
              className="h-full bg-red-500 rounded-full transition-all"
              style={{ width: `${enemyPct}%` }}
            />
          </div>
        </div>
      </div>
    </li>
  );
}

export default function BattlesPanelPage() {
  return (
    <DetailPanel title="Battles">
      <QueryBoundary>
        <BattlesContent />
      </QueryBoundary>
    </DetailPanel>
  );
}
