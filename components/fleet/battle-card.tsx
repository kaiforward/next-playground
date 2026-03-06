"use client";

import type { BattleInfo, BattleStatus } from "@/lib/types/game";
import type { BadgeColor } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { ENEMY_TIER_BADGE_COLOR } from "@/lib/constants/ui";

// ── Shared battle display constants ─────────────────────────────

const STATUS_LABELS: Record<BattleStatus, { text: string; color: BadgeColor }> = {
  active: { text: "In Progress", color: "amber" },
  player_victory: { text: "Victory!", color: "green" },
  player_defeat: { text: "Defeated", color: "red" },
  player_retreat: { text: "Retreated", color: "amber" },
  enemy_retreat: { text: "Enemy Retreated", color: "cyan" },
};

export const MORALE_LABELS: ReadonlyArray<{ threshold: number; label: string; color: string }> = [
  { threshold: 80, label: "Confident", color: "text-green-400" },
  { threshold: 50, label: "Steady", color: "text-text-secondary" },
  { threshold: 25, label: "Shaken", color: "text-amber-400" },
  { threshold: 0, label: "Breaking", color: "text-red-400" },
];

export function getMoraleLabel(morale: number): { label: string; color: string } {
  for (const entry of MORALE_LABELS) {
    if (morale >= entry.threshold) return entry;
  }
  return MORALE_LABELS[MORALE_LABELS.length - 1];
}

export function getStatusLabel(status: BattleStatus): { text: string; color: BadgeColor } {
  return STATUS_LABELS[status];
}

// ── BattleCard ──────────────────────────────────────────────────

interface BattleCardProps {
  battle: BattleInfo;
  /** When provided, a "Details →" button links to the battle detail page. */
  detailHref?: string;
}

export function BattleCard({ battle, detailHref }: BattleCardProps) {
  const status = STATUS_LABELS[battle.status];
  const tierColor = ENEMY_TIER_BADGE_COLOR[battle.enemyTier];
  const playerMorale = getMoraleLabel(battle.playerMorale);
  const enemyMorale = getMoraleLabel(battle.enemyMorale);

  const playerStrengthPct = battle.playerMaxStrength > 0
    ? Math.round((battle.playerStrength / battle.playerMaxStrength) * 100)
    : 0;
  const enemyStrengthPct = battle.enemyMaxStrength > 0
    ? Math.round((battle.enemyStrength / battle.enemyMaxStrength) * 100)
    : 0;

  return (
    <Card variant="bordered" padding="sm">
      <CardContent className="space-y-3">
        {/* Header: badges + details button */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge color="purple">{battle.type.replace("_", " ")}</Badge>
            <Badge color={tierColor}>{battle.enemyTier}</Badge>
            <Badge color={status.color}>{status.text}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-secondary">
              Round {battle.roundsCompleted}
            </span>
            {detailHref && (
              <Button href={detailHref} variant="ghost" size="xs">
                Details &rarr;
              </Button>
            )}
          </div>
        </div>

        {/* Ship vs Enemy + location */}
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            {battle.shipName && (
              <span className="text-cyan-400">{battle.shipName}</span>
            )}
            <span className="text-text-secondary">vs</span>
            <span className="text-red-400">{battle.enemyType}</span>
          </div>
          <span className="text-blue-400">{battle.systemName}</span>
        </div>

        {/* Strength bars with morale */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex justify-between items-center mb-0.5">
              <span className="text-[10px] text-text-secondary">Player</span>
              <span className={`text-[10px] ${playerMorale.color}`}>{playerMorale.label}</span>
            </div>
            <ProgressBar
              label="Strength"
              value={Math.round(battle.playerStrength)}
              max={battle.playerMaxStrength}
              color={playerStrengthPct < 30 ? "red" : "blue"}
              size="sm"
            />
          </div>
          <div>
            <div className="flex justify-between items-center mb-0.5">
              <span className="text-[10px] text-text-secondary">Enemy</span>
              <span className={`text-[10px] ${enemyMorale.color}`}>{enemyMorale.label}</span>
            </div>
            <ProgressBar
              label="Strength"
              value={Math.round(battle.enemyStrength)}
              max={battle.enemyMaxStrength}
              color={enemyStrengthPct < 30 ? "amber" : "red"}
              size="sm"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
