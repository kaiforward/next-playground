"use client";

import { use } from "react";
import { usePathname } from "next/navigation";
import { useFaction } from "@/lib/hooks/use-faction";
import { FACTION_TABS } from "@/lib/constants/faction-tabs";
import { DetailPanel } from "@/components/ui/detail-panel";
import { TabList, TabLink } from "@/components/ui/tabs";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { FactionStatusBadge } from "@/components/factions/faction-status-badge";

function FactionPanelContent({
  factionId,
  children,
}: {
  factionId: string;
  children: React.ReactNode;
}) {
  const { faction } = useFaction(factionId);
  const pathname = usePathname();

  const basePath = `/factions/${factionId}`;
  const tabs = FACTION_TABS.map((tab) => {
    const href = tab.segment ? `${basePath}/${tab.segment}` : basePath;
    return {
      label: tab.label,
      href,
      active: tab.segment ? pathname.startsWith(href) : pathname === basePath,
    };
  });

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
        <TabList aria-label="Faction tabs">
          {tabs.map((tab) => (
            <TabLink key={tab.href} href={tab.href} active={tab.active}>
              {tab.label}
            </TabLink>
          ))}
        </TabList>
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
