import { Container, Graphics } from "pixi.js";
import type { ConnectionData } from "@/lib/hooks/use-map-data";
import { LANE_MAJOR_GLOW, LANE_SELECTED, SIZES } from "../theme";
import { laneStyle } from "./lane-style";

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
    selected: boolean,
  ) {
    const style = laneStyle({
      fuelCost: data.fuelCost,
      level: data.level,
      load: data.load,
      blocked: data.blocked,
    });
    // Style fingerprint: skip redraw when only style-relevant flags are unchanged
    // Positions are immutable (static tile data), so only style flags matter
    const fingerprint = `${style.tier}:${style.width}:${style.color}:${selected}`;
    if (this.connectionId === data.id && fingerprint === this.styleFingerprint) return;
    this.connectionId = data.id;
    this.styleFingerprint = fingerprint;

    this.line.clear();

    if (selected) {
      // Selected lane (the open `/lane/:key` route) — a copper glow underlay, same treatment as the
      // major-tier "lit pathway" but always drawn regardless of fuel tier.
      this.line.moveTo(fromX, fromY);
      this.line.lineTo(toX, toY);
      this.line.stroke({ color: LANE_SELECTED.color, width: LANE_SELECTED.glowWidth, alpha: LANE_SELECTED.glowAlpha });
    }

    if (style.tier === "major") {
      // Crossing-priced lane — amber "lit pathway": a wide soft glow underlay
      // with a crisp core line stroked over it.
      this.line.moveTo(fromX, fromY);
      this.line.lineTo(toX, toY);
      this.line.stroke({ color: style.color, width: LANE_MAJOR_GLOW.width, alpha: LANE_MAJOR_GLOW.alpha });
      this.line.moveTo(fromX, fromY);
      this.line.lineTo(toX, toY);
      this.line.stroke({ color: style.color, width: style.width, alpha: style.alpha });
    } else {
      // Dashed line for ordinary and notable connections — colour and weight track load/level.
      drawDashedLine(this.line, fromX, fromY, toX, toY, style.color, style.alpha, style.width);
    }
  }
}

function drawDashedLine(
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
