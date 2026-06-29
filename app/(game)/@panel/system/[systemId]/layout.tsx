"use client";

import { use, useMemo } from "react";
import { usePathname } from "next/navigation";
import { useSystemInfo } from "@/lib/hooks/use-system-info";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useConvoys } from "@/lib/hooks/use-convoy";
import { useSystemAllMissions } from "@/lib/hooks/use-op-missions";
import { getDockedShips, getDockedConvoys } from "@/lib/utils/fleet";
import { enrichTraits } from "@/lib/utils/traits";
import { deriveSystemLocations } from "@/lib/constants/locations";
import { SYSTEM_TABS, type SystemTabSegment } from "@/lib/constants/system-tabs";
import { DetailPanel } from "@/components/ui/detail-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EconomyBadge } from "@/components/ui/economy-badge";
import { TabList, TabLink } from "@/components/ui/tabs";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { MapPinIcon } from "@/components/ui/icons";
import { SystemCadenceCountdown } from "@/components/system/system-cadence-countdown";

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

  const exploreCount = useMemo(() => {
    // Counts *playable* locations for the tab badge. Availability is a static
    // catalog flag (only the cantina mini-game today) and body-derived sites are
    // all "coming soon", so the count is substrate-independent — no need to fetch
    // bodies here and block every tab on the substrate query.
    const features = systemInfo?.traits ? enrichTraits(systemInfo.traits) : [];
    return deriveSystemLocations([], features).filter((l) => l.available).length;
  }, [systemInfo?.traits]);

  const basePath = `/system/${systemId}`;
  const tabBadges: Partial<Record<SystemTabSegment, number>> = {
    ships: soloShipCount,
    convoys: convoyCount,
    contracts: contractCount,
    explore: exploreCount,
  };
  const tabs = SYSTEM_TABS.map((tab) => {
    const href = tab.segment ? `${basePath}/${tab.segment}` : basePath;
    return {
      label: tab.label,
      href,
      active: tab.segment ? pathname.startsWith(href) : pathname === basePath,
      badge: tabBadges[tab.segment] ?? 0,
    };
  });

  const subtitle = (
    <span className="inline-flex items-center gap-2">
      {systemInfo && <EconomyBadge economyType={systemInfo.economyType} />}
      {systemInfo?.isGateway && <Badge color="amber">Gateway</Badge>}
      {regionInfo && (
        <span className="text-text-secondary">{regionInfo.name}</span>
      )}
    </span>
  );

  const headerAction = (
    <>
      <SystemCadenceCountdown systemId={systemId} />
      <Button
        variant="ghost"
        size="xs"
        href={`/?systemId=${systemId}`}
        aria-label="Show on map"
      >
        <MapPinIcon />
        <span className="ml-1">Show on Map</span>
      </Button>
    </>
  );

  return (
    <DetailPanel
      title={systemInfo?.name ?? "System"}
      subtitle={subtitle}
      headerAction={headerAction}
      size="xl"
    >
      {/* Tab bar */}
      <TabList className="mb-6" aria-label="System tabs">
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

