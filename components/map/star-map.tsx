"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { AtlasData, UniverseData, StarSystemInfo } from "@/lib/types/game";
import { MapControlsDock } from "@/components/map/map-controls-dock";
import { MapZoomDebug } from "@/components/map/map-zoom-debug";
import { useDevOverlay } from "@/components/dev-tools/dev-overlay-context";
import { PixiMapCanvas } from "@/components/map/pixi/pixi-map-canvas";
import { useMapData } from "@/lib/hooks/use-map-data";
import { useMapMode } from "@/lib/hooks/use-map-mode";
import { useMapOverlays } from "@/lib/hooks/use-map-overlays";
import { useStaticTiles } from "@/lib/hooks/use-static-tiles";
import { useVisibility } from "@/lib/hooks/use-visibility";
import { useOwnership } from "@/lib/hooks/use-ownership";
import { useTradeFlow } from "@/lib/hooks/use-trade-flow";
import { useStability } from "@/lib/hooks/use-stability";
import { usePopulation } from "@/lib/hooks/use-population";
import { useDevelopment } from "@/lib/hooks/use-development";
import { useMigration } from "@/lib/hooks/use-migration";
import { buildSystemRegionMap } from "@/lib/utils/region";
import { resolveCarriedSegment } from "@/components/map/segment-carry";

/** Default zoom the camera settles at when focusing/centring on a location. */
const FOCUS_ZOOM = 1.2;

type CenterTarget = { x: number; y: number; zoom: number };

/** Parse a `?focus=<x>,<y>[,<zoom>]` param into a camera target, or null if absent/malformed. */
function parseFocusParam(raw: string | null): CenterTarget | null {
  if (!raw) return null;
  const [x, y, z] = raw.split(",", 3).map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y, zoom: Number.isFinite(z) && z > 0 ? z : FOCUS_ZOOM };
}

interface StarMapProps {
  atlas: AtlasData;
  initialSelectedSystemId?: string;
}

export function StarMap({
  atlas,
  initialSelectedSystemId,
}: StarMapProps) {
  // ── Progressive data loading ────────────────────────────────────
  const { systems: tileSystems, onViewportChange, zoom } = useStaticTiles(
    atlas.meta.mapSize,
  );
  const { showMapDebug } = useDevOverlay();
  const { visibleSystemIds } = useVisibility();
  // Live ownership (faction + developed tier) — tick-invalidated on the monthly claim/develop pulse.
  // Overlaid onto the static atlas so territory + markers repaint as factions expand (the atlas itself
  // stays staleTime:Infinity — only ownership rides the dynamic path).
  const ownership = useOwnership();

  // ── Map mode (single-select tint) + additive overlay toggles ──
  const { mode: mapMode, setMode: setMapMode } = useMapMode();
  const { overlays, toggle } = useMapOverlays();
  const { logisticsEdges } = useTradeFlow(overlays.logistics);
  const stabilityBySystem = useStability(mapMode === "stability");
  // Population is fetched for its own choropleth AND as the weights for stability's population-weighted
  // aggregation (so a faction's stability number tracks its people, not its raw system count).
  const populationBySystem = usePopulation(mapMode === "population" || mapMode === "stability");
  const developmentBySystem = useDevelopment(mapMode === "development");
  const migrationBySystem = useMigration(mapMode === "migration");

  // Stability is dynamic "story" state, so fog-of-war applies: only tint systems
  // the player can currently sense. We store STABILITY (1 − unrest), not raw unrest,
  // so the fill AND its number both read "higher = more stable" (bright/high number =
  // calm). Gated on the live `developed` flag too: an undeveloped system has no
  // population, so its unrest is a hollow 0 that would invert to "fully stable" (bright
  // cyan) — instead it must read as absent (black), like population/development.
  const visibleStability = useMemo(() => {
    const gated = new Map<string, number>();
    for (const [systemId, unrest] of stabilityBySystem) {
      if (visibleSystemIds.has(systemId) && ownership.get(systemId)?.developed) {
        gated.set(systemId, 1 - unrest);
      }
    }
    return gated;
  }, [stabilityBySystem, visibleSystemIds, ownership]);

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

  // Migration is dynamic story state too — same fog gate. The developed-only gate
  // already lives in the service (`getMigrationBySystem` returns developed systems
  // only), so this memo applies just the fog restriction, like population/development.
  const visibleMigration = useMemo(() => {
    const gated = new Map<string, number>();
    for (const [systemId, attraction] of migrationBySystem) {
      if (visibleSystemIds.has(systemId)) gated.set(systemId, attraction);
    }
    return gated;
  }, [migrationBySystem, visibleSystemIds]);

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
        sunClass: as.sunClass,
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

  // ── Selection = the open /system/[id] panel route (single source of truth) ──
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedSystemId = useMemo(() => {
    const match = /^\/system\/([^/]+)/.exec(pathname);
    return match ? decodeURIComponent(match[1]) : null;
  }, [pathname]);
  // ── Faction focus = the open /factions/[id] panel route ──
  // Zoom-gated in the value-choropleth layer: re-normalises pop/development to this faction and
  // de-emphasises the rest; stability dims but never rescales (see ValueChoroplethLayer.setScope).
  const selectedFactionId = useMemo(() => {
    const match = /^\/factions\/([^/]+)/.exec(pathname);
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
    visibleSystemIds,
    logisticsEdges,
    selectedSystem,
    systemRegionMap,
    regionMap,
  });

  // ── Click handlers — navigate by id; the panel loads its own detail ──
  // Preserves the currently open sub-tab (e.g. /system/<id>/industry) onto the newly selected
  // system, so picking a different system on the map doesn't bounce the drawer back to Overview.
  // Astrography is always visible regardless of developed tier, so it carries over unconditionally;
  // any other sub-tab only carries over if the TARGET system is developed (undeveloped systems only
  // show Overview + Astrography — see the same gate in @panel/system/layout.tsx), else falls back
  // to the base path.
  const onSelectSystem = useCallback(
    (systemId: string) => {
      const isDeveloped = ownership.get(systemId)?.developed ?? true;
      const segment = resolveCarriedSegment(pathname, isDeveloped);
      const path = segment ? `/system/${systemId}/${segment}` : `/system/${systemId}`;
      router.push(path);
    },
    [router, pathname, ownership],
  );

  const onEmptyClick = useCallback(() => {
    router.push("/");
  }, [router]);

  // Zoomed-out click on a faction's territory — opens the faction panel, which re-normalises the
  // value scope to it (see selectedFactionId above / ValueChoroplethLayer.setScope).
  const onSelectFaction = useCallback(
    (factionId: string) => {
      router.push(`/factions/${factionId}`);
    },
    [router],
  );

  // ── Camera focus target (generic: centre the map on any location) ──────
  // Anything can "locate on the map" by linking to the query:
  //   ?focus=<x>,<y>[,<zoom>]  — centre on raw world coordinates (a system, a fleet, an event,
  //                              a battle — the caller supplies coords; the map is entity-agnostic)
  //   ?systemId=<id>           — convenience: resolve a system to its coordinates
  // This is independent of selection (the open /system/[id] panel): a focus link never opens the
  // panel, and a click (which routes to /system/[id], touching neither param) never recentres.
  const resolveSystemTarget = useCallback(
    (id: string | null | undefined): CenterTarget | null => {
      const system = id ? universe.systems.find((s) => s.id === id) : undefined;
      return system ? { x: system.x, y: system.y, zoom: FOCUS_ZOOM } : null;
    },
    [universe.systems],
  );

  // Initial centre — computed once from ?focus, then ?systemId, then the pathname system (a
  // /system/[id] deep-link).
  const [centerTarget, setCenterTarget] = useState<CenterTarget | undefined>(
    () =>
      parseFocusParam(searchParams.get("focus")) ??
      resolveSystemTarget(
        searchParams.get("systemId") ?? initialSelectedSystemId ?? selectedSystemId,
      ) ??
      undefined,
  );

  // Hide the map until the first centre settles so a deep-link/focus doesn't flash the fitView.
  const [mapReady, setMapReadyState] = useState(() => centerTarget === undefined);

  // Post-mount "locate on the map": recentre when the ?focus / ?systemId query changes (a "Show on
  // Map" jump or any future locate action). Adjusted during render — the React idiom for resetting
  // state on an input change — and keyed on the query string, so a per-tick atlas refresh (which
  // churns universe.systems) never recentres, and a click (which changes only the pathname, not
  // these params) never recentres. Leaving centerTarget untouched keeps its reference stable, so
  // the canvas's centre effect no-ops on ticks. `loc` is a monotonic click-nonce a locate action
  // bumps so re-locating to the SAME coordinates (unchanged ?focus) still re-fires the recentre.
  const focusKey = `${searchParams.get("focus") ?? ""}|${searchParams.get("loc") ?? ""}|${initialSelectedSystemId ?? ""}`;
  const [appliedFocusKey, setAppliedFocusKey] = useState(focusKey);
  if (focusKey !== appliedFocusKey) {
    setAppliedFocusKey(focusKey);
    const target =
      parseFocusParam(searchParams.get("focus")) ?? resolveSystemTarget(initialSelectedSystemId);
    if (target) setCenterTarget(target);
  }

  const handleReady = useCallback(() => {
    setMapReadyState(true);
  }, []);

  // ── Camera recenter offset — clear the docked drawer ────────────
  // The drawer renders for any non-root panel route (root "/" shows no panel — see selectedSystemId /
  // selectedFactionId above). When docked, shift the centerTarget point right so a focused system
  // lands in the visible ~70% of the viewport instead of under the drawer (EU5/Vic3 behaviour). Width
  // must track detail-panel.tsx's `w-[clamp(400px,30vw,560px)]` — no shared constant across the CSS
  // class and this JS value, so keep them in sync by hand if that clamp changes. Plain consts (not
  // memoised) so a live resize self-corrects on the next render; the value stays numerically stable
  // when nothing changed, so it won't spuriously re-fire the centerTarget effect.
  const drawerDocked = pathname !== "/";
  const drawerWidthPx =
    drawerDocked && typeof window !== "undefined"
      ? Math.min(560, Math.max(400, 0.3 * window.innerWidth))
      : 0;
  const centerOffsetX = drawerWidthPx / 2;

  return (
    <div className={`relative h-full w-full ${mapReady ? "opacity-100" : "opacity-0"}`}>
      <PixiMapCanvas
        atlasData={liveAtlas}
        mapData={mapData}
        selectedSystem={selectedSystem}
        onSelectSystem={onSelectSystem}
        onEmptyClick={onEmptyClick}
        onSelectFaction={onSelectFaction}
        centerTarget={centerTarget}
        centerOffsetX={centerOffsetX}
        onReady={handleReady}
        regionInfos={regionInfos}
        mapMode={mapMode}
        onViewportChange={onViewportChange}
        stabilityBySystem={visibleStability}
        populationBySystem={visiblePopulation}
        developmentBySystem={visibleDevelopment}
        migrationBySystem={visibleMigration}
        selectedFactionId={selectedFactionId}
      />

      {/* Zoom/LOD readout for tuning pixi/lod.ts thresholds — toggled via Dev Tools → Map. */}
      {showMapDebug && <MapZoomDebug zoom={zoom} />}

      {/* Map controls dock (bottom-right) */}
      <MapControlsDock
        mode={mapMode}
        setMode={setMapMode}
        overlays={overlays}
        toggle={toggle}
      />
    </div>
  );
}
