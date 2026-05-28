"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import type { AtlasData, UniverseData, StarSystemInfo, ShipState, ConvoyState, ActiveEvent } from "@/lib/types/game";
import { shipToNavigableUnit, convoyToNavigableUnit } from "@/lib/types/navigable";
import type { ConnectionInfo } from "@/lib/engine/navigation";
import { SystemDetailPanel } from "@/components/map/system-detail-panel";
import { Button } from "@/components/ui/button";
import { RoutePreviewPanel } from "@/components/map/route-preview-panel";
import { MapOverlayControls } from "@/components/map/map-overlay-controls";
import { PixiMapCanvas } from "@/components/map/pixi/pixi-map-canvas";
import { useNavigationState } from "@/lib/hooks/use-navigation-state";
import { useMapViewState } from "@/lib/hooks/use-map-view-state";
import { useMapData } from "@/lib/hooks/use-map-data";
import { useMapMode } from "@/lib/hooks/use-map-mode";
import { useMapOverlays } from "@/lib/hooks/use-map-overlays";
import { useStaticTiles } from "@/lib/hooks/use-static-tiles";
import { useVisibility } from "@/lib/hooks/use-visibility";
import { useDynamicData } from "@/lib/hooks/use-dynamic-tiles";
import { useTradeFlow } from "@/lib/hooks/use-trade-flow";
import { useMarketComparison } from "@/lib/hooks/use-market-comparison";
import { buildSystemRegionMap } from "@/lib/utils/region";
import { useGoods } from "@/lib/hooks/use-goods";
import { MarketComparisonPanel } from "@/components/market/market-comparison-panel";
import { QueryBoundary } from "@/components/ui/query-boundary";

interface StarMapProps {
  atlas: AtlasData;
  ships: ShipState[];
  convoys: ConvoyState[];
  onNavigateShip: (shipId: string, route: string[]) => Promise<void>;
  onNavigateConvoy?: (convoyId: string, route: string[]) => Promise<void>;
  initialSelectedShipId?: string;
  initialSelectedConvoyId?: string;
  initialSelectedSystemId?: string;
  events?: ActiveEvent[];
}

export function StarMap({
  atlas,
  ships,
  convoys,
  onNavigateShip,
  onNavigateConvoy,
  initialSelectedShipId,
  initialSelectedConvoyId,
  initialSelectedSystemId,
  events = [],
}: StarMapProps) {
  // ── Progressive data loading ────────────────────────────────────
  const { systems: tileSystems, onViewportChange, active } = useStaticTiles();
  const { visibleSystemIds } = useVisibility();
  const { dynamicSystems } = useDynamicData(active);

  // ── Map mode (single-select tint) + additive overlay toggles ──
  const { mode: mapMode, setMode: setMapMode } = useMapMode();
  const { overlays, toggle } = useMapOverlays();
  const { edges: tradeFlowEdges } = useTradeFlow(overlays.tradeFlow);

  // ── Price overlay control state (good picker + comparison panel) ──
  const [priceGoodId, setPriceGoodId] = useState<string | null>(null);
  const [comparisonOpen, setComparisonOpen] = useState(false);

  // ── Price heatmap data (per-system price for the selected good) ──
  // Tagged with the good it was fetched for, and surfaced only when the tag
  // matches the current selection. This avoids a stale flash when switching
  // goods AND sidesteps an effect-ordering race: a separate "clear on change"
  // effect runs after the fetcher's write (child effects fire before parent
  // effects), so for an already-cached good — which resolves synchronously in
  // the same commit — the clear would clobber the fetched data and the markers
  // would never reappear. Deriving instead of clearing has no competing write.
  const heatmapActive = overlays.priceHeatmap && !!priceGoodId;
  const [heatmapState, setHeatmapState] = useState<{
    goodId: string;
    data: Map<string, { currentPrice: number; basePrice: number }>;
  } | null>(null);

  const heatmapData =
    heatmapActive && heatmapState?.goodId === priceGoodId
      ? heatmapState.data
      : null;

  // Cached goods catalog — staleTime: Infinity, ~12 rows, one fetch per session.
  const goods = useGoods();

  // Merge atlas (positions) with static tile data (names + economy)
  const mergedSystems = useMemo((): StarSystemInfo[] => {
    const nameMap = new Map(
      tileSystems.map((s) => [s.id, s]),
    );
    return atlas.systems.map((as) => {
      const tileData = nameMap.get(as.id);
      return {
        id: as.id,
        x: as.x,
        y: as.y,
        regionId: as.regionId,
        factionId: as.factionId,
        economyType: as.economyType,
        isGateway: as.isGateway,
        name: tileData?.name ?? "",
        description: "",
      };
    });
  }, [atlas.systems, tileSystems]);

  // Build UniverseData-compatible structure from atlas + viewport detail.
  // Atlas factions carry only id/name/color; `governmentType` is left null
  // here. Downstream consumers that need real government data fetch the full
  // `/api/game/systems` payload via `useUniverse()`.
  const universe = useMemo((): UniverseData => ({
    regions: atlas.regions,
    systems: mergedSystems,
    connections: atlas.connections,
    factions: atlas.factions.map((f) => ({
      id: f.id,
      name: f.name,
      color: f.color,
      governmentType: null,
    })),
  }), [atlas.regions, atlas.factions, mergedSystems, atlas.connections]);

  // ── Foundation memos (stable across renders) ──────────────────
  const systemRegionMap = useMemo(
    () => buildSystemRegionMap(universe.systems),
    [universe.systems],
  );

  const regionMap = useMemo(
    () => new Map(universe.regions.map((r) => [r.id, r])),
    [universe.regions],
  );

  const regionInfos = useMemo(
    () => universe.regions.map((r) => ({ id: r.id, name: r.name })),
    [universe.regions],
  );

  // ── All connections (needed by both navigation and data hooks) ─
  const allConnections = useMemo(
    (): ConnectionInfo[] =>
      universe.connections.map((c) => ({
        fromSystemId: c.fromSystemId,
        toSystemId: c.toSystemId,
        fuelCost: c.fuelCost,
      })),
    [universe.connections],
  );

  const systemsForComparison = useMemo(
    () => universe.systems.map((s) => ({ id: s.id, name: s.name })),
    [universe.systems],
  );

  // ── View state (selection, session persistence) ────────────────
  const view = useMapViewState({
    universe,
    initialSelectedSystemId: initialSelectedSystemId ?? (initialSelectedConvoyId
      ? convoys.find((c) => c.id === initialSelectedConvoyId)?.systemId
      : undefined),
  });

  // ── Navigation state ──────────────────────────────────────────
  const navigation = useNavigationState({
    connections: allConnections,
    systems: universe.systems,
    onNavigateShip,
    onNavigateConvoy,
  });

  const { mode } = navigation;
  const isNavigationActive = mode.phase !== "default";

  // Hide tier-1 quick-preview when a tier-2 panel route is active
  const pathname = usePathname();
  const isPanelOpen = pathname !== "/";

  // ── Derived map data ────────────────────────────────────────────
  const mapData = useMapData({
    universe,
    ships,
    convoys,
    events,
    visibleSystemIds,
    dynamicSystems,
    tradeFlowEdges,
    selectedSystem: view.selectedSystem,
    navigationMode: mode,
    isNavigationActive,
    systemRegionMap,
    regionMap,
    priceHeatmap: heatmapData,
  });

  // ── Auto-select ship/convoy from URL query param on mount ────────
  useEffect(() => {
    if (!initialSelectedShipId) return;
    const ship = ships.find(
      (s) => s.id === initialSelectedShipId && s.status === "docked",
    );
    if (ship) {
      navigation.selectUnit(shipToNavigableUnit(ship));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelectedShipId]);

  useEffect(() => {
    if (!initialSelectedConvoyId) return;
    const convoy = convoys.find(
      (c) => c.id === initialSelectedConvoyId && c.status === "docked",
    );
    if (convoy) {
      navigation.selectUnit(convoyToNavigableUnit(convoy));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSelectedConvoyId]);

  // ── Destructure stable references for callback deps ──────────
  const {
    selectedSystem, selectSystem,
    closeSystem, setMapReady,
  } = view;

  // ── Click handlers ────────────────────────────────────────────
  const onSystemClick = useCallback(
    (system: { id: string }) => {
      const fullSystem = universe.systems.find((s) => s.id === system.id);
      // Guard: viewport detail hasn't loaded yet — name is empty placeholder
      if (!fullSystem || fullSystem.name === "") return;

      // Navigation logic
      if (mode.phase === "unit_selected") {
        if (!mode.reachable.has(system.id) && system.id !== mode.unit.systemId) {
          return;
        }
        if (system.id === mode.unit.systemId) {
          navigation.cancel();
          return;
        }
        navigation.selectDestination(fullSystem);
        return;
      }

      if (mode.phase === "route_preview") return;

      // Default mode — open system detail panel
      selectSystem(fullSystem);
    },
    [mode, navigation, universe.systems, selectSystem],
  );

  const onEmptyClick = useCallback(() => {
    if (mode.phase === "default") {
      closeSystem();
    }
  }, [mode.phase, closeSystem]);

  // ── Center target (reactive — responds to systemId URL changes) ──
  type CenterTarget = { x: number; y: number; zoom: number };
  const [centerTarget, setCenterTarget] = useState<CenterTarget | undefined>(() => {
    if (!view.initialSelectedSystem) return undefined;
    return { x: view.initialSelectedSystem.x, y: view.initialSelectedSystem.y, zoom: 1.2 };
  });
  const prevSystemIdRef = useRef(initialSelectedSystemId);

  useEffect(() => {
    if (initialSelectedSystemId === prevSystemIdRef.current) return;
    prevSystemIdRef.current = initialSelectedSystemId;
    if (!initialSelectedSystemId) return;
    const system = universe.systems.find((s) => s.id === initialSelectedSystemId);
    if (system) {
      selectSystem(system);
      setCenterTarget({ x: system.x, y: system.y, zoom: 1.2 });
    }
  }, [initialSelectedSystemId, universe.systems, selectSystem]);

  const handleReady = useCallback(() => {
    setMapReady();
  }, [setMapReady]);

  return (
    <div className={`relative h-full w-full ${view.mapReady ? "opacity-100" : "opacity-0"}`}>
      <PixiMapCanvas
        atlasData={atlas}
        mapData={mapData}
        selectedSystem={selectedSystem}
        navigationMode={mode}
        onSystemClick={onSystemClick}
        onEmptyClick={onEmptyClick}
        centerTarget={centerTarget}
        onReady={handleReady}
        regionInfos={regionInfos}
        mapMode={mapMode}
        onViewportChange={onViewportChange}
      />

      {/* Price heatmap data fetcher — only mounts when overlay+good are active. */}
      {heatmapActive && priceGoodId && (
        <QueryBoundary loadingFallback={null}>
          <PriceHeatmapDataFetcher goodId={priceGoodId} onData={setHeatmapState} />
        </QueryBoundary>
      )}

      {/* Map mode + overlay controls (bottom-left) */}
      <MapOverlayControls
        mode={mapMode}
        setMode={setMapMode}
        overlays={overlays}
        toggle={toggle}
        priceGoodId={priceGoodId}
        setPriceGoodId={setPriceGoodId}
        goods={goods}
        onOpenComparisonTable={() => setComparisonOpen(true)}
      />

      {/* Navigation mode banner */}
      {mode.phase === "unit_selected" && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50">
          <div className="flex items-center gap-3 rounded-lg border border-cyan-500/30 bg-gray-900/90 backdrop-blur px-4 py-2 shadow-lg">
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <span className="text-sm text-text-primary">
              Select a destination for <span className="font-semibold text-cyan-300">{mode.unit.name}</span>
              {mode.unit.kind === "convoy" && (
                <span className="text-cyan-300/60 ml-1">({mode.unit.convoy.members.length} ships)</span>
              )}
            </span>
            <Button
              variant="ghost"
              size="xs"
              onClick={navigation.cancel}
              className="ml-2"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Route preview panel */}
      {mode.phase === "route_preview" && (
        <RoutePreviewPanel
          unit={mode.unit}
          destination={mode.destination}
          route={mode.route}
          connections={allConnections}
          systems={universe.systems}
          isNavigating={navigation.isNavigating}
          onConfirm={navigation.confirmNavigation}
          onCancel={navigation.cancel}
        />
      )}

      {/* Detail panel overlay (hidden during navigation mode or when a panel route is open) */}
      {!isNavigationActive && !isPanelOpen && (
        <SystemDetailPanel
          system={selectedSystem}
          shipsHere={mapData.shipsAtSelected}
          convoysHere={mapData.convoysAtSelected}
          regionName={mapData.selectedRegionName}
          factionName={mapData.selectedFactionName}
          gatewayTargetRegions={mapData.selectedGatewayTargets}
          activeEvents={mapData.eventsAtSelected}
          visibility={mapData.selectedVisibility}
          onClose={closeSystem}
          onNavigateUnit={navigation.selectUnit}
        />
      )}

      {/* Cross-system price comparison panel (Price overlay) */}
      {comparisonOpen && priceGoodId && view.selectedSystem && (
        <MarketComparisonPanel
          goodId={priceGoodId}
          goodName={goods.find((g) => g.id === priceGoodId)?.name ?? priceGoodId}
          fromSystemId={view.selectedSystem.id}
          fromSystemName={view.selectedSystem.name}
          systems={systemsForComparison}
          connections={allConnections}
          onSelectSystem={(sysId) => {
            const sys = universe.systems.find((s) => s.id === sysId);
            if (sys) {
              view.selectSystem(sys);
              setCenterTarget({ x: sys.x, y: sys.y, zoom: 1.2 });
            }
            setComparisonOpen(false);
          }}
          onClose={() => setComparisonOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * Suspense-isolated price-data fetcher. Lives outside StarMap so the
 * suspending hook only mounts when the heatmap overlay is active, and
 * lifts the resulting map back up via the `onData` callback.
 */
function PriceHeatmapDataFetcher({
  goodId,
  onData,
}: {
  goodId: string;
  onData: (state: {
    goodId: string;
    data: Map<string, { currentPrice: number; basePrice: number }>;
  }) => void;
}) {
  const { entries } = useMarketComparison(goodId);
  const map = useMemo(() => {
    const m = new Map<string, { currentPrice: number; basePrice: number }>();
    for (const e of entries) {
      m.set(e.systemId, { currentPrice: e.currentPrice, basePrice: e.basePrice });
    }
    return m;
  }, [entries]);
  useEffect(() => {
    onData({ goodId, data: map });
  }, [goodId, map, onData]);
  return null;
}
