import { Container, Graphics } from "pixi.js";
import type { ConnectionData } from "@/lib/hooks/use-map-data";
import { LANE_BASE_ALPHA, LANE_BASE_COLOR, LANE_HOVERED, LANE_MODE, LANE_SELECTED, SIZES } from "../theme";
import { laneStyle, laneModeStyle } from "./lane-style";

/** Extra stroke width the congested pulse overlay draws beyond the lane's own mode width — a fixed
 *  glow overshoot, not a theme knob (the pulse rides whatever width the lane is already drawn at). */
const PULSE_GLOW_EXTRA_WIDTH = 4;

/** Which lane layer is drawing: `base` is the always-on quiet layer (`laneStyle`); `lanes` is the
 *  Lanes map mode (`laneModeStyle`) — investor colour, dashed-if-unclaimed, band alpha. */
export type ConnectionDrawMode = "base" | "lanes";

/** Interaction state a `ConnectionObject` draws on top of its base style — orthogonal to the lane's
 *  own data (fuel cost, level), so it doesn't perturb the base style's dirty-check. */
export interface ConnectionState {
  selected: boolean;
  hovered: boolean;
  mode: ConnectionDrawMode;
  /** The investor's Pixi colour in `lanes` mode, or null (no investor, or colours not synced yet).
   *  Ignored in `base` mode. */
  factionColor: number | null;
}

export class ConnectionObject extends Container {
  connectionId = "";
  private line: Graphics;
  /** The congested-pulse overlay stroke — a SEPARATE Graphics child so animating it every frame
   *  (`setPulseAlpha`) never re-strokes the base/mode line drawn by `update()`. */
  private pulse: Graphics;
  private pulseFrom = { x: 0, y: 0 };
  private pulseTo = { x: 0, y: 0 };
  private pulseWidth = 0;
  /** Style fingerprint for dirty-checking (positions are immutable from static tiles) */
  private styleFingerprint = "";

  constructor() {
    super();

    this.line = new Graphics();
    this.pulse = new Graphics();
    this.addChild(this.line);
    this.addChild(this.pulse);
  }

  update(
    data: ConnectionData,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    state: ConnectionState,
  ) {
    const mode = laneModeStyleFor(data, state);
    // Style fingerprint covers everything that changes the drawing: base width, mode style (colour,
    // width, alpha, dashed — itself derived from investor/level/band), selected and hovered.
    const fingerprint =
      `${state.mode}:${mode.width}:${mode.color}:${mode.alpha}:${mode.dashed}:${state.selected}:${state.hovered}`;
    this.pulseFrom = { x: fromX, y: fromY };
    this.pulseTo = { x: toX, y: toY };
    this.pulseWidth = mode.width;
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

    if (state.mode === "lanes" && mode.dashed) {
      drawDashedLine(this.line, fromX, fromY, toX, toY, mode.color, mode.alpha, mode.width);
    } else {
      this.line.moveTo(fromX, fromY);
      this.line.lineTo(toX, toY);
      this.line.stroke({ color: mode.color, width: mode.width, alpha: mode.alpha });
    }
  }

  /**
   * Draws (or clears, at alpha 0) the congested-pulse overlay stroke at the given alpha — called
   * every frame for congested lanes only by `ConnectionLayer.update`, using the position/width the
   * last `update()` cached, never re-touching the base/mode line itself.
   */
  setPulseAlpha(alpha: number) {
    this.pulse.clear();
    if (alpha <= 0) return;
    this.pulse.moveTo(this.pulseFrom.x, this.pulseFrom.y);
    this.pulse.lineTo(this.pulseTo.x, this.pulseTo.y);
    this.pulse.stroke({ color: LANE_MODE.pulseColor, width: this.pulseWidth + PULSE_GLOW_EXTRA_WIDTH, alpha });
  }
}

/** Resolves the drawn line style for either mode: `base` uses the always-on `laneStyle` at the base
 *  colour/alpha (dashed always false — the base layer never dashes); `lanes` uses `laneModeStyle`. */
function laneModeStyleFor(
  data: ConnectionData,
  state: ConnectionState,
): { color: number; width: number; alpha: number; dashed: boolean } {
  if (state.mode === "lanes") {
    return laneModeStyle({
      investorFactionId: data.investorFactionId,
      factionColor: state.factionColor,
      level: data.level,
      band: data.band,
    });
  }
  const base = laneStyle({ fuelCost: data.fuelCost, level: data.level });
  return { color: LANE_BASE_COLOR, width: base.width, alpha: LANE_BASE_ALPHA, dashed: false };
}

/** Stroke a dashed segment between two points — the Lanes map mode's "no investor" treatment
 *  (`ConnectionObject.update`, `state.mode === "lanes"` and `laneModeStyle(...).dashed`). */
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
