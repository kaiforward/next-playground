import { Container, Graphics } from "pixi.js";
import type { ConnectionData } from "@/lib/hooks/use-map-data";
import { EDGE, SIZES } from "../theme";

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
  ) {
    // Style fingerprint: skip redraw when only style-relevant flags are unchanged
    // Positions are immutable (static tile data), so only style flags matter
    const fingerprint = `${data.isGateway}|${data.isRoute}|${data.isDimmed}`;
    if (this.connectionId === data.id && fingerprint === this.styleFingerprint) return;
    this.connectionId = data.id;
    this.styleFingerprint = fingerprint;

    this.line.clear();

    if (data.isGateway) {
      // Gateway trunk route — amber "lit pathway": a wide soft glow underlay
      // with a crisp core line stroked over it.
      for (const s of [EDGE.gatewayGlow, EDGE.gateway]) {
        this.line.moveTo(fromX, fromY);
        this.line.lineTo(toX, toY);
        this.line.stroke({ color: s.color, width: s.width, alpha: s.alpha });
      }
    } else if (data.isRoute) {
      // Solid line for the active route
      this.line.moveTo(fromX, fromY);
      this.line.lineTo(toX, toY);
      this.line.stroke({ color: EDGE.route.color, width: EDGE.route.width, alpha: EDGE.route.alpha });
    } else {
      // Dashed line for ordinary connections
      const style = data.isDimmed ? EDGE.dimmed : EDGE.default;
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
