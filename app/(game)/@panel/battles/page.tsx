"use client";

import { useMemo } from "react";
import { DetailPanel } from "@/components/ui/detail-panel";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { BattleCard } from "@/components/fleet/battle-card";
import { useActiveBattles } from "@/lib/hooks/use-battles";

function BattlesContent() {
  const { battles } = useActiveBattles();

  const sorted = useMemo(
    () => [...battles].sort((a, b) => b.createdAtTick - a.createdAtTick),
    [battles],
  );

  if (sorted.length === 0) {
    return <EmptyState message="No active battles." className="py-16" />;
  }

  return (
    <ul className="space-y-2">
      {sorted.map((battle) => (
        <li key={battle.id}>
          <BattleCard battle={battle} detailHref={`/battle/${battle.id}`} />
        </li>
      ))}
    </ul>
  );
}

export default function BattlesPanelPage() {
  return (
    <DetailPanel title="Battles" size="lg">
      <QueryBoundary>
        <BattlesContent />
      </QueryBoundary>
    </DetailPanel>
  );
}
