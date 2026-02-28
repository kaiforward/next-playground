import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { ConnectionData } from "@/lib/hooks/use-map-data";
import { EDGE, SIZES, TEXT_COLORS, TEXT_RESOLUTION } from "../theme";

const FUEL_STYLE = new TextStyle({
  fontSize: SIZES.fuelLabelSize,
  fontFamily: "system-ui, -apple-system, sans-serif",
  align: "center",
});

export class ConnectionObject extends Container {
  connectionId = "";
  private line: Graphics;
  private labelBg: Graphics;
  private fuelLabel: Text;
  private isRegionConnection = false;

  constructor() {
    super();

    this.line = new Graphics();
    this.addChild(this.line);

    this.labelBg = new Graphics();
    this.addChild(this.labelBg);

    this.fuelLabel = new Text({ text: "", style: FUEL_STYLE, resolution: TEXT_RESOLUTION });
    this.fuelLabel.anchor.set(0.5, 0.5);
    this.addChild(this.fuelLabel);
  }

  update(
    data: ConnectionData,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    isRegion = false,
  ) {
    this.connectionId = data.id;
    this.isRegionConnection = isRegion;

    // Pick edge style
    const style = isRegion
      ? EDGE.region
      : data.isRoute
        ? EDGE.route
        : data.isDimmed
          ? EDGE.dimmed
          : EDGE.default;

    this.line.clear();

    if (data.isRoute || isRegion) {
      // Solid line for route and region connections
      this.line.moveTo(fromX, fromY);
      this.line.lineTo(toX, toY);
      this.line.stroke({ color: style.color, width: style.width, alpha: style.alpha });
    } else {
      // Dashed line
      drawDashedLine(this.line, fromX, fromY, toX, toY, style.color, style.alpha, style.width);
    }

    // Fuel label at midpoint (only for system connections)
    if (!isRegion && data.fuelCost > 0) {
      const mx = (fromX + toX) / 2;
      const my = (fromY + toY) / 2;

      this.fuelLabel.text = `${data.fuelCost} fuel`;
      this.fuelLabel.position.set(mx, my);
      this.fuelLabel.style.fill = data.isRoute ? 0x63b3ed : TEXT_COLORS.secondary;
      this.fuelLabel.visible = true;

      // Background rectangle behind label
      const w = this.fuelLabel.width + 8;
      const h = this.fuelLabel.height + 4;
      this.labelBg.clear();
      this.labelBg.roundRect(mx - w / 2, my - h / 2, w, h, 4);
      this.labelBg.fill({ color: 0x0f172a, alpha: 0.8 });
      this.labelBg.visible = true;
    } else {
      this.fuelLabel.visible = false;
      this.labelBg.visible = false;
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
