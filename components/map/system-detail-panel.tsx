"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { StarSystemInfo, ActiveEvent, SystemVisibility } from "@/lib/types/game";
import { ActiveEventsSection } from "@/components/events/active-events-section";
import { SectionHeader } from "@/components/ui/section-header";
import { SYSTEM_TABS } from "@/lib/constants/system-tabs";

interface GatewayTarget {
  regionId: string;
  regionName: string;
}

interface SystemDetailPanelProps {
  system: StarSystemInfo | null;
  regionName?: string;
  factionName?: string;
  gatewayTargetRegions?: GatewayTarget[];
  activeEvents?: ActiveEvent[];
  visibility: SystemVisibility;
  onClose: () => void;
}

export function SystemDetailPanel({
  system,
  regionName,
  factionName,
  gatewayTargetRegions,
  activeEvents,
  visibility,
  onClose,
}: SystemDetailPanelProps) {
  if (!system) return null;

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
        {/* Status row: gateway */}
        <div className="flex flex-wrap items-center gap-2">
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
        <div className="px-4 py-3 border-t border-gray-700 space-y-3">
          {/* Tab shortcuts — Overview has its own dedicated button below. */}
          <div className="flex flex-col gap-1">
            {SYSTEM_TABS.filter(
              (tab) => tab.segment && (system.developed || tab.segment === "astrography"),
            ).map((tab) => (
              <Button
                key={tab.segment}
                href={`/system/${system.id}/${tab.segment}`}
                variant="ghost"
                size="xs"
                fullWidth
                className="bg-surface border-border-strong text-text-primary uppercase tracking-wider font-medium hover:bg-surface-hover"
              >
                {tab.label}
              </Button>
            ))}
          </div>
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
