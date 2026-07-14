"use client";

import { DetailPanel } from "@/components/ui/detail-panel";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { RelationsMatrix } from "@/components/factions/relations-matrix";
import { useRelations } from "@/lib/hooks/use-relations";
import { RELATION_TIERS, RELATIONS_FREQUENCY } from "@/lib/constants/relations";
import {
  getRelationTierColor,
  getRelationTierLabel,
} from "@/components/factions/relation-tier-badge";

function DiplomacyContent() {
  const { relations } = useRelations();

  if (relations.factions.length === 0) {
    return (
      <EmptyState
        message="No factions present. Reseed the universe to populate the political layer."
        className="py-16"
      />
    );
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-text-tertiary font-display uppercase tracking-wider">
          Legend
        </span>
        {RELATION_TIERS.map((t) => (
          <Badge key={t.tier} color={getRelationTierColor(t.tier)}>
            {getRelationTierLabel(t.tier)} ({t.minScore} … {t.maxScore})
          </Badge>
        ))}
      </div>

      <p className="mb-4 text-sm text-text-secondary">
        Pair scores drift every {RELATIONS_FREQUENCY} ticks. Click any faction name to inspect it.
      </p>

      <RelationsMatrix data={relations} />
    </>
  );
}

export default function DiplomacyPanelPage() {
  return (
    <DetailPanel
      title="Diplomacy"
      subtitle="How the factions feel about each other — pair-wise relation scores across the galaxy."
      backPath="/factions"
    >
      <QueryBoundary>
        <DiplomacyContent />
      </QueryBoundary>
    </DetailPanel>
  );
}
