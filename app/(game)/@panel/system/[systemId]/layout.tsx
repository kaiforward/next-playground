"use client";

import { use } from "react";
import { usePathname } from "next/navigation";
import { useSystemInfo } from "@/lib/hooks/use-system-info";
import { useOwnership } from "@/lib/hooks/use-ownership";
import { SYSTEM_TABS } from "@/lib/constants/system-tabs";
import { DetailPanel } from "@/components/ui/detail-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  const ownership = useOwnership();
  const pathname = usePathname();

  // Live developed tier (tick-invalidated). Non-developed systems show only Overview +
  // Astrography; the four economy tabs (Population/Industry/Logistics/Market) are hidden.
  // Default to developed while ownership is still loading so we never hide a real system's
  // tabs on a cold direct-load — the services gate the inert case regardless.
  const isDeveloped = ownership.get(systemId)?.developed ?? true;
  const visibleTabs = SYSTEM_TABS.filter(
    (tab) => isDeveloped || tab.segment === "" || tab.segment === "astrography",
  );

  const basePath = `/system/${systemId}`;
  const tabs = visibleTabs.map((tab) => {
    const href = tab.segment ? `${basePath}/${tab.segment}` : basePath;
    return {
      label: tab.label,
      href,
      active: tab.segment ? pathname.startsWith(href) : pathname === basePath,
    };
  });

  const subtitle = (
    <span className="inline-flex items-center gap-2">
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
    >
      {/* Tab bar */}
      <TabList className="mb-6" aria-label="System tabs">
        {tabs.map((tab) => (
          <TabLink
            key={tab.href}
            href={tab.href}
            active={tab.active}
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

