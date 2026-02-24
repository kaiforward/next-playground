"use client";

import type { BattleInfo } from "@/lib/types/game";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { formatCredits } from "@/lib/utils/format";

interface BattleViewerProps {
  battle: BattleInfo;
}

const STATUS_LABELS: Record<string, { text: string; color: "green" | "red" | "amber" | "cyan" | "slate" }> = {
  active: { text: "In Progress", color: "amber" },
  player_victory: { text: "Victory!", color: "green" },
  player_defeat: { text: "Defeated", color: "red" },
  player_retreat: { text: "Retreated", color: "amber" },
  enemy_retreat: { text: "Enemy Retreated", color: "cyan" },
};

const MORALE_LABELS: Array<{ threshold: number; label: string; color: string }> = [
  { threshold: 80, label: "Confident", color: "text-green-400" },
  { threshold: 50, label: "Steady", color: "text-white/70" },
  { threshold: 25, label: "Shaken", color: "text-amber-400" },
  { threshold: 0, label: "Breaking", color: "text-red-400" },
];

function getMoraleLabel(morale: number): { label: string; color: string } {
  for (const entry of MORALE_LABELS) {
    if (morale >= entry.threshold) return entry;
  }
  return MORALE_LABELS[MORALE_LABELS.length - 1];
}

export function BattleViewer({ battle }: BattleViewerProps) {
  const status = STATUS_LABELS[battle.status] ?? { text: battle.status, color: "slate" as const };
  const playerMorale = getMoraleLabel(battle.playerMorale);
  const enemyMorale = getMoraleLabel(battle.enemyMorale);

  const playerStrengthPct = battle.playerMaxStrength > 0
    ? Math.round((battle.playerStrength / battle.playerMaxStrength) * 100)
    : 0;
  const enemyStrengthPct = battle.enemyMaxStrength > 0
    ? Math.round((battle.enemyStrength / battle.enemyMaxStrength) * 100)
    : 0;

  return (
    <Card variant="bordered" padding="md">
      <CardHeader
        title={`Battle at ${battle.systemName}`}
        subtitle={
          battle.shipName
            ? `${battle.shipName} vs ${battle.enemyType} (${battle.enemyTier})`
            : `vs ${battle.enemyType} (${battle.enemyTier})`
        }
        action={<Badge color={status.color}>{status.text}</Badge>}
      />
      <CardContent className="space-y-4">
        {/* Strength bars */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs text-white/50 uppercase tracking-wider">Your Ship</span>
              <span className={`text-xs ${playerMorale.color}`}>{playerMorale.label}</span>
            </div>
            <ProgressBar
              label="Strength"
              value={Math.round(battle.playerStrength)}
              max={battle.playerMaxStrength}
              color={playerStrengthPct < 30 ? "red" : "green"}
              size="md"
            />
          </div>
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs text-white/50 uppercase tracking-wider">Enemy</span>
              <span className={`text-xs ${enemyMorale.color}`}>{enemyMorale.label}</span>
            </div>
            <ProgressBar
              label="Strength"
              value={Math.round(battle.enemyStrength)}
              max={battle.enemyMaxStrength}
              color={enemyStrengthPct < 30 ? "amber" : "red"}
              size="md"
            />
          </div>
        </div>

        {/* Round counter */}
        <div className="text-center text-xs text-white/40">
          Round {battle.roundsCompleted}
          {battle.status === "active" && " — resolving..."}
        </div>

        {/* Round history */}
        {battle.roundHistory.length > 0 && (
          <div className="max-h-40 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="px-2 py-1.5 text-left text-white/40">Round</th>
                  <th className="px-2 py-1.5 text-right text-green-400/60">You Dealt</th>
                  <th className="px-2 py-1.5 text-right text-red-400/60">You Took</th>
                </tr>
              </thead>
              <tbody>
                {[...battle.roundHistory].reverse().map((r) => (
                  <tr key={r.round} className="border-b border-white/5">
                    <td className="px-2 py-1.5 text-white/50">{r.round}</td>
                    <td className="px-2 py-1.5 text-right text-green-400">{r.playerDamageDealt}</td>
                    <td className="px-2 py-1.5 text-right text-red-400">{r.enemyDamageDealt}</td>
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

/** Compact inline battle indicator for ship cards. */
export function BattleIndicator({ battle }: { battle: BattleInfo }) {
  const status = STATUS_LABELS[battle.status] ?? { text: battle.status, color: "slate" as const };
  const enemyStrengthPct = battle.enemyMaxStrength > 0
    ? Math.round((battle.enemyStrength / battle.enemyMaxStrength) * 100)
    : 0;

  return (
    <div className="flex items-center gap-2 text-xs">
      <Badge color={status.color}>{status.text}</Badge>
      <span className="text-white/50">
        vs {battle.enemyType}
      </span>
      <span className="text-white/30">
        — Enemy at {enemyStrengthPct}%
      </span>
    </div>
  );
}
