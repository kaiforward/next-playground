import type { Application, FederatedPointerEvent } from "pixi.js";
import type { SystemCells } from "./voronoi-cache";
import { CAMERA } from "./theme";
import { findFactionAt } from "./faction-hit-test";
import { findLaneAt, resolveMapClick, type LaneHitTestLane, type LaneHitTestSystem } from "./lane-hit-test";
import { movedBeyond } from "./camera";
import type { MultiPolygon } from "./territory-utils";

interface InteractionCallbacks {
  onSelectSystem: (systemId: string) => void;
  onEmptyClick: () => void;
  onSelectFaction: (factionId: string) => void;
  onSelectLane: (laneKey: string) => void;
}

/** Per-cell hit-testing context for empty-space clicks. */
interface CellContext {
  cells: SystemCells | null;
  toWorld: (screenX: number, screenY: number) => { x: number; y: number };
}

/** Zoomed-out faction hit-testing context — a click on a faction's territory selects the faction
 *  instead of the individual system underneath it (see `selectActive`, gated on zoom). */
interface FactionContext {
  unions: Map<string, MultiPolygon> | null;
  selectActive: boolean;
}

/** Lane click hit-testing context (`lane-hit-test.ts`'s `findLaneAt`) — a lane is a segment between
 *  two system points, which no existing hit-test shape fits. */
interface LaneContext {
  lanes: LaneHitTestLane[];
  systemsById: ReadonlyMap<string, LaneHitTestSystem>;
  tolerance: number;
  /** World-unit gap shortened off each end of a lane's segment before the distance test — see
   *  `LANE_HIT_END_GAP_PX` (theme.ts). */
  endGap: number;
}

interface InteractionOptions {
  app: Application;
  getCallbacks: () => InteractionCallbacks;
  getCellContext: () => CellContext;
  getFactionContext: () => FactionContext;
  getLaneContext: () => LaneContext;
}

/**
 * Sets up stage-level interaction handlers for the map — click resolution and (elsewhere, in the
 * ticker) hover. Selection is the cell/lane, never the star: `SystemObject` takes no pointer events
 * at all, so there is nothing here to bind per-object. Returns a cleanup function.
 */
export function setupInteractions({
  app,
  getCallbacks,
  getCellContext,
  getFactionContext,
  getLaneContext,
}: InteractionOptions): () => void {
  // ── Stage selection (pointer-up, click vs drag) ───────────────
  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;

  // Selection resolves on pointer-UP, and only when the pointer barely moved between down and up. A
  // real drag (past CAMERA.clickDragThreshold) pans the camera — handled by Camera's own DOM
  // listeners — and must NOT also select, which is what made the clickable cells "swallow" pans.
  let downX = 0;
  let downY = 0;
  let downRecorded = false;
  const onStageDown = (e: FederatedPointerEvent) => {
    downX = e.global.x;
    downY = e.global.y;
    downRecorded = true;
  };

  const onStageUp = (e: FederatedPointerEvent) => {
    // Only resolve a click for a pointerup that had its own pointerdown on the stage. Without one
    // (a gesture begun over an overlay, dragged onto the canvas) the down coords are stale, so skip
    // rather than measure travel from a bogus origin.
    const hadDown = downRecorded;
    downRecorded = false;
    if (!hadDown) return;
    if (movedBeyond(downX, downY, e.global.x, e.global.y, CAMERA.clickDragThreshold)) return;

    const { onSelectSystem, onEmptyClick, onSelectFaction, onSelectLane } = getCallbacks();
    const { cells, toWorld } = getCellContext();
    const w = toWorld(e.global.x, e.global.y);

    // Precedence (docs/active/engineering/map-rendering.md → Selection precedence):
    //   1. faction (zoomed out, on a faction's territory)
    //   2. lane, when the point is within tolerance of a lane segment (its own end gap already
    //      spares the star, so no separate star-radius step is needed)
    //   3. system, via the ordinary Voronoi cell hit-test
    //   4. empty
    const { unions, selectActive } = getFactionContext();
    const factionHit = selectActive && unions ? findFactionAt(unions, w.x, w.y) : null;

    const { lanes, systemsById, tolerance, endGap } = getLaneContext();
    const laneAt = findLaneAt(w, lanes, systemsById, tolerance, endGap);
    const cellSystemId = cells ? cells.findSystemAt(w.x, w.y) : null;

    const result = resolveMapClick({ factionHit, laneAt, cellSystemId });
    switch (result.kind) {
      case "faction":
        onSelectFaction(result.factionId);
        return;
      case "system":
        onSelectSystem(result.systemId);
        return;
      case "lane":
        onSelectLane(result.laneKey);
        return;
      case "empty":
        onEmptyClick();
        return;
    }
  };
  app.stage.on("pointerdown", onStageDown);
  app.stage.on("pointerup", onStageUp);

  // ── Cleanup ───────────────────────────────────────────────────
  return () => {
    app.stage.off("pointerdown", onStageDown);
    app.stage.off("pointerup", onStageUp);
  };
}
