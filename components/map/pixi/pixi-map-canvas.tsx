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
import { FleetDotLayer } from "./layers/fleet-dot-layer";
import { EffectLayer } from "./layers/effect-layer";
import { setupInteractions } from "./interactions";
import { BG_COLOR } from "./theme";
import type { MapData } from "@/lib/hooks/use-map-data";
import type { StarSystemInfo, AtlasData } from "@/lib/types/game";
import type { NavigationMode } from "@/lib/hooks/use-navigation-state";
import type { ViewportBounds } from "@/lib/types/game";

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
  onViewportChange?: (bounds: ViewportBounds, zoom: number) => void;
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
  fleetDotLayer: FleetDotLayer;
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
  onViewportChange,
}: PixiMapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pixiRef = useRef<PixiRefs | null>(null);
  const readyFired = useRef(false);

  // Store callbacks in refs so Pixi event handlers always see latest
  const callbacksRef = useRef({ onSystemClick, onEmptyClick });
  callbacksRef.current = { onSystemClick, onEmptyClick };

  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;

  // Store previous viewport state to skip no-op callbacks (avoids 60 setTimeout/clearTimeout per sec)
  const lastViewportRef = useRef({ minX: 0, minY: 0, maxX: 0, maxY: 0, zoom: 0 });

  // Debug zoom display
  const zoomLabelRef = useRef<HTMLDivElement>(null);

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
      if (!(app.canvas instanceof HTMLCanvasElement)) return;
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

      const territoryLayer = new TerritoryLayer();
      world.addChild(territoryLayer.container);

      const fleetDotLayer = new FleetDotLayer();
      world.addChild(fleetDotLayer.container);

      const systemLayer = new SystemLayer();
      world.addChild(systemLayer.container);

      const effectLayer = new EffectLayer();
      world.addChild(effectLayer.container);

      // Setup interactions
      interactionCleanup = setupInteractions({
        app,
        systemLayer,
        getCallbacks: () => callbacksRef.current,
        getMapData: () => mapDataRef.current,
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
        frustum.update(camera.x, camera.y, camera.zoom, app!.screen.width, app!.screen.height);
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
        fleetDotLayer.updateVisibility(lod);

        // Effect layer visibility based on LOD
        effectLayer.container.visible = lod.showEffects;

        const isZooming = Math.abs(camera.zoom - prevZoom) > 0.0005;
        prevZoom = camera.zoom;

        // Debug: show zoom level (direct DOM write, no React render)
        const zl = zoomLabelRef.current;
        if (zl) zl.textContent = `zoom: ${camera.zoom.toFixed(3)}`;

        starfield.update(camera.x, camera.y, dtMs, isZooming);
        if (lod.showEffects) effectLayer.update(dtMs);
      });

      // Store refs and signal ready
      pixiRef.current = {
        app, camera, frustum, world, starfield,
        pointCloudLayer, systemLayer, connectionLayer, territoryLayer,
        fleetDotLayer, effectLayer,
      };
      setPixiReady(true);
    })();

    return () => {
      destroyed = true;
      interactionCleanup?.();
      if (app) {
        app.renderer.off("resize", onResize);
        if (canvas) camera.detach(canvas);
        // Destroy point cloud first to free its standalone dotTexture
        pixiRef.current?.pointCloudLayer.destroy();
        pixiRef.current?.fleetDotLayer.destroy();
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
  }, [atlasData.systems, pixiReady, regionInfos]);

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
    const routePath = navigationMode.phase === "route_preview" ? navigationMode.route.path : undefined;
    p.effectLayer.syncRoute(mapData.connections, mapData.systems, routePath);
    p.effectLayer.syncPulseRings(mapData.systems, navigationMode.phase === "default");
  }, [mapData, selectedSystem, navigationMode, pixiReady]);

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
    <>
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ touchAction: "none" }}
      />
      <div
        ref={zoomLabelRef}
        className="absolute bottom-2 left-2 z-50 rounded bg-black/70 px-2 py-1 font-mono text-xs text-white/80"
      >
        zoom: —
      </div>
    </>
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
