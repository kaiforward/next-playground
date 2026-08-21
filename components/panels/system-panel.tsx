"use client";

import { ErrorBoundary } from "react-error-boundary";
import { useSystemInfo } from "@/lib/hooks/use-system-info";
import { useOwnership } from "@/lib/hooks/use-ownership";
import { useGameSlice } from "@/lib/store/use-game-store";
import { useInterest } from "@/lib/store/interest";
import { SYSTEM_TABS } from "@/lib/constants/system-tabs";
import { DetailPanel } from "@/components/ui/detail-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PanelTabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { renderErrorFallback } from "@/components/ui/error-fallback";
import { MapPinIcon } from "@/components/ui/icons";
import { SystemCadenceCountdown } from "@/components/system/system-cadence-countdown";
import { PinToggle } from "@/components/system/pin-toggle";
import { useNavigate, useRouteInfo } from "@/components/ui/link-provider";
import { SystemOverview } from "@/components/panels/system-overview";
import { SystemAstrography } from "@/components/panels/system-astrography";
import { SystemPopulation } from "@/components/panels/system-population";
import { SystemIndustry } from "@/components/panels/system-industry";
import { SystemLogistics } from "@/components/panels/system-logistics";
import { SystemMarket } from "@/components/panels/system-market";

/**
 * The system panel's route component (client-runtime build plan Task 9) — replaces
 * `app/(game)/@panel/system/layout.tsx` + `[systemId]/**\/page.tsx`. Existence is checked HERE, once,
 * against the atlas/universe lookup (`useSystemInfo`), never against a per-tab hook's own nothing-arm
 * — `visibility: "unknown"` on a tab hook is indistinguishable from a real undeveloped/fogged system
 * (ledger note from the Task 7/8 review), so a stale panel URL (after New Game/Load, or a bad direct
 * navigation) has to be told apart from "developed but nothing to show yet" up here, before any tab
 * body ever renders.
 */
export function SystemPanel({ systemId, tab }: { systemId: string; tab: string }) {
  // Declares interest so the worker's next frame carries this system's detail families
  // (frame-architecture spec, "Interest protocol") — released automatically on unmount/id change.
  useInterest("system", systemId);
  const { systemInfo, regionInfo } = useSystemInfo(systemId);
  const ownership = useOwnership();
  const navigate = useNavigate();
  const { pathname, searchParams } = useRouteInfo();
  // Pre-boot guard: `worldVersion` is null until the worker's first state frame lands, and every
  // hook above reads its slice's empty default until then — indistinguishable at this point from a
  // genuinely absent id. Render nothing rather than flashing not-found for an entity that is really
  // just not loaded yet. Stopgap until Task 11 builds the real boot/liveness UX.
  const booted = useGameSlice((state) => state.worldVersion !== null);
  // First-paint presence gate (frame-architecture spec, "Interest protocol"): any interest-keyed
  // family works here since a subscribed system's whole bundle lands atomically in one frame
  // (Task 1 Proves 3) — `systemVitals` is the pick. This is PRESENCE, distinct from the EXISTENCE
  // check above (`systemInfo`, sourced from `universe`): an id can exist in the galaxy but not yet
  // be in the current interest set (panel just opened, frame not landed) or the game is paused.
  const detailPresent = useGameSlice(
    (state) => state.slices.systemVitals?.[systemId] !== undefined,
  );

  if (!booted) return null;

  if (!systemInfo) {
    return (
      <DetailPanel title="System">
        <EmptyState message="This system no longer exists in the current galaxy." />
      </DetailPanel>
    );
  }

  // Live developed tier (tick-invalidated). Non-developed systems show only Overview +
  // Astrography; the four economy tabs (Population/Industry/Logistics/Market) are hidden.
  // Default to developed while ownership is still loading so we never hide a real system's
  // tabs on a cold direct-load — the services gate the inert case regardless.
  const isDeveloped = ownership.get(systemId)?.developed ?? true;
  const visibleTabs = SYSTEM_TABS.filter(
    (t) => isDeveloped || t.segment === "" || t.segment === "astrography",
  );

  const subtitle = (
    <span className="inline-flex items-center gap-2">
      {systemInfo.isGateway && <Badge color="amber">Gateway</Badge>}
      {regionInfo && <span className="text-text-secondary">{regionInfo.name}</span>}
    </span>
  );

  const basePath = `/system/${systemId}`;

  // Recenter the live map behind the docked drawer without closing it: drive the map's `?focus=`
  // channel on the CURRENT panel path (keeps the drawer route mounted + applies the clear-offset)
  // rather than navigating to "/", which would unmount the drawer. `loc` is a monotonic click-nonce
  // so re-locating to the same system (unchanged `?focus`) still re-fires the recentre. `replace`
  // keeps repeated locates out of the history stack.
  const showOnMap = () => {
    const loc = Number(searchParams.get("loc") ?? 0) + 1;
    navigate(`${pathname}?focus=${systemInfo.x},${systemInfo.y}&loc=${loc}`, { replace: true });
  };

  const headerAction = (
    <>
      <SystemCadenceCountdown systemId={systemId} />
      <PinToggle systemId={systemId} />
      <Button variant="ghost" size="xs" onClick={showOnMap} aria-label="Show on map">
        <MapPinIcon />
        <span className="ml-1">Show on Map</span>
      </Button>
    </>
  );

  const currentPathname = tab ? `${basePath}/${tab}` : basePath;

  return (
    <DetailPanel
      title={systemInfo.name}
      subtitle={subtitle}
      headerAction={headerAction}
      scrollResetKey={systemId}
      subHeader={
        <PanelTabs
          basePath={basePath}
          tabs={visibleTabs}
          label="System tabs"
          pathname={currentPathname}
        />
      }
    >
      {detailPresent && (
        <ErrorBoundary fallbackRender={renderErrorFallback}>
          <SystemTabBody systemId={systemId} tab={tab} />
        </ErrorBoundary>
      )}
    </DetailPanel>
  );
}

function SystemTabBody({ systemId, tab }: { systemId: string; tab: string }) {
  switch (tab) {
    case "astrography":
      return <SystemAstrography systemId={systemId} />;
    case "population":
      return <SystemPopulation systemId={systemId} />;
    case "industry":
      return <SystemIndustry systemId={systemId} />;
    case "logistics":
      return <SystemLogistics systemId={systemId} />;
    case "market":
      return <SystemMarket systemId={systemId} />;
    case "":
    default:
      return <SystemOverview systemId={systemId} />;
  }
}
