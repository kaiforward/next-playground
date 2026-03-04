import { Container, Graphics } from "pixi.js";
import { FLEET_DOTS } from "../theme";
import type { LODState } from "../lod";

/**
 * Draws prominent dots at systems where the player has ships.
 * Visible at low zoom to show fleet deployment at a glance.
 */
export class FleetDotLayer {
  readonly container = new Container();
  private graphics = new Graphics();

  constructor() {
    this.container.addChild(this.graphics);
  }

  /**
   * Redraw fleet dots at systems with ships.
   * Called when map data changes, not per frame.
   */
  sync(shipPositions: { x: number; y: number }[]) {
    this.graphics.clear();

    for (const pos of shipPositions) {
      // Outer glow
      this.graphics.circle(pos.x, pos.y, FLEET_DOTS.glowRadius);
      this.graphics.fill({
        color: FLEET_DOTS.glowColor,
        alpha: FLEET_DOTS.glowAlpha,
      });

      // Core dot
      this.graphics.circle(pos.x, pos.y, FLEET_DOTS.radius);
      this.graphics.fill({
        color: FLEET_DOTS.color,
        alpha: FLEET_DOTS.fillAlpha,
      });
    }
  }

  /** Per-frame LOD update */
  updateVisibility(lod: LODState) {
    this.container.visible = lod.showFleetDots;
    this.container.alpha = lod.fleetDotAlpha;
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}
