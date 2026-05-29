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
import { FleetDotLayer } from "./layers/fleet-dot-layer";
import { TradeFlowLayer } from "./layers/trade-flow-layer";
import { EffectLayer } from "./layers/effect-layer";
import { FleetTransitLayer } from "./layers/fleet-transit-layer";
import { setupInteractions } from "./interactions";
import { BG_COLOR } from "./theme";
import type { MapData } from "@/lib/hooks/use-map-data";
import type { ConnectionInfo } from "@/lib/engine/navigation";
import type { StarSystemInfo, AtlasData } from "@/lib/types/game";
import type { NavigationMode } from "@/lib/hooks/use-navigation-state";
import type { ViewportBounds } from "@/lib/types/game";
import type { MapMode } from "@/lib/types/map";

export interface PixiMapCanvasProps {
  atlasData: AtlasData;
  mapData: MapData;
  selectedSystem: StarSystemInfo | null;
  navigationMode: NavigationMode;
  onSystemClick: (system: StarSystemInfo) => void;
  onEmptyClick: () => void;
  centerTarget?: { x: number; y: number; zoom: number };
  onReady: () => void;
  regionInfos: { id: string; name: string }[];
  /**
   * Which territory tint to paint. `political` shows faction colours,
   * `regions` shows economy colours, `none` hides both layers.
   */
  mapMode?: MapMode;
  onViewportChange?: (bounds: ViewportBounds, zoom: number) => void;
  connections: ConnectionInfo[];
  currentTick: number;
  showShipRoutes: boolean;
  selectedTransitId: string | null;
  onTransitClick: (unitId: string | null) => void;
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
  fleetDotLayer: FleetDotLayer;
  tradeFlowLayer: TradeFlowLayer;
  fleetTransitLayer: FleetTransitLayer;
  effectLayer: EffectLayer;
}

export function PixiMapCanvas({
  atlasData,
  mapData,
  selectedSystem,
  navigationMode,
  onSystemClick,
  onEmptyClick,
  centerTarget,
  onReady,
  regionInfos,
  mapMode = "political",
  onViewportChange,
  connections,
  currentTick,
  showShipRoutes,
  selectedTransitId,
  onTransitClick,
}: PixiMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pixiRef = useRef<PixiRefs | null>(null);
  const readyFired = useRef(false);

  // Store callbacks in refs so Pixi event handlers always see latest
  const callbacksRef = useRef({ onSystemClick, onEmptyClick });
  callbacksRef.current = { onSystemClick, onEmptyClick };

  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;

  const onTransitClickRef = useRef(onTransitClick);
  onTransitClickRef.current = onTransitClick;

  const currentTickRef = useRef(currentTick);
  currentTickRef.current = currentTick;

  // Store previous viewport state to skip no-op callbacks (avoids 60 setTimeout/clearTimeout per sec)
  const lastViewportRef = useRef({ minX: 0, minY: 0, maxX: 0, maxY: 0, zoom: 0 });

  // Store latest data in ref for interaction handlers
  const mapDataRef = useRef(mapData);
  mapDataRef.current = mapData;

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

      // Trade-flow particles render between connections and territories so
      // they sit on top of the static graph but below region fills/labels.
      const tradeFlowLayer = new TradeFlowLayer();
      world.addChild(tradeFlowLayer.container);

      const territoryLayer = new TerritoryLayer();
      world.addChild(territoryLayer.container);

      // Political layer sits above the economy territory layer but below the
      // fleet dots. Both layers receive sync data; only one is visible at a
      // time (controlled via `politicalOverlay` prop / setActive()).
      const politicalTerritoryLayer = new PoliticalTerritoryLayer();
      world.addChild(politicalTerritoryLayer.container);

      const fleetDotLayer = new FleetDotLayer();
      world.addChild(fleetDotLayer.container);

      const systemLayer = new SystemLayer();
      world.addChild(systemLayer.container);

      // Fleet transit markers + routes sit above system glyphs but below the
      // navigation effect layer. Price now renders inside the system glyph
      // (halo lens + top-right pill), so there's no standalone price layer.
      const fleetTransitLayer = new FleetTransitLayer();
      world.addChild(fleetTransitLayer.container);

      const effectLayer = new EffectLayer();
      world.addChild(effectLayer.container);

      // Setup interactions
      interactionCleanup = setupInteractions({
        app,
        systemLayer,
        getCallbacks: () => callbacksRef.current,
        getMapData: () => mapDataRef.current,
      });

      fleetTransitLayer.setOnClick((id) => onTransitClickRef.current(id));

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
        fleetDotLayer.updateVisibility(lod);

        // Trade-flow overlay: layer alpha multiplies the system fade so the
        // overlay disappears alongside its host systems at universe zoom.
        tradeFlowLayer.updateVisibility(frustum, lod, lod.systemLayerAlpha);
        if (tradeFlowLayer.container.visible) tradeFlowLayer.update(dtMs);

        // Fleet transit markers — always-on across zoom levels
        fleetTransitLayer.setTick(currentTickRef.current);
        fleetTransitLayer.update(dtMs, camera.zoom, frustum);
        fleetTransitLayer.updateVisibility(1);

        // Effect layer visibility based on LOD
        effectLayer.container.visible = lod.showEffects;

        const isZooming = Math.abs(camera.zoom - prevZoom) > 0.0005;
        prevZoom = camera.zoom;

        starfield.update(camera.x, camera.y, dtMs, isZooming);
        if (lod.showEffects) effectLayer.update(dtMs);
      });

      // Store refs and signal ready
      pixiRef.current = {
        app, camera, frustum, world, starfield,
        pointCloudLayer, systemLayer, connectionLayer, territoryLayer,
        politicalTerritoryLayer, fleetDotLayer, tradeFlowLayer,
        fleetTransitLayer, effectLayer,
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
          refs.tradeFlowLayer.destroy();
          refs.fleetTransitLayer.destroy();
          refs.effectLayer.destroy();
          refs.starfield.destroy();
          refs.pointCloudLayer.destroy();
          refs.fleetDotLayer.destroy();
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

    p.territoryLayer.sync(atlasData.systems, regionInfos);
    p.politicalTerritoryLayer.sync(atlasData.systems, atlasData.factions);
  }, [atlasData.systems, atlasData.factions, pixiReady, regionInfos]);

  // ── Toggle which territory layer is visible ────────────────────────
  // Three modes: "political" shows the faction layer, "regions" shows the
  // economy layer, "none" hides both. Per-frame LOD logic still runs on the
  // hidden layers (cheap) so swapping back is instant.
  useEffect(() => {
    const p = pixiRef.current;
    if (!p || !pixiReady) return;
    p.territoryLayer.container.visible = mapMode === "regions";
    p.politicalTerritoryLayer.setActive(mapMode === "political");
  }, [mapMode, pixiReady]);

  // ── Update player presence highlights (lightweight fill-only redraw) ──
  useEffect(() => {
    const p = pixiRef.current;
    if (!p || !pixiReady) return;

    const playerRegionIds = new Set<string>();
    for (const sys of mapData.systems) {
      if (sys.shipCount > 0) {
        playerRegionIds.add(sys.regionId);
      }
    }
    p.territoryLayer.setPlayerPresence(playerRegionIds);
  }, [mapData.systems, pixiReady]);

  // ── Sync fleet presence dots (systems with ships) ──────────────────
  useEffect(() => {
    const p = pixiRef.current;
    if (!p || !pixiReady) return;

    const shipPositions = mapData.systems
      .filter((s) => s.shipCount > 0)
      .map((s) => ({ x: s.x, y: s.y }));
    p.fleetDotLayer.sync(shipPositions);
  }, [mapData.systems, pixiReady]);

  // ── Sync map data → system objects + connections ──────────────────
  useEffect(() => {
    const p = pixiRef.current;
    if (!p || !pixiReady) return;

    // System objects and connections driven by mapData (viewport detail)
    p.systemLayer.sync(mapData.systems, selectedSystem?.id ?? null);
    p.connectionLayer.sync(mapData.connections, mapData.systems);
    p.tradeFlowLayer.sync(mapData.systems, mapData.flowEdges);
    const routePath = navigationMode.phase === "route_preview" ? navigationMode.route.path : undefined;
    p.effectLayer.syncRoute(mapData.connections, mapData.systems, routePath);

    const transitPositions = new Map(mapData.systems.map((s) => [s.id, { x: s.x, y: s.y }]));
    p.fleetTransitLayer.sync(mapData.transitUnits, transitPositions, connections);
  }, [mapData, selectedSystem, navigationMode, pixiReady, connections]);

  // ── Propagate transit selection / route overlay (cheap setters only) ──
  // Kept separate from the data sync above so toggling selection or the
  // ship-routes overlay doesn't re-run every layer's sync().
  useEffect(() => {
    const p = pixiRef.current;
    if (!p || !pixiReady) return;
    p.fleetTransitLayer.setSelected(selectedTransitId);
    p.fleetTransitLayer.setShowAllRoutes(showShipRoutes);
  }, [selectedTransitId, showShipRoutes, pixiReady]);

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
