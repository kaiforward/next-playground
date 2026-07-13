"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import type { AtlasData, UniverseData, StarSystemInfo, ActiveEvent } from "@/lib/types/game";
import type { ConnectionInfo } from "@/lib/engine/navigation";
import { MapControlsDock } from "@/components/map/map-controls-dock";
import { MapZoomDebug } from "@/components/map/map-zoom-debug";
import { useDevOverlay } from "@/components/dev-tools/dev-overlay-context";
import { PixiMapCanvas } from "@/components/map/pixi/pixi-map-canvas";
import { useMapData } from "@/lib/hooks/use-map-data";
import { useMapMode } from "@/lib/hooks/use-map-mode";
import { useMapOverlays } from "@/lib/hooks/use-map-overlays";
import { useStaticTiles } from "@/lib/hooks/use-static-tiles";
import { useVisibility } from "@/lib/hooks/use-visibility";
import { useDynamicData } from "@/lib/hooks/use-dynamic-tiles";
import { useOwnership } from "@/lib/hooks/use-ownership";
import { useTradeFlow } from "@/lib/hooks/use-trade-flow";
import { useStability } from "@/lib/hooks/use-stability";
import { usePopulation } from "@/lib/hooks/use-population";
import { useDevelopment } from "@/lib/hooks/use-development";
import { useMarketComparison } from "@/lib/hooks/use-market-comparison";
import { buildSystemRegionMap } from "@/lib/utils/region";
import { useGoods } from "@/lib/hooks/use-goods";
import { MarketComparisonPanel } from "@/components/market/market-comparison-panel";
import { QueryBoundary } from "@/components/ui/query-boundary";

interface StarMapProps {
  atlas: AtlasData;
  initialSelectedSystemId?: string;
  events?: ActiveEvent[];
}

export function StarMap({
  atlas,
  initialSelectedSystemId,
  events = [],
}: StarMapProps) {
  // ── Progressive data loading ────────────────────────────────────
  const { systems: tileSystems, onViewportChange, active, zoom } = useStaticTiles(
    atlas.meta.mapSize,
  );
  const { showMapDebug } = useDevOverlay();
  const { visibleSystemIds } = useVisibility();
  const { dynamicSystems } = useDynamicData(active);
  // Live ownership (faction + developed tier) — tick-invalidated on the monthly claim/develop pulse.
  // Overlaid onto the static atlas so territory + markers repaint as factions expand (the atlas itself
  // stays staleTime:Infinity — only ownership rides the dynamic path).
  const ownership = useOwnership();

  // ── Map mode (single-select tint) + additive overlay toggles ──
  const { mode: mapMode, setMode: setMapMode } = useMapMode();
  const { overlays, toggle } = useMapOverlays();
  const { logisticsEdges } = useTradeFlow(overlays.logistics);
  const stabilityBySystem = useStability(mapMode === "stability");
  const populationBySystem = usePopulation(mapMode === "population");
  const developmentBySystem = useDevelopment(mapMode === "development");

  // Stability is dynamic "story" state, so fog-of-war applies: only tint systems
  // the player can currently sense. Topology (political/regions) stays public;
  // this gate is what the stability choropleth and other dynamic modes share.
  const visibleStability = useMemo(() => {
    const gated = new Map<string, number>();
    for (const [systemId, unrest] of stabilityBySystem) {
      if (visibleSystemIds.has(systemId)) gated.set(systemId, unrest);
    }
    return gated;
  }, [stabilityBySystem, visibleSystemIds]);

  // Population is also dynamic story state — same fog gate as stability. The
  // relative ramp then normalises against the max of this visible set.
  const visiblePopulation = useMemo(() => {
    const gated = new Map<string, number>();
    for (const [systemId, population] of populationBySystem) {
      if (visibleSystemIds.has(systemId)) gated.set(systemId, population);
    }
    return gated;
  }, [populationBySystem, visibleSystemIds]);

  // Development is dynamic story state too — same fog gate. Its ramp is absolute,
  // so no visible-max normalisation, just the fog restriction.
  const visibleDevelopment = useMemo(() => {
    const gated = new Map<string, number>();
    for (const [systemId, development] of developmentBySystem) {
      if (visibleSystemIds.has(systemId)) gated.set(systemId, development);
    }
    return gated;
  }, [developmentBySystem, visibleSystemIds]);

  // ── Price overlay control state (good picker + comparison panel) ──
  const [priceGoodId, setPriceGoodId] = useState<string | null>(null);
  const [priceMode, setPriceMode] = useState<"buy" | "sell">("buy");
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

  // Overlay live ownership (factionId + developed) onto the static atlas. The base atlas is fetched
  // once (staleTime:Infinity); ownership refetches on the monthly pulse, so a new liveAtlas identity
  // here is what drives the territory + marker layers to repaint expansion. Falls back to the atlas
  // as-is before ownership has loaded.
  const liveAtlas = useMemo((): AtlasData => {
    if (ownership.size === 0) return atlas;
    return {
      ...atlas,
      systems: atlas.systems.map((as) => {
        const own = ownership.get(as.id);
        return own ? { ...as, factionId: own.factionId, developed: own.developed } : as;
      }),
    };
  }, [atlas, ownership]);

  // Merge atlas (positions + live ownership) with static tile data (names + economy)
  const mergedSystems = useMemo((): StarSystemInfo[] => {
    const nameMap = new Map(
      tileSystems.map((s) => [s.id, s]),
    );
    return liveAtlas.systems.map((as) => {
      const tileData = nameMap.get(as.id);
      return {
        id: as.id,
        x: as.x,
        y: as.y,
        regionId: as.regionId,
        factionId: as.factionId,
        economyType: as.economyType,
        isGateway: as.isGateway,
        developed: as.developed,
        name: tileData?.name ?? "",
        description: "",
      };
    });
  }, [liveAtlas.systems, tileSystems]);

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

  // ── Base memos (stable across renders) ────────────────────────
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

  // ── Selection = the open /system/[id] panel route (single source of truth) ──
  const router = useRouter();
  const pathname = usePathname();
  const selectedSystemId = useMemo(() => {
    const match = /^\/system\/([^/]+)/.exec(pathname);
    return match ? decodeURIComponent(match[1]) : null;
  }, [pathname]);
  const selectedSystem = useMemo(
    () =>
      selectedSystemId
        ? universe.systems.find((s) => s.id === selectedSystemId) ?? null
        : null,
    [selectedSystemId, universe.systems],
  );

  // ── Derived map data ────────────────────────────────────────────
  const mapData = useMapData({
    universe,
    events,
    visibleSystemIds,
    dynamicSystems,
    logisticsEdges,
    selectedSystem,
    systemRegionMap,
    regionMap,
    priceHeatmap: heatmapData,
    priceMode,
  });

  // ── Click handlers — navigate by id; the panel loads its own detail ──
  const onSelectSystem = useCallback(
    (systemId: string) => {
      router.push(`/system/${systemId}`);
    },
    [router],
  );

  const onEmptyClick = useCallback(() => {
    router.push("/");
  }, [router]);

  // ── Initial camera + reveal ────────────────────────────────────
  // Center once on the system the map opened on (a /system/[id] deep-link or the
  // legacy ?systemId= param). Clicks never recenter — they only open the side
  // panel — so this is computed on mount only.
  type CenterTarget = { x: number; y: number; zoom: number };
  const [centerTarget] = useState<CenterTarget | undefined>(() => {
    const id = selectedSystemId ?? initialSelectedSystemId ?? null;
    if (!id) return undefined;
    const system = universe.systems.find((s) => s.id === id);
    return system ? { x: system.x, y: system.y, zoom: 1.2 } : undefined;
  });
  const [mapReady, setMapReadyState] = useState(() => centerTarget === undefined);

  // Migrate a legacy ?systemId= deep-link to the /system/[id] route so the panel
  // opens and the cell highlights. Mount-only.
  useEffect(() => {
    if (initialSelectedSystemId && !selectedSystemId) {
      router.replace(`/system/${initialSelectedSystemId}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleReady = useCallback(() => {
    setMapReadyState(true);
  }, []);

  return (
    <div className={`relative h-full w-full ${mapReady ? "opacity-100" : "opacity-0"}`}>
      <PixiMapCanvas
        atlasData={liveAtlas}
        mapData={mapData}
        selectedSystem={selectedSystem}
        onSelectSystem={onSelectSystem}
        onEmptyClick={onEmptyClick}
        centerTarget={centerTarget}
        onReady={handleReady}
        regionInfos={regionInfos}
        mapMode={mapMode}
        onViewportChange={onViewportChange}
        showEvents={overlays.events}
        stabilityBySystem={visibleStability}
        populationBySystem={visiblePopulation}
        developmentBySystem={visibleDevelopment}
      />

      {/* Zoom/LOD readout for tuning pixi/lod.ts thresholds — toggled via Dev Tools → Map. */}
      {showMapDebug && <MapZoomDebug zoom={zoom} />}

      {/* Price heatmap data fetcher — only mounts when overlay+good are active. */}
      {heatmapActive && priceGoodId && (
        <QueryBoundary loadingFallback={null}>
          <PriceHeatmapDataFetcher goodId={priceGoodId} onData={setHeatmapState} />
        </QueryBoundary>
      )}

      {/* Map controls dock (bottom-left) — main panel + floating Price panel */}
      <MapControlsDock
        mode={mapMode}
        setMode={setMapMode}
        overlays={overlays}
        toggle={toggle}
        priceGoodId={priceGoodId}
        setPriceGoodId={setPriceGoodId}
        goods={goods}
        onOpenComparisonTable={() => setComparisonOpen(true)}
        priceMode={priceMode}
        setPriceMode={setPriceMode}
      />

      {/* Cross-system price comparison panel (Price overlay) */}
      {comparisonOpen && priceGoodId && selectedSystem && (
        <MarketComparisonPanel
          goodId={priceGoodId}
          goodName={goods.find((g) => g.id === priceGoodId)?.name ?? priceGoodId}
          fromSystemId={selectedSystem.id}
          fromSystemName={selectedSystem.name}
          systems={systemsForComparison}
          connections={allConnections}
          onSelectSystem={(sysId) => {
            router.push(`/system/${sysId}`);
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
