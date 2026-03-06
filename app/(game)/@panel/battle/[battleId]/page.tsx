"use client";

import { use } from "react";
import Link from "next/link";
import { DetailPanel } from "@/components/ui/detail-panel";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatList, StatRow } from "@/components/ui/stat-row";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { BattleCard, getMoraleLabel, getStatusLabel } from "@/components/fleet/battle-card";
import { useBattleDetail } from "@/lib/hooks/use-battles";
import { ENEMY_TIERS } from "@/lib/constants/combat";
import type { BattleDetailInfo, BattleRoundResult } from "@/lib/types/game";

function BattleDetailContent({ battleId }: { battleId: string }) {
  const { battle } = useBattleDetail(battleId);

  const enemyTierDef = ENEMY_TIERS[battle.enemyTier];
  const isResolved = battle.status !== "active";

  return (
    <DetailPanel
      title={`Battle at ${battle.systemName}`}
      subtitle={
        <span className="flex items-center gap-2">
          <Link href={`/system/${battle.systemId}`} className="text-blue-400 hover:text-blue-300 transition-colors">
            {battle.systemName}
          </Link>
          {battle.shipId && (
            <>
              <span className="text-text-secondary">·</span>
              <Link href={`/ship/${battle.shipId}`} className="text-cyan-400 hover:text-cyan-300 transition-colors">
                {battle.shipName}
              </Link>
            </>
          )}
        </span>
      }
      size="lg"
      backPath="/battles"
    >
      <div className="space-y-6">
        {/* Summary card */}
        <BattleCard battle={battle} />

        {/* Ship stats + Enemy stats side by side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Ship stats */}
          <ShipStatsCard battle={battle} />

          {/* Enemy stats */}
          <Card variant="bordered" padding="sm">
            <CardHeader title="Enemy" />
            <CardContent>
              <StatList className="space-y-2">
                <StatRow label="Type">{battle.enemyType}</StatRow>
                <StatRow label="Tier">
                  <span className="capitalize">{battle.enemyTier}</span>
                  <span className="text-text-secondary ml-1">({enemyTierDef.name})</span>
                </StatRow>
                <StatRow label="Damage Reduction">{Math.round(enemyTierDef.baseDamageReduction * 100)}%</StatRow>
                <StrengthRow value={battle.enemyStrength} max={battle.enemyMaxStrength} lowColor="amber" highColor="red" />
                <MoraleRow morale={battle.enemyMorale} />
              </StatList>
            </CardContent>
          </Card>
        </div>

        {/* Round history */}
        {battle.roundHistory.length > 0 && (
          <RoundHistoryCard rounds={battle.roundHistory} />
        )}

        {/* Battle outcome */}
        {isResolved && <BattleOutcomeCard battle={battle} />}
      </div>
    </DetailPanel>
  );
}

function ShipStatsCard({ battle }: { battle: BattleDetailInfo }) {
  const { shipStats } = battle;

  if (!shipStats) {
    return (
      <Card variant="bordered" padding="sm">
        <CardHeader title="Your Ship" />
        <CardContent>
          <p className="text-sm text-text-secondary">Ship data unavailable.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="bordered" padding="sm">
      <CardHeader title="Your Ship" subtitle={battle.shipName ?? undefined} />
      <CardContent>
        <StatList className="space-y-2">
          <StatRow label="Hull">
            <span>{shipStats.hullCurrent} / {shipStats.hullMax}</span>
          </StatRow>
          <StatRow label="Shield">
            <span>{shipStats.shieldCurrent} / {shipStats.shieldMax}</span>
          </StatRow>
          <StatRow label="Firepower">
            <span>{shipStats.firepower}</span>
          </StatRow>
          <StatRow label="Evasion">
            <span>{shipStats.evasion}</span>
          </StatRow>
          <StrengthRow value={battle.playerStrength} max={battle.playerMaxStrength} lowColor="red" highColor="green" />
          <MoraleRow morale={battle.playerMorale} />
        </StatList>
      </CardContent>
    </Card>
  );
}

function StrengthRow({
  value,
  max,
  lowColor,
  highColor,
}: {
  value: number;
  max: number;
  lowColor: "red" | "amber";
  highColor: "green" | "red";
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;

  return (
    <div>
      <ProgressBar
        label="Strength"
        value={Math.round(value)}
        max={max}
        color={pct < 30 ? lowColor : highColor}
        size="sm"
      />
    </div>
  );
}

function MoraleRow({ morale }: { morale: number }) {
  const info = getMoraleLabel(morale);

  return (
    <StatRow label="Morale">
      <span className={info.color}>{info.label}</span>
      <span className="text-text-secondary ml-1">({Math.round(morale)}%)</span>
    </StatRow>
  );
}

function RoundHistoryCard({ rounds }: { rounds: BattleRoundResult[] }) {
  return (
    <Card variant="bordered" padding="sm">
      <CardHeader title="Round History" />
      <CardContent>
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="px-2 py-1.5 text-left text-text-secondary">Round</th>
                <th className="px-2 py-1.5 text-right text-green-400/60">You Dealt</th>
                <th className="px-2 py-1.5 text-right text-red-400/60">You Took</th>
                <th className="px-2 py-1.5 text-right text-text-secondary">Your HP</th>
                <th className="px-2 py-1.5 text-right text-text-secondary">Enemy HP</th>
              </tr>
            </thead>
            <tbody>
              {[...rounds].reverse().map((r) => (
                <tr key={r.round} className="border-b border-white/5">
                  <td className="px-2 py-1.5 text-text-tertiary">{r.round}</td>
                  <td className="px-2 py-1.5 text-right text-green-400">{r.playerDamageDealt}</td>
                  <td className="px-2 py-1.5 text-right text-red-400">{r.enemyDamageDealt}</td>
                  <td className="px-2 py-1.5 text-right text-text-secondary">{Math.round(r.playerStrengthAfter)}</td>
                  <td className="px-2 py-1.5 text-right text-text-secondary">{Math.round(r.enemyStrengthAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function BattleOutcomeCard({ battle }: { battle: BattleDetailInfo }) {
  const status = getStatusLabel(battle.status);
  const totalDamageDealt = battle.roundHistory.reduce((sum, r) => sum + r.playerDamageDealt, 0);
  const totalDamageTaken = battle.roundHistory.reduce((sum, r) => sum + r.enemyDamageDealt, 0);

  return (
    <Card variant="bordered" padding="sm">
      <CardHeader
        title="Battle Outcome"
        action={<Badge color={status.color}>{status.text}</Badge>}
      />
      <CardContent>
        <StatList className="space-y-2">
          <StatRow label="Rounds">{battle.roundsCompleted}</StatRow>
          <StatRow label="Total Damage Dealt">
            <span className="text-green-400">{totalDamageDealt}</span>
          </StatRow>
          <StatRow label="Total Damage Taken">
            <span className="text-red-400">{totalDamageTaken}</span>
          </StatRow>
        </StatList>
      </CardContent>
    </Card>
  );
}

export default function BattlePanelPage({
  params,
}: {
  params: Promise<{ battleId: string }>;
}) {
  const { battleId } = use(params);

  return (
    <QueryBoundary>
      <BattleDetailContent battleId={battleId} />
    </QueryBoundary>
  );
}
