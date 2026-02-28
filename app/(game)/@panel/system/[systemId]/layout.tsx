"use client";

import { use, useMemo } from "react";
import { usePathname } from "next/navigation";
import { useUniverse } from "@/lib/hooks/use-universe";
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

function SystemPanelContent({
  systemId,
  children,
}: {
  systemId: string;
  children: React.ReactNode;
}) {
  const { data: universeData } = useUniverse();
  const { fleet } = useFleet();
  const { convoys } = useConvoys();
  const allMissions = useSystemAllMissions(systemId);
  const pathname = usePathname();

  const systemInfo = universeData?.systems.find((s) => s.id === systemId) ?? null;
  const regionInfo = systemInfo
    ? universeData?.regions.find((r) => r.id === systemInfo.regionId) ?? null
    : null;

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

/* ------------------------------------------------------------------ */
/*  Map pin icon (Heroicons map-pin 16×16)                             */
/* ------------------------------------------------------------------ */

function MapPinIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className="w-3.5 h-3.5"
    >
      <path
        fillRule="evenodd"
        d="m7.539 14.841.003.003.002.002a.755.755 0 0 0 .912 0l.002-.002.003-.003.012-.009a5.57 5.57 0 0 0 .19-.153 15.588 15.588 0 0 0 2.046-2.082c1.101-1.362 2.291-3.342 2.291-5.597A5 5 0 0 0 3 7c0 2.255 1.19 4.235 2.292 5.597a15.591 15.591 0 0 0 2.046 2.082 8.916 8.916 0 0 0 .189.153l.012.01ZM8 8.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
