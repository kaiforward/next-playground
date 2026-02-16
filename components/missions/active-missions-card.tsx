"use client";

import Link from "next/link";
import { usePlayerMissions } from "@/lib/hooks/use-player-missions";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCredits } from "@/lib/utils/format";

export function ActiveMissionsCard() {
  const { missions } = usePlayerMissions();

  return (
    <Card variant="bordered" padding="md">
      <CardHeader
        title="Active Missions"
        subtitle={missions.length > 0 ? `${missions.length} active` : undefined}
      />
      <CardContent>
        {missions.length === 0 ? (
          <p className="text-white/30 text-sm text-center py-4">
            No active missions. Visit a station&apos;s Contracts tab to find work.
          </p>
        ) : (
          <ul className="space-y-3">
            {missions.slice(0, 3).map((m) => (
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
            {missions.length > 3 && (
              <li className="text-center text-xs text-white/40 pt-1">
                +{missions.length - 3} more mission{missions.length - 3 !== 1 ? "s" : ""}
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
