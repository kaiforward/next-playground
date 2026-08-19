"use client";

import { use } from "react";
import { useFaction } from "@/lib/hooks/use-faction";
import { FACTION_TABS } from "@/lib/constants/faction-tabs";
import { DetailPanel } from "@/components/ui/detail-panel";
import { PanelTabs } from "@/components/ui/tabs";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { FactionStatusBadge } from "@/components/factions/faction-status-badge";

function FactionPanelContent({
  factionId,
  children,
}: {
  factionId: string;
  children: React.ReactNode;
}) {
  const result = useFaction(factionId);
  if (!result.found) return null;
  const { faction } = result;

  const subtitle = (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden
        className="h-3 w-3 shrink-0 border border-border"
        style={{ backgroundColor: faction.color }}
      />
      <FactionStatusBadge status={faction.status} />
      <span className="text-text-secondary">{faction.governmentName}</span>
    </span>
  );

  return (
    <DetailPanel
      title={faction.name}
      subtitle={subtitle}
      subHeader={
        <PanelTabs
          basePath={`/factions/${factionId}`}
          tabs={FACTION_TABS}
          label="Faction tabs"
        />
      }
    >
      {/* Active tab content */}
      {children}
    </DetailPanel>
  );
}

export default function FactionPanelLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ factionId: string }>;
}) {
  const { factionId } = use(params);

  return (
    <QueryBoundary>
      <FactionPanelContent factionId={factionId}>{children}</FactionPanelContent>
    </QueryBoundary>
  );
}
