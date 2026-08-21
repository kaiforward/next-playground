"use client";

import { ErrorBoundary } from "react-error-boundary";
import { useFaction } from "@/lib/hooks/use-faction";
import { FACTION_TABS } from "@/lib/constants/faction-tabs";
import { useGameSlice } from "@/lib/store/use-game-store";
import { DetailPanel } from "@/components/ui/detail-panel";
import { PanelTabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/empty-state";
import { renderErrorFallback } from "@/components/ui/error-fallback";
import { FactionStatusBadge } from "@/components/factions/faction-status-badge";
import { FactionOverview } from "@/components/panels/faction-overview";
import { FactionDiplomacy } from "@/components/panels/faction-diplomacy";
import { FactionTerritory } from "@/components/panels/faction-territory";
import { FactionFactions } from "@/components/panels/faction-factions";
import { FactionEvents } from "@/components/panels/faction-events";

/**
 * The faction panel's route component (client-runtime build plan Task 9) — replaces
 * `app/(game)/@panel/factions/[factionId]/layout.tsx` + `page.tsx`s. Existence is the same
 * discriminated `useFaction` result the hook already carries (`{ found: false }` for a faction id
 * absent from the snapshot) — checked once, here, before any tab body mounts.
 */
export function FactionPanel({ factionId, tab }: { factionId: string; tab: string }) {
  const result = useFaction(factionId);
  // Pre-boot guard: `worldVersion` is null until the worker's first state frame lands, and
  // `useFaction` reads its slice's empty default until then — indistinguishable at this point from
  // a genuinely absent id. Render nothing rather than flashing not-found for an entity that is
  // really just not loaded yet. Stopgap until Task 11 builds the real boot/liveness UX.
  const booted = useGameSlice((state) => state.worldVersion !== null);

  if (!booted) return null;

  if (!result.found) {
    return (
      <DetailPanel title="Faction">
        <EmptyState message="This faction no longer exists in the current galaxy." />
      </DetailPanel>
    );
  }
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

  const basePath = `/factions/${factionId}`;
  const currentPathname = tab ? `${basePath}/${tab}` : basePath;

  return (
    <DetailPanel
      title={faction.name}
      subtitle={subtitle}
      subHeader={
        <PanelTabs
          basePath={basePath}
          tabs={FACTION_TABS}
          label="Faction tabs"
          pathname={currentPathname}
        />
      }
    >
      <ErrorBoundary fallbackRender={renderErrorFallback}>
        <FactionTabBody factionId={factionId} tab={tab} />
      </ErrorBoundary>
    </DetailPanel>
  );
}

function FactionTabBody({ factionId, tab }: { factionId: string; tab: string }) {
  switch (tab) {
    case "diplomacy":
      return <FactionDiplomacy factionId={factionId} />;
    case "territory":
      return <FactionTerritory factionId={factionId} />;
    case "factions":
      return <FactionFactions />;
    case "events":
      return <FactionEvents />;
    case "":
    default:
      return <FactionOverview factionId={factionId} />;
  }
}
