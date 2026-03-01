"use client";

import { use, useMemo } from "react";
import { usePathname } from "next/navigation";
import { useSystemInfo } from "@/lib/hooks/use-system-info";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useConvoys } from "@/lib/hooks/use-convoy";
import { useSystemAllMissions } from "@/lib/hooks/use-op-missions";
import { getDockedShips, getDockedConvoys } from "@/lib/utils/fleet";
import { DetailPanel } from "@/components/ui/detail-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EconomyBadge } from "@/components/ui/economy-badge";
import { TabList, TabLink } from "@/components/ui/tabs";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { MapPinIcon } from "@/components/ui/icons";

function SystemPanelContent({
  systemId,
  children,
}: {
  systemId: string;
  children: React.ReactNode;
}) {
  const { systemInfo, regionInfo } = useSystemInfo(systemId);
  const { fleet } = useFleet();
  const { convoys } = useConvoys();
  const allMissions = useSystemAllMissions(systemId);
  const pathname = usePathname();

  const soloShipCount = useMemo(
    () => getDockedShips(fleet.ships, systemId).length,
    [fleet.ships, systemId],
  );
  const convoyCount = useMemo(
    () => getDockedConvoys(convoys, systemId).length,
    [convoys, systemId],
  );
  const contractCount =
    allMissions.tradeMissions.available.length +
    allMissions.opMissions.available.length;

  const basePath = `/system/${systemId}`;
  const tabs = [
    { label: "Overview", href: basePath, active: pathname === basePath, badge: 0 },
    { label: "Market", href: `${basePath}/market`, active: pathname.startsWith(`${basePath}/market`), badge: 0 },
    { label: "Ships", href: `${basePath}/ships`, active: pathname.startsWith(`${basePath}/ships`), badge: soloShipCount },
    { label: "Convoys", href: `${basePath}/convoys`, active: pathname.startsWith(`${basePath}/convoys`), badge: convoyCount },
    { label: "Shipyard", href: `${basePath}/shipyard`, active: pathname.startsWith(`${basePath}/shipyard`), badge: 0 },
    { label: "Contracts", href: `${basePath}/contracts`, active: pathname.startsWith(`${basePath}/contracts`), badge: contractCount },
  ];

  const subtitle = (
    <span className="inline-flex items-center gap-2">
      {systemInfo && <EconomyBadge economyType={systemInfo.economyType} />}
      {systemInfo?.isGateway && <Badge color="amber">Gateway</Badge>}
      {regionInfo && (
        <span className="text-text-muted">{regionInfo.name}</span>
      )}
    </span>
  );

  const showOnMapButton = (
    <Button
      variant="ghost"
      size="xs"
      href={`/?systemId=${systemId}`}
      aria-label="Show on map"
    >
      <MapPinIcon />
      <span className="ml-1">Show on Map</span>
    </Button>
  );

  return (
    <DetailPanel
      title={systemInfo?.name ?? "System"}
      subtitle={subtitle}
      headerAction={showOnMapButton}
      size="lg"
    >
      {/* Tab bar */}
      <TabList className="mb-6">
        {tabs.map((tab) => (
          <TabLink
            key={tab.href}
            href={tab.href}
            active={tab.active}
            count={tab.badge}
          >
            {tab.label}
          </TabLink>
        ))}
      </TabList>

      {/* Active tab content */}
      {children}
    </DetailPanel>
  );
}

export default function SystemPanelLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);

  return (
    <QueryBoundary>
      <SystemPanelContent systemId={systemId}>
        {children}
      </SystemPanelContent>
    </QueryBoundary>
  );
}

