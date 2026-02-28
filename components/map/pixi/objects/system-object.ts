import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { SystemNodeData, NavigationNodeState, SystemEventInfo } from "@/lib/hooks/use-map-data";
import type { LODState } from "../lod";
import { ECONOMY_COLORS, NAV_COLORS, SIZES, TEXT_COLORS, EVENT_DOT_COLORS, TEXT_RESOLUTION } from "../theme";

const NAME_STYLE = new TextStyle({
  fontSize: SIZES.systemLabelSize,
  fill: TEXT_COLORS.primary,
  fontFamily: "system-ui, -apple-system, sans-serif",
  align: "center",
});

const ECON_STYLE = new TextStyle({
  fontSize: SIZES.systemEconLabelSize,
  fontFamily: "system-ui, -apple-system, sans-serif",
  align: "center",
});

const SHIP_STYLE = new TextStyle({
  fontSize: SIZES.systemShipLabelSize,
  fill: TEXT_COLORS.ship,
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontWeight: "bold",
  align: "center",
});

export class SystemObject extends Container {
  systemId = "";

  private glow: Graphics;
  private core: Graphics;
  private highlight: Graphics;
  private navigationRing: Graphics;
  private nameLabel: Text;
  private econLabel: Text;
  private shipLabel: Text;
  private gatewayDot: Graphics;
  private eventDots: Graphics;

  // For hit testing
  private hitCircle: Graphics;

  // Track state for update diffing
  private currentEconomy = "";
  private currentNavState: NavigationNodeState | undefined;
  private currentShipCount = 0;
  private currentIsGateway = false;
  private currentSelected = false;
  private currentEventTypes: string[] = [];

  constructor() {
    super();

    // Glow (bottom)
    this.glow = new Graphics();
    this.addChild(this.glow);

    // Navigation ring (behind core)
    this.navigationRing = new Graphics();
    this.addChild(this.navigationRing);

    // Core circle
    this.core = new Graphics();
    this.addChild(this.core);

    // Highlight dot
    this.highlight = new Graphics();
    this.addChild(this.highlight);

    // Name label
    this.nameLabel = new Text({ text: "", style: NAME_STYLE, resolution: TEXT_RESOLUTION });
    this.nameLabel.anchor.set(0.5, 0);
    this.addChild(this.nameLabel);

    // Economy label
    this.econLabel = new Text({ text: "", style: ECON_STYLE, resolution: TEXT_RESOLUTION });
    this.econLabel.anchor.set(0.5, 0);
    this.addChild(this.econLabel);

    // Ship count label
    this.shipLabel = new Text({ text: "", style: SHIP_STYLE, resolution: TEXT_RESOLUTION });
    this.shipLabel.anchor.set(0.5, 0);
    this.shipLabel.visible = false;
    this.addChild(this.shipLabel);

    // Gateway indicator
    this.gatewayDot = new Graphics();
    this.gatewayDot.visible = false;
    this.addChild(this.gatewayDot);

    // Event dots
    this.eventDots = new Graphics();
    this.addChild(this.eventDots);

    // Hit area (invisible, for pointer events)
    this.hitCircle = new Graphics();
    this.hitCircle.circle(0, 0, SIZES.systemHitRadius);
    this.hitCircle.fill({ color: 0xffffff, alpha: 0.001 });
    this.addChild(this.hitCircle);

    this.eventMode = "static";
    this.cursor = "pointer";
  }

  update(data: SystemNodeData, isSelected: boolean) {
    this.systemId = data.id;
    this.position.set(data.x, data.y);

    const econChanged = data.economyType !== this.currentEconomy;
    const navChanged = data.navigationState !== this.currentNavState;
    const shipChanged = data.shipCount !== this.currentShipCount;
    const gatewayChanged = data.isGateway !== this.currentIsGateway;
    const selectedChanged = isSelected !== this.currentSelected;
    const eventTypes = data.activeEvents?.map((e) => e.type).join(",") ?? "";
    const eventsChanged = eventTypes !== this.currentEventTypes.join(",");

    if (econChanged) {
      this.currentEconomy = data.economyType;
      const colors = ECONOMY_COLORS[data.economyType];

      this.glow.clear();
      this.glow.circle(0, 0, SIZES.systemGlowRadius);
      this.glow.fill({ color: colors.glow, alpha: 0.15 });

      this.core.clear();
      this.core.circle(0, 0, SIZES.systemCoreRadius);
      this.core.fill(colors.core);

      this.highlight.clear();
      this.highlight.circle(0, 0, 4);
      this.highlight.fill({ color: 0xffffff, alpha: 0.6 });
      this.highlight.position.set(-3, -3);

      this.econLabel.text = data.economyType.toUpperCase();
      this.econLabel.style.fill = colors.core;
    }

    if (econChanged || navChanged || selectedChanged) {
      this.currentNavState = data.navigationState;
      this.currentSelected = isSelected;
      this.updateNavigationVisuals(data.navigationState, isSelected, data.economyType);
    }

    // Name (always update — cheap)
    this.nameLabel.text = data.name;
    this.nameLabel.position.set(0, SIZES.systemCoreRadius + 4);
    this.econLabel.position.set(0, SIZES.systemCoreRadius + 4 + SIZES.systemLabelSize + 2);

    if (shipChanged) {
      this.currentShipCount = data.shipCount;
      if (data.shipCount > 0) {
        this.shipLabel.visible = true;
        this.shipLabel.text = `${data.shipCount} SHIP${data.shipCount !== 1 ? "S" : ""}`;
      } else {
        this.shipLabel.visible = false;
      }
    }
    this.shipLabel.position.set(
      0,
      SIZES.systemCoreRadius + 4 + SIZES.systemLabelSize + 2 + SIZES.systemEconLabelSize + 2,
    );

    if (gatewayChanged) {
      this.currentIsGateway = data.isGateway;
      this.gatewayDot.clear();
      if (data.isGateway) {
        this.gatewayDot.visible = true;
        this.gatewayDot.circle(0, 0, SIZES.gatewayDotRadius);
        this.gatewayDot.fill(TEXT_COLORS.gateway);
        this.gatewayDot.position.set(SIZES.systemCoreRadius - 2, -SIZES.systemCoreRadius + 2);
      } else {
        this.gatewayDot.visible = false;
      }
    }

    if (eventsChanged) {
      this.currentEventTypes = eventTypes.split(",").filter(Boolean);
      this.drawEventDots(data.activeEvents, data.navigationState);
    }
  }

  /** Apply LOD-based visibility. Called per frame from layer. */
  setLOD(lod: LODState) {
    this.nameLabel.visible = lod.showSystemNames;
    this.nameLabel.alpha = lod.systemNameAlpha;

    this.econLabel.visible = lod.showEconomyLabels;
    this.econLabel.alpha = lod.detailAlpha;

    if (this.currentShipCount > 0) {
      this.shipLabel.visible = lod.showShipLabels;
      this.shipLabel.alpha = lod.detailAlpha;
    }

    this.glow.visible = lod.showGlow;

    this.eventDots.visible = lod.showEventDots;
    this.eventDots.alpha = lod.eventDotAlpha;

    // Scale core + highlight by LOD
    this.core.scale.set(lod.systemDotScale);
    this.highlight.scale.set(lod.systemDotScale);
    this.navigationRing.scale.set(lod.systemDotScale);
  }

  private updateNavigationVisuals(
    state: NavigationNodeState | undefined,
    isSelected: boolean,
    economyType: string,
  ) {
    this.navigationRing.clear();
    this.alpha = 1;
    this.scale.set(1);
    this.cursor = "pointer";

    const glowAlpha = 0.15;
    const colors = ECONOMY_COLORS[economyType as keyof typeof ECONOMY_COLORS];

    if (isSelected && !state) {
      // Selected system (no navigation) — subtle highlight ring
      this.navigationRing.circle(0, 0, SIZES.systemCoreRadius + 4);
      this.navigationRing.stroke({ color: 0xffffff, width: 2, alpha: 0.6 });
    }

    if (!state) {
      this.glow.clear();
      this.glow.circle(0, 0, SIZES.systemGlowRadius);
      this.glow.fill({ color: colors.glow, alpha: glowAlpha });
      return;
    }

    switch (state) {
      case "origin":
        this.navigationRing.circle(0, 0, SIZES.systemCoreRadius + 4);
        this.navigationRing.stroke({ color: NAV_COLORS.origin, width: 3, alpha: 1 });
        this.scale.set(1.1);
        this.glow.clear();
        this.glow.circle(0, 0, SIZES.systemGlowRadius);
        this.glow.fill({ color: colors.glow, alpha: 0.3 });
        break;

      case "reachable":
        this.navigationRing.circle(0, 0, SIZES.systemCoreRadius + 3);
        this.navigationRing.stroke({ color: NAV_COLORS.reachable, width: 1.5, alpha: 0.6 });
        break;

      case "unreachable":
        this.alpha = 0.3;
        this.cursor = "not-allowed";
        break;

      case "route_hop":
        this.navigationRing.circle(0, 0, SIZES.systemCoreRadius + 4);
        this.navigationRing.stroke({ color: NAV_COLORS.route_hop, width: 2, alpha: 1 });
        break;

      case "destination":
        this.navigationRing.circle(0, 0, SIZES.systemCoreRadius + 4);
        this.navigationRing.stroke({ color: NAV_COLORS.destination, width: 3, alpha: 1 });
        this.scale.set(1.1);
        this.glow.clear();
        this.glow.circle(0, 0, SIZES.systemGlowRadius);
        this.glow.fill({ color: colors.glow, alpha: 0.3 });
        break;
    }
  }

  private drawEventDots(events: SystemEventInfo[] | undefined, navState?: NavigationNodeState) {
    this.eventDots.clear();
    if (!events || events.length === 0 || navState === "unreachable") return;

    const sorted = [...events].sort((a, b) => b.priority - a.priority);
    const maxDots = 3;
    const dotSpacing = SIZES.eventDotRadius * 2.5;
    const startX = SIZES.systemCoreRadius + 2;
    const startY = SIZES.systemCoreRadius - 2;

    for (let i = 0; i < Math.min(sorted.length, maxDots); i++) {
      const color = EVENT_DOT_COLORS[sorted[i].color] ?? EVENT_DOT_COLORS.slate;
      this.eventDots.circle(startX + i * dotSpacing, startY, SIZES.eventDotRadius);
      this.eventDots.fill(color);
    }
  }
}
