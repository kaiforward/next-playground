"use client";

import type { BattleInfo } from "@/lib/types/game";
import { Badge } from "@/components/ui/badge";
import { getStatusLabel } from "@/components/fleet/battle-card";

/** Compact inline battle indicator for ship cards. */
export function BattleIndicator({ battle }: { battle: BattleInfo }) {
  const status = getStatusLabel(battle.status);
  const enemyStrengthPct = battle.enemyMaxStrength > 0
    ? Math.round((battle.enemyStrength / battle.enemyMaxStrength) * 100)
    : 0;

  return (
    <div className="flex items-center gap-2 text-xs">
      <Badge color={status.color}>{status.text}</Badge>
      <span className="text-text-tertiary">
        vs {battle.enemyType}
      </span>
      <span className="text-text-tertiary">
        — Enemy at {enemyStrengthPct}%
      </span>
    </div>
  );
}
