"use client";

import { useEffect, useRef, useState } from "react";
import { Application, Container } from "pixi.js";
import { Camera } from "./camera";
import { Frustum } from "./frustum";
import { computeLOD } from "./lod";
import { StarfieldLayer } from "./layers/starfield-layer";
import { PointCloudLayer } from "./layers/point-cloud-layer";
import { SystemLayer } from "./layers/system-layer";
import { ConnectionLayer } from "./layers/connection-layer";
import { TerritoryLayer } from "./layers/territory-layer";
import { PoliticalTerritoryLayer } from "./layers/political-territory-layer";
import { ValueChoroplethLayer } from "./layers/value-choropleth-layer";
import { TradeFlowLayer, LOGISTICS_FLOW_CONFIG } from "./layers/trade-flow-layer";
import { setupInteractions } from "./interactions";
import { BG_COLOR } from "./theme";
import { buildSystemCells, type SystemCells } from "./voronoi-cache";
import type { MapData } from "@/lib/hooks/use-map-data";
import type { StarSystemInfo, AtlasData } from "@/lib/types/game";
import type { ViewportBounds } from "@/lib/types/game";
import { isValueMapMode, type MapMode } from "@/lib/types/map";

/** Shared empty map for value-choropleth modes with no data yet (avoids a fresh Map per render). */
const EMPTY = new Map<string, number>();

export interface PixiMapCanvasProps {
  atlasData: AtlasData;
  mapData: MapData;
  selectedSystem: StarSystemInfo | null;
  onSelectSystem: (systemId: string) => void;
  onEmptyClick: () => void;
  centerTarget?: { x: number; y: number; zoom: number };
  onReady: () => void;
  regionInfos: { id: string; name: string }[];
  /**
   * Which territory layer to paint. `political` shows faction colours,
   * `regions` shows neutral region border outlines, `none` hides all
   * territory layers.
   */
  mapMode?: MapMode;
  onViewportChange?: (bounds: ViewportBounds, zoom: number) => void;
  /** Ambient display of the event pill (still reveals on hover/select). */
  showEvents: boolean;
  /** Per-system unrest (0…1) for the stability choropleth, or empty when mode is off. */
  stabilityBySystem?: Map<string, number>;
  /** Per-system population for the population choropleth, or empty when mode is off. */
  populationBySystem?: Map<string, number>;
  /** Per-system development (0..1) for the development choropleth, or empty when mode is off. */
  developmentBySystem?: Map<string, number>;
}

/** Holds all mutable Pixi references. Created once during mount. */
interface PixiRefs {
  app: Application;
  camera: Camera;
  frustum: Frustum;
  world: Container;
  starfield: StarfieldLayer;
  pointCloudLayer: PointCloudLayer;
  systemLayer: SystemLayer;
  connectionLayer: ConnectionLayer;
  territoryLayer: TerritoryLayer;
  politicalTerritoryLayer: PoliticalTerritoryLayer;
  valueChoroplethLayer: ValueChoroplethLayer;
  logisticsFlowLayer: TradeFlowLayer;
  /** Shared Voronoi cells (built once per atlas sync) — also consumed by value-mode click hit-testing. */
  cells: SystemCells | null;
}

export function PixiMapCanvas({
  atlasData,
  mapData,
  selectedSystem,
  onSelectSystem,
  onEmptyClick,
  centerTarget,
  onReady,
  regionInfos,
  mapMode = "political",
  onViewportChange,
  showEvents,
  stabilityBySystem,
  populationBySystem,
  developmentBySystem,
}: PixiMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pixiRef = useRef<PixiRefs | null>(null);
  const readyFired = useRef(false);

  // Store callbacks in refs so Pixi event handlers always see latest
  const callbacksRef = useRef({ onSelectSystem, onEmptyClick });
  callbacksRef.current = { onSelectSystem, onEmptyClick };

  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;

  // Store previous viewport state to skip no-op callbacks (avoids 60 setTimeout/clearTimeout per sec)
  const lastViewportRef = useRef({ minX: 0, minY: 0, maxX: 0, maxY: 0, zoom: 0 });

  // Signal to trigger data sync after Pixi is ready
  const [pixiReady, setPixiReady] = useState(false);

  // ── Mount: create Pixi application ──────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let app: Application | null = null;
    let canvas: HTMLCanvasElement | null = null;
    const camera = new Camera();
    const frustum = new Frustum();
    let destroyed = false;
    let interactionCleanup: (() => void) | undefined;
    let prevZoom = 0; // Track zoom delta to detect active zooming
    const onResize = (width: number, height: number) => {
      camera.setScreenSize(width, height);
    };

    (async () => {
      const pixi = new Application();
      await pixi.init({
        resizeTo: container,
        antialias: true,
        background: BG_COLOR,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      });

      if (destroyed) {
        pixi.destroy(true, { children: true });
        return;
      }

      app = pixi;
      // Runtime guard: Pixi may return OffscreenCanvas in WebWorker contexts.
      // Capture constructor name before instanceof narrows the type.
      const canvasTypeName = app.canvas.constructor.name;
      if (!(app.canvas instanceof HTMLCanvasElement)) {
        console.error("Unexpected canvas type:", canvasTypeName);
        return;
      }
      canvas = app.canvas;
      container.appendChild(canvas);
      camera.setScreenSize(app.screen.width, app.screen.height);
      camera.attach(canvas);

      // Create starfield (fixed to stage, not world — parallax is separate)
      const starfield = new StarfieldLayer();
      starfield.init(42);
      app.stage.addChild(starfield.container);

      // Create world container (all game objects)
      const world = new Container();
      app.stage.addChild(world);

      // Create layers in z-order (bottom to top)
      const pointCloudLayer = new PointCloudLayer();
      pointCloudLayer.init(app.renderer);
      world.addChild(pointCloudLayer.container);

      const connectionLayer = new ConnectionLayer();
      world.addChild(connectionLayer.container);

      // Logistics convoys render above the connection graph, below region
      // fills/labels.
      const logisticsFlowLayer = new TradeFlowLayer(LOGISTICS_FLOW_CONFIG);
      world.addChild(logisticsFlowLayer.container);

      const territoryLayer = new TerritoryLayer();
      world.addChild(territoryLayer.container);

      // Political layer sits above the regions territory layer. Both layers
      // receive sync data; only one is visible at a time (controlled via the
      // `mapMode` prop / setActive()).
      const politicalTerritoryLayer = new PoliticalTerritoryLayer();
      world.addChild(politicalTerritoryLayer.container);

      // Value choropleth — one shared-geometry layer for the three value
      // modes (stability/population/development). Fills + aggregated numbers
      // are redrawn from live values via setValues(); geometry is built once
      // in the territory-sync effect from the same Voronoi cells as the
      // other territory layers.
      const valueChoroplethLayer = new ValueChoroplethLayer();
      world.addChild(valueChoroplethLayer.container);

      const systemLayer = new SystemLayer();
      world.addChild(systemLayer.container);

      // Setup interactions
      interactionCleanup = setupInteractions({
        app,
        systemLayer,
        getCallbacks: () => callbacksRef.current,
        getCellContext: () => ({
          cells: pixiRef.current?.cells ?? null,
          toWorld: (screenX, screenY) => camera.screenToWorld(screenX, screenY),
        }),
      });

      // Keep camera screen size in sync with Pixi's own resize
      app.renderer.on("resize", onResize);

      // Main render loop
      app.ticker.add((ticker) => {
        const dtMs = ticker.deltaMS;
        camera.update(dtMs);

        const t = camera.getTransform();
        world.position.set(t.x, t.y);
        world.scale.set(t.scale);

        // Update frustum + LOD
        frustum.update(camera.x, camera.y, camera.zoom, pixi.screen.width, pixi.screen.height);
        const lod = computeLOD(camera.zoom);

        // Emit viewport bounds + zoom for tile-based data loading (only when changed)
        {
          const prev = lastViewportRef.current;
          const changed = frustum.minX !== prev.minX || frustum.minY !== prev.minY ||
            frustum.maxX !== prev.maxX || frustum.maxY !== prev.maxY ||
            camera.zoom !== prev.zoom;
          if (changed) {
            prev.minX = frustum.minX;
            prev.minY = frustum.minY;
            prev.maxX = frustum.maxX;
            prev.maxY = frustum.maxY;
            prev.zoom = camera.zoom;
            const cb = onViewportChangeRef.current;
            cb?.(
              { minX: frustum.minX, minY: frustum.minY, maxX: frustum.maxX, maxY: frustum.maxY },
              camera.zoom,
            );
          }
        }

        // Point cloud layer (universe view)
        pointCloudLayer.updateVisibility(lod.pointCloudAlpha);

        // System layer crossfade + lifecycle
        systemLayer.setActive(lod.systemObjectsActive);
        systemLayer.container.alpha = lod.systemLayerAlpha;
        if (lod.systemObjectsActive) {
          systemLayer.updateVisibility(frustum, lod);
        }

        // Connections follow system layer alpha
        connectionLayer.updateVisibility(frustum, lod, lod.systemLayerAlpha);

        territoryLayer.updateVisibility(lod);
        politicalTerritoryLayer.updateVisibility(lod);
        valueChoroplethLayer.updateVisibility(lod);
        if (valueChoroplethLayer.container.visible) valueChoroplethLayer.updateNumbers(camera.zoom, frustum);

        // Logistics overlay: layer alpha multiplies the system fade so the
        // overlay disappears alongside its host systems at universe zoom.
        logisticsFlowLayer.updateVisibility(frustum, lod, lod.systemLayerAlpha);
        if (logisticsFlowLayer.container.visible) logisticsFlowLayer.update(dtMs);

        const isZooming = Math.abs(camera.zoom - prevZoom) > 0.0005;
        prevZoom = camera.zoom;

        starfield.update(camera.x, camera.y, dtMs, isZooming);
      });

      // Store refs and signal ready
      pixiRef.current = {
        app, camera, frustum, world, starfield,
        pointCloudLayer, systemLayer, connectionLayer, territoryLayer,
        politicalTerritoryLayer, valueChoroplethLayer, logisticsFlowLayer,
        cells: null,
      };
      setPixiReady(true);
    })();

    return () => {
      destroyed = true;
      interactionCleanup?.();
      if (app) {
        app.renderer.off("resize", onResize);
        if (canvas) camera.detach(canvas);
        // Destroy layers to clear internal Maps and free JS-side references
        // that app.destroy({ children: true }) doesn't touch
        const refs = pixiRef.current;
        if (refs) {
          refs.systemLayer.destroy();
          refs.connectionLayer.destroy();
          refs.territoryLayer.destroy();
          refs.politicalTerritoryLayer.destroy();
          refs.valueChoroplethLayer.destroy();
          refs.logisticsFlowLayer.destroy();
          refs.starfield.destroy();
          refs.pointCloudLayer.destroy();
        }
        app.destroy(true, { children: true });
      }
      pixiRef.current = null;
      setPixiReady(false);
    };
    // Mount once only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync atlas data → point cloud + territories ──────────────────
  useEffect(() => {
    const p = pixiRef.current;
    if (!p || !pixiReady) return;

    // Point cloud driven by atlas (always available, lightweight)
    p.pointCloudLayer.sync(atlasData.systems);
  }, [atlasData.systems, pixiReady]);

  // ── Sync territories (expensive Voronoi — only on atlas/region changes) ──
  useEffect(() => {
    const p = pixiRef.current;
    if (!p || !pixiReady) return;

    const mapSize = atlasData.meta.mapSize;
    p.territoryLayer.sync(atlasData.systems, regionInfos, mapSize);
    p.politicalTerritoryLayer.sync(atlasData.systems, atlasData.factions, mapSize);

    // Shared Voronoi cells for the value choropleth — stashed on the ref so
    // value-mode click hit-testing can reuse the same geometry.
    const cells = buildSystemCells(atlasData.systems, mapSize);
    p.cells = cells;
    p.valueChoroplethLayer.sync(cells, atlasData.systems);
  }, [atlasData.systems, atlasData.factions, atlasData.meta.mapSize, pixiReady, regionInfos]);

  // ── Toggle which territory layer is visible ────────────────────────
  // Six modes: "political" shows the faction layer, "regions" shows the neutral
  // region border layer, "stability" shows the unrest choropleth, "population"
  // shows the population choropleth, "development" shows the development
  // choropleth, "none" hides all. Per-frame LOD logic still runs on the hidden
  // layers (cheap) so swapping is instant.
  useEffect(() => {
    const p = pixiRef.current;
    if (!p || !pixiReady) return;
    p.territoryLayer.container.visible = mapMode === "regions";
    p.politicalTerritoryLayer.setActive(mapMode === "political");
    p.valueChoroplethLayer.setActive(isValueMapMode(mapMode));
  }, [mapMode, pixiReady]);

  // ── Value choropleth fills (lightweight redraw on data change) ──────
  // One setter for all three value modes — the layer's ramp + aggregation
  // tiers are keyed off the `ValueMode` passed alongside the value map.
  // Phase 1: reference == value map (dev uses current-development max as its
  // v1 reference; potential lands in Phase 2).
  useEffect(() => {
    const p = pixiRef.current;
    if (!p || !pixiReady) return;
    if (mapMode === "population") {
      p.valueChoroplethLayer.setValues(populationBySystem ?? EMPTY, populationBySystem ?? EMPTY, "population");
    } else if (mapMode === "stability") {
      p.valueChoroplethLayer.setValues(stabilityBySystem ?? EMPTY, stabilityBySystem ?? EMPTY, "stability");
    } else if (mapMode === "development") {
      p.valueChoroplethLayer.setValues(developmentBySystem ?? EMPTY, developmentBySystem ?? EMPTY, "development");
    }
  }, [mapMode, stabilityBySystem, populationBySystem, developmentBySystem, pixiReady]);

  // ── Sync map data → system objects + connections ──────────────────
  useEffect(() => {
    const p = pixiRef.current;
    if (!p || !pixiReady) return;

    // System objects and connections driven by mapData (viewport detail)
    p.systemLayer.sync(mapData.systems, selectedSystem?.id ?? null);
    p.connectionLayer.sync(mapData.connections, mapData.systems);
    p.logisticsFlowLayer.sync(mapData.systems, mapData.logisticsFlowEdges);
  }, [mapData, selectedSystem, pixiReady]);

  // ── Propagate the events overlay flag to the system layer ──
  // Gates ambient display of the event pill. Cheap setter — kept out of the
  // data sync so toggling the overlay doesn't re-run every sync.
  useEffect(() => {
    const p = pixiRef.current;
    if (!p || !pixiReady) return;
    p.systemLayer.setOverlayVisibility({ events: showEvents });
  }, [showEvents, pixiReady]);

  // ── Initial fitView (only when no centerTarget) ────────────────
  useEffect(() => {
    const p = pixiRef.current;
    if (!p || !pixiReady || readyFired.current) return;
    if (atlasData.systems.length === 0) return;
    // When centerTarget is set, let the centerTarget effect handle centering + onReady
    if (centerTarget) return;

    const bounds = computeBounds(atlasData.systems);
    p.camera.fitView(bounds, undefined, 0);
    readyFired.current = true;
    onReady();
  }, [atlasData.systems, onReady, pixiReady, centerTarget]);

  // ── centerTarget (pan camera to system) ─────────────────────────
  const lastCenterRef = useRef<typeof centerTarget>(undefined);
  useEffect(() => {
    const p = pixiRef.current;
    if (!p || !pixiReady || !centerTarget) return;
    if (centerTarget === lastCenterRef.current) return;
    lastCenterRef.current = centerTarget;
    const isInitial = !readyFired.current;
    p.camera.setCenter(centerTarget.x, centerTarget.y, centerTarget.zoom, isInitial ? 0 : 400);
    if (isInitial) {
      readyFired.current = true;
      onReady();
    }
  }, [centerTarget, onReady, pixiReady]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ touchAction: "none" }}
    />
  );
}

// ── Helpers ────────────────────────────────────────────────────────

function computeBounds(items: { x: number; y: number }[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const item of items) {
    if (item.x < minX) minX = item.x;
    if (item.y < minY) minY = item.y;
    if (item.x > maxX) maxX = item.x;
    if (item.y > maxY) maxY = item.y;
  }
  return { minX, minY, maxX, maxY };
}
