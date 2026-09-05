import { Container, Graphics } from "pixi.js";
import type { ConnectionData } from "@/lib/hooks/use-map-data";
import { LANE_BASE_ALPHA, LANE_BASE_COLOR, LANE_HOVERED, LANE_SELECTED, SIZES } from "../theme";
import { laneStyle } from "./lane-style";

/** Interaction state a `ConnectionObject` draws on top of its base style — orthogonal to the lane's
 *  own data (fuel cost, level), so it doesn't perturb the base style's dirty-check. */
export interface ConnectionState {
  selected: boolean;
  hovered: boolean;
}

export class ConnectionObject extends Container {
  connectionId = "";
  private line: Graphics;
  /** Style fingerprint for dirty-checking (positions are immutable from static tiles) */
  private styleFingerprint = "";

  constructor() {
    super();

    this.line = new Graphics();
    this.addChild(this.line);
  }

  update(
    data: ConnectionData,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    state: ConnectionState,
  ) {
    const style = laneStyle({ fuelCost: data.fuelCost, level: data.level });
    // Style fingerprint: skip redraw when only style-relevant flags are unchanged
    // Positions are immutable (static tile data), so only style flags matter
    const fingerprint = `${style.width}:${state.selected}:${state.hovered}`;
    if (this.connectionId === data.id && fingerprint === this.styleFingerprint) return;
    this.connectionId = data.id;
    this.styleFingerprint = fingerprint;

    this.line.clear();

    if (state.selected) {
      // Selected lane (the open `/lane/:key` route) — a copper glow underlay.
      this.line.moveTo(fromX, fromY);
      this.line.lineTo(toX, toY);
      this.line.stroke({ color: LANE_SELECTED.color, width: LANE_SELECTED.glowWidth, alpha: LANE_SELECTED.glowAlpha });
    }

    if (state.hovered) {
      // Hovered lane — a fainter, narrower white glow underlay, distinct from selection.
      this.line.moveTo(fromX, fromY);
      this.line.lineTo(toX, toY);
      this.line.stroke({ color: LANE_HOVERED.color, width: LANE_HOVERED.glowWidth, alpha: LANE_HOVERED.glowAlpha });
    }

    // The base layer itself: one solid slate stroke, no colour or dashes — those belong to the
    // Lanes map mode.
    this.line.moveTo(fromX, fromY);
    this.line.lineTo(toX, toY);
    this.line.stroke({ color: LANE_BASE_COLOR, width: style.width, alpha: LANE_BASE_ALPHA });
  }
}

/** Stroke a dashed segment between two points — unused by the base layer (which draws solid), kept
 *  for the Lanes map mode's "no investor" treatment. */
export function drawDashedLine(
  gfx: Graphics,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: number,
  alpha: number,
  width: number,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return;

  const dashLen = SIZES.dashLength;
  const gapLen = SIZES.dashGap;
  const stepLen = dashLen + gapLen;
  const nx = dx / len;
  const ny = dy / len;

  let dist = 0;
  while (dist < len) {
    const segEnd = Math.min(dist + dashLen, len);
    gfx.moveTo(x1 + nx * dist, y1 + ny * dist);
    gfx.lineTo(x1 + nx * segEnd, y1 + ny * segEnd);
    dist += stepLen;
  }
  gfx.stroke({ color, width, alpha });
}
