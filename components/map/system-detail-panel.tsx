"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EconomyBadge } from "@/components/ui/economy-badge";
import type { StarSystemInfo, ShipState, ActiveEvent } from "@/lib/types/game";
import { ActiveEventsSection } from "@/components/events/active-events-section";
import { TraitList } from "@/components/ui/trait-list";
import { enrichTraits } from "@/lib/utils/traits";

interface GatewayTarget {
  regionId: string;
  regionName: string;
}

interface SystemDetailPanelProps {
  system: StarSystemInfo | null;
  shipsHere: ShipState[];
  currentTick: number;
  regionName?: string;
  gatewayTargetRegions?: GatewayTarget[];
  activeEvents?: ActiveEvent[];
  onSelectShipForNavigation?: (ship: ShipState) => void;
  onJumpToRegion?: (regionId: string) => void;
  onClose: () => void;
}

export function SystemDetailPanel({
  system,
  shipsHere,
  currentTick,
  regionName,
  gatewayTargetRegions,
  activeEvents,
  onSelectShipForNavigation,
  onJumpToRegion,
  onClose,
}: SystemDetailPanelProps) {
  if (!system) return null;

  return (
    <Dialog
      open
      onClose={onClose}
      initialFocus="[aria-label='Close panel']"
      className="fixed top-12 right-0 h-[calc(100%-3rem)] w-80 bg-gray-900 border-l border-gray-700 shadow-2xl z-50 flex flex-col"
      aria-label={`${system.name} system details`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <h2 className="text-lg font-bold text-white">{system.name}</h2>
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
        {/* Economy badge + region + gateway */}
        <div className="flex flex-wrap items-center gap-2">
          <EconomyBadge economyType={system.economyType} />
          {system.isGateway && (
            <Badge color="amber">Gateway</Badge>
          )}
        </div>

        {regionName && (
          <p className="text-xs text-white/50">
            Region: <span className="text-white/70">{regionName}</span>
          </p>
        )}

        {/* Connected regions (gateway only) */}
        {gatewayTargetRegions && gatewayTargetRegions.length > 0 && onJumpToRegion && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
              Connected Regions
            </h3>
            <div className="space-y-1.5">
              {gatewayTargetRegions.map((target) => (
                <Button
                  key={target.regionId}
                  variant="ghost"
                  fullWidth
                  onClick={() => onJumpToRegion(target.regionId)}
                  className="justify-between bg-amber-500/10 hover:bg-amber-500/20 text-left"
                >
                  <span className="text-sm text-amber-200">
                    Jump to {target.regionName}
                  </span>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-amber-400">
                    <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z" clipRule="evenodd" />
                  </svg>
                </Button>
              ))}
            </div>
          </div>
        )}

        {/* Description (hidden when empty — procedural systems have no description yet) */}
        {system.description && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
              Description
            </h3>
            <p className="text-sm text-gray-300 leading-relaxed">
              {system.description}
            </p>
          </div>
        )}

        {/* System traits */}
        {system.traits && system.traits.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
              Traits
            </h3>
            <TraitList traits={enrichTraits(system.traits)} variant="compact" />
          </div>
        )}

        {/* Active events */}
        {activeEvents && <ActiveEventsSection events={activeEvents} compact />}

        {/* Ships at this system */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
            Your Ships Here
          </h3>
          {shipsHere.length === 0 ? (
            <p className="text-sm text-gray-500">No ships docked at this system.</p>
          ) : (
            <ul className="space-y-2">
              {shipsHere.map((ship) => (
                <li
                  key={ship.id}
                  className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5"
                >
                  <div>
                    <Link
                      href={`/ship/${ship.id}?from=system-${system.id}`}
                      className="text-sm font-medium text-white hover:text-blue-300 transition-colors"
                    >
                      {ship.name}
                    </Link>
                    <div className="text-[10px] text-white/40">
                      Fuel: {Math.round(ship.fuel)}/{ship.maxFuel}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {onSelectShipForNavigation && (
                      <Button
                        variant="pill"
                        color="cyan"
                        size="xs"
                        onClick={() => onSelectShipForNavigation(ship)}
                      >
                        Navigate
                      </Button>
                    )}
                    <Link
                      href={`/system/${system.id}/market?shipId=${ship.id}`}
                      className="text-xs font-medium text-indigo-300 hover:text-indigo-200 transition-colors"
                    >
                      Trade
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Coordinates */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
            Coordinates
          </h3>
          <p className="text-sm text-gray-300 font-mono">
            X: {system.x} &middot; Y: {system.y}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 py-3 border-t border-gray-700 space-y-2">
        <Button
          href={`/system/${system.id}`}
          variant="action"
          color="indigo"
          size="md"
          fullWidth
          className="shadow-lg shadow-indigo-900/30 active:scale-[0.98]"
        >
          View System
        </Button>
        <Button onClick={onClose} variant="ghost" size="md" fullWidth>
          Close
        </Button>
      </div>
    </Dialog>
  );
}
