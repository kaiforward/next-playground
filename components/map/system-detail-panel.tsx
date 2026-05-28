"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EconomyBadge } from "@/components/ui/economy-badge";
import type { StarSystemInfo, ShipState, ConvoyState, ActiveEvent, SystemVisibility } from "@/lib/types/game";
import type { NavigableUnit } from "@/lib/types/navigable";
import { shipToNavigableUnit, convoyToNavigableUnit } from "@/lib/types/navigable";
import { ActiveEventsSection } from "@/components/events/active-events-section";
import { TraitList } from "@/components/ui/trait-list";
import { SectionHeader } from "@/components/ui/section-header";
import { CompactShipCard } from "@/components/map/compact-ship-card";
import { CompactConvoyCard } from "@/components/map/compact-convoy-card";
import { enrichTraits } from "@/lib/utils/traits";

interface GatewayTarget {
  regionId: string;
  regionName: string;
}

interface SystemDetailPanelProps {
  system: StarSystemInfo | null;
  shipsHere: ShipState[];
  convoysHere: ConvoyState[];
  regionName?: string;
  factionName?: string;
  gatewayTargetRegions?: GatewayTarget[];
  activeEvents?: ActiveEvent[];
  visibility: SystemVisibility;
  onClose: () => void;
  /** Triggers nav-mode for the given unit (ship or convoy) without leaving the map. */
  onNavigateUnit: (unit: NavigableUnit) => void;
}

const MAX_VISIBLE_PER_SECTION = 3;

export function SystemDetailPanel({
  system,
  shipsHere,
  convoysHere,
  regionName,
  factionName,
  gatewayTargetRegions,
  activeEvents,
  visibility,
  onClose,
  onNavigateUnit,
}: SystemDetailPanelProps) {
  if (!system) return null;

  // Only idle ships/convoys are actionable from the panel.
  const idleShips = shipsHere.filter(
    (s) => s.status === "docked" && !s.convoyId && !s.disabled,
  );
  const idleConvoys = convoysHere.filter((c) => c.status === "docked");

  const visibleConvoys = idleConvoys.slice(0, MAX_VISIBLE_PER_SECTION);
  const hiddenConvoys = idleConvoys.length - visibleConvoys.length;

  const visibleShips = idleShips.slice(0, MAX_VISIBLE_PER_SECTION);
  const hiddenShips = idleShips.length - visibleShips.length;

  return (
    <Dialog
      open
      onClose={onClose}
      initialFocus="[aria-label='Close panel']"
      className="fixed top-12 right-0 h-[calc(100%-3rem)] w-80 bg-surface border-l border-gray-700 shadow-2xl z-50 flex flex-col"
      aria-label={`${system.name} system details`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <h2 className="text-lg font-bold text-text-primary">{system.name}</h2>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white transition-colors p-1 rounded hover:bg-gray-800"
          aria-label="Close panel"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {/* Status row: economy + gateway */}
        <div className="flex flex-wrap items-center gap-2">
          <EconomyBadge economyType={system.economyType} />
          {system.isGateway && <Badge color="amber">Gateway</Badge>}
        </div>

        {(regionName || factionName) && (
          <div className="space-y-1 text-xs text-text-tertiary">
            {regionName && (
              <p>
                Region: <span className="text-text-secondary">{regionName}</span>
              </p>
            )}
            {factionName && (
              <p>
                Faction: <span className="text-text-secondary">{factionName}</span>
              </p>
            )}
          </div>
        )}

        {/* Tab shortcuts — only when system is visible. Overview is reached via the footer button. */}
        {visibility === "visible" && (
          <div className="grid grid-cols-3 gap-1">
            {[
              { href: `/system/${system.id}/market`, label: "Market" },
              { href: `/system/${system.id}/ships`, label: "Ships" },
              { href: `/system/${system.id}/convoys`, label: "Convoys" },
              { href: `/system/${system.id}/shipyard`, label: "Shipyard" },
              { href: `/system/${system.id}/contracts`, label: "Contracts" },
              { href: `/system/${system.id}/explore`, label: "Explore" },
            ].map(({ href, label }) => (
              <Button
                key={label}
                href={href}
                variant="ghost"
                size="xs"
                className="bg-surface border-border-strong text-text-primary uppercase tracking-wider font-medium hover:bg-surface-hover"
              >
                {label}
              </Button>
            ))}
          </div>
        )}

        {visibility === "unknown" ? (
          /* Unknown system — limited info */
          <div className="rounded-lg border border-gray-700 bg-gray-800/50 px-4 py-6 text-center">
            <p className="text-sm text-text-tertiary">No current intel</p>
            <p className="mt-1 text-xs text-text-tertiary">
              Move a ship closer to scan this system.
            </p>
          </div>
        ) : (
          /* Visible system — full detail */
          <>
            {/* Connected regions (gateway only) */}
            {gatewayTargetRegions && gatewayTargetRegions.length > 0 && (
              <div>
                <SectionHeader className="mb-2">
                  Connected Regions
                </SectionHeader>
                <div className="space-y-1.5">
                  {gatewayTargetRegions.map((target) => (
                    <p key={target.regionId} className="text-sm text-amber-200">
                      {target.regionName}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* Description (hidden when empty — procedural systems have no description yet) */}
            {system.description && (
              <div>
                <SectionHeader className="mb-1">
                  Description
                </SectionHeader>
                <p className="text-sm text-gray-300 leading-relaxed">
                  {system.description}
                </p>
              </div>
            )}

            {/* Active events */}
            {activeEvents && <ActiveEventsSection events={activeEvents} compact />}

            {/* Convoys Here */}
            {idleConvoys.length > 0 && (
              <div>
                <SectionHeader className="mb-2 flex items-center justify-between">
                  <span>Convoys Here</span>
                  <span className="font-normal text-text-tertiary normal-case tracking-normal">
                    {idleConvoys.length}
                  </span>
                </SectionHeader>
                <div className="flex flex-col gap-1.5">
                  {visibleConvoys.map((c) => (
                    <CompactConvoyCard
                      key={c.id}
                      convoy={c}
                      systemId={system.id}
                      onNavigate={(convoy) => onNavigateUnit(convoyToNavigableUnit(convoy))}
                    />
                  ))}
                  {hiddenConvoys > 0 && (
                    <Link
                      href={`/system/${system.id}/convoys`}
                      className="text-xs text-text-accent hover:text-accent-muted text-center py-1"
                    >
                      View all {idleConvoys.length} convoys &rarr;
                    </Link>
                  )}
                </div>
              </div>
            )}

            {/* Ships Here */}
            {idleShips.length > 0 && (
              <div>
                <SectionHeader className="mb-2 flex items-center justify-between">
                  <span>Ships Here</span>
                  <span className="font-normal text-text-tertiary normal-case tracking-normal">
                    {idleShips.length}
                  </span>
                </SectionHeader>
                <div className="flex flex-col gap-1.5">
                  {visibleShips.map((s) => (
                    <CompactShipCard
                      key={s.id}
                      ship={s}
                      systemId={system.id}
                      onNavigate={(ship) => onNavigateUnit(shipToNavigableUnit(ship))}
                    />
                  ))}
                  {hiddenShips > 0 && (
                    <Link
                      href={`/system/${system.id}/ships`}
                      className="text-xs text-text-accent hover:text-accent-muted text-center py-1"
                    >
                      View all {idleShips.length} ships &rarr;
                    </Link>
                  )}
                </div>
              </div>
            )}

            {idleConvoys.length === 0 && idleShips.length === 0 && (
              <p className="text-sm text-text-tertiary">No idle ships docked here.</p>
            )}

            {/* System traits */}
            {system.traits && system.traits.length > 0 && (
              <div>
                <SectionHeader className="mb-2">
                  Traits
                </SectionHeader>
                <TraitList traits={enrichTraits(system.traits)} variant="compact" />
              </div>
            )}

            {/* Coordinates */}
            <div>
              <SectionHeader className="mb-1">
                Coordinates
              </SectionHeader>
              <p className="text-sm text-gray-300 font-mono">
                X: {system.x} &middot; Y: {system.y}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Actions */}
      {visibility === "visible" && (
        <div className="px-4 py-3 border-t border-gray-700">
          <Button
            href={`/system/${system.id}`}
            variant="outline"
            size="md"
            fullWidth
          >
            View System Overview
          </Button>
        </div>
      )}
    </Dialog>
  );
}
