"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUniverse } from "@/lib/hooks/use-universe";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useConvoys } from "@/lib/hooks/use-convoy";
import { useSystemAllMissions } from "@/lib/hooks/use-op-missions";
import { getDockedShips, getDockedConvoys } from "@/lib/utils/fleet";
import { BackLink } from "@/components/ui/back-link";
import { Badge } from "@/components/ui/badge";
import { EconomyBadge } from "@/components/ui/economy-badge";
import { TabList, TabLink } from "@/components/ui/tabs";
import { PageContainer } from "@/components/ui/page-container";
import { QueryBoundary } from "@/components/ui/query-boundary";

function SystemLayoutContent({
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

  return (
    <>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <BackLink href={`/map?systemId=${systemId}`} />
        <h1 className="text-2xl font-bold">
          {systemInfo?.name ?? "System"}
        </h1>
        {systemInfo && (
          <>
            <EconomyBadge economyType={systemInfo.economyType} />
            {systemInfo.isGateway && (
              <Badge color="amber">Gateway</Badge>
            )}
          </>
        )}
      </div>

      {regionInfo && (
        <p className="text-sm text-white/40 mb-1">
          Region: <span className="text-white/60">{regionInfo.name}</span>
          <span className="text-white/30"> &middot; </span>
          <span className="text-white/50 capitalize">
            {regionInfo.dominantEconomy} economy
          </span>
        </p>
      )}

      {systemInfo?.description && (
        <p className="text-white/60 mb-4">{systemInfo.description}</p>
      )}

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
    </>
  );
}

export default function SystemLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);

  return (
    <PageContainer size="lg">
      <QueryBoundary>
        <SystemLayoutContent systemId={systemId}>
          {children}
        </SystemLayoutContent>
      </QueryBoundary>
    </PageContainer>
  );
}
