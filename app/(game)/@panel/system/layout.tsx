"use client";

import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
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
  const router = useRouter();
  const searchParams = useSearchParams();

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

  // Recenter the live map behind the docked drawer without closing it: drive the map's `?focus=`
  // channel on the CURRENT panel path (keeps the drawer route mounted + applies the clear-offset)
  // rather than navigating to "/", which would unmount the drawer. `loc` is a monotonic click-nonce
  // so re-locating to the same system (unchanged `?focus`) still re-fires the recentre. `replace`
  // keeps repeated locates out of the history stack.
  const showOnMap = () => {
    if (!systemInfo) return;
    const loc = Number(searchParams.get("loc") ?? 0) + 1;
    // Recentre from the CURRENT path (not basePath) so locating never resets the active sub-tab.
    router.replace(`${pathname}?focus=${systemInfo.x},${systemInfo.y}&loc=${loc}`);
  };

  const headerAction = (
    <>
      <SystemCadenceCountdown systemId={systemId} />
      <Button
        variant="ghost"
        size="xs"
        onClick={showOnMap}
        disabled={!systemInfo}
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
      scrollResetKey={systemId}
      subHeader={
        <TabList aria-label="System tabs">
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
      }
    >
      {/* Active tab content */}
      {children}
    </DetailPanel>
  );
}

export default function SystemPanelLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // One level ABOVE the [systemId] dynamic segment: the App Router preserves a layout's state
  // across changes to a segment nested beneath it, so DetailPanel (which animates on mount)
  // persists across system-to-system navigation instead of remounting per system. `systemId`
  // isn't in this layout's own `params`, so it's read via useParams() from the matched child
  // segment instead.
  const params = useParams();
  const systemId = params.systemId;

  // Can't happen in practice (this layout only renders under /system/[systemId]/**), but
  // params are string | string[] | undefined — narrow before use rather than asserting.
  if (typeof systemId !== "string") return children;

  return (
    <QueryBoundary>
      <SystemPanelContent systemId={systemId}>
        {children}
      </SystemPanelContent>
    </QueryBoundary>
  );
}
