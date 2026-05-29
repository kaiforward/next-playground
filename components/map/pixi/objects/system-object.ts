import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { SystemNodeData, NavigationNodeState, SystemEventInfo } from "@/lib/hooks/use-map-data";
import type { SystemVisibility } from "@/lib/types/game";
import type { LODState } from "../lod";
import { ECONOMY_COLORS, NAV_COLORS, SIZES, TEXT_COLORS, EVENT_DOT_COLORS, FLEET, GLYPH, TEXT_RESOLUTION } from "../theme";

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

const DOCKED_COUNT_STYLE = new TextStyle({
  fontSize: 12,
  fill: FLEET.pillContent,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontWeight: "700",
  align: "center",
});

/** A single docked-fleet pill (ship glyph + count) drawn on the system glyph. */
interface DockedPill {
  container: Container;
  bg: Graphics;
  glyph: Graphics;
  count: Text;
}

export class SystemObject extends Container {
  systemId = "";

  private glow: Graphics;
  private core: Graphics;
  private highlight: Graphics;
  private navigationRing: Graphics;
  private nameLabel: Text;
  private econLabel: Text;
  private shipPill: DockedPill;   // blue — solo docked ships
  private convoyPill: DockedPill; // copper — docked convoys
  private gatewayDot: Graphics;
  private eventDots: Graphics;

  // For hit testing
  private hitCircle: Graphics;

  // Track state for update diffing
  private currentName = "";
  private currentEconomy = "";
  private currentNavState: NavigationNodeState | undefined;
  private currentVisibility: SystemVisibility = "unknown";
  private currentSoloShipCount = 0;
  private currentConvoyCount = 0;
  private currentIsGateway = false;
  private currentSelected = false;
  private currentEventTypes: string[] = [];
  private currentPriceTint: number | null = null;
  private currentPriceDelta: number | null = null;

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

    // Docked-fleet pills (top-left of the glyph; replace the pulse ring + text).
    // Solo ships (blue) and convoys (copper) get separate pills, stacked when both.
    this.shipPill = this.createDockedPill();
    this.convoyPill = this.createDockedPill();

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
    const visibilityChanged = data.visibility !== this.currentVisibility;
    const shipChanged =
      data.dockedShipCount !== this.currentSoloShipCount ||
      data.dockedConvoyCount !== this.currentConvoyCount;
    const gatewayChanged = data.isGateway !== this.currentIsGateway;
    const selectedChanged = isSelected !== this.currentSelected;
    const eventTypes = data.activeEvents?.map((e) => e.type).join(",") ?? "";
    const eventsChanged = eventTypes !== this.currentEventTypes.join(",");
    const priceChanged =
      (data.priceTint ?? null) !== this.currentPriceTint ||
      (data.priceDelta ?? null) !== this.currentPriceDelta;

    const isUnknown = data.visibility === "unknown";

    if (econChanged || visibilityChanged) {
      this.currentEconomy = data.economyType;
      this.currentVisibility = data.visibility;
      const colors = ECONOMY_COLORS[data.economyType];

      this.core.clear();
      this.core.circle(0, 0, SIZES.systemCoreRadius);
      this.core.fill(colors.core);
      this.core.alpha = isUnknown ? 0.4 : 1;

      this.highlight.clear();
      this.highlight.circle(0, 0, 4);
      this.highlight.fill({ color: 0xffffff, alpha: isUnknown ? 0.2 : 0.6 });
      this.highlight.position.set(-3, -3);

      this.econLabel.text = data.economyType.toUpperCase();
      this.econLabel.style.fill = colors.core;
    }

    // Halo is the overlay lens: it owns its own draw path so navigation state
    // (which used to redraw the glow) can't clobber the price tint.
    if (econChanged || visibilityChanged || priceChanged) {
      this.currentPriceTint = data.priceTint ?? null;
      this.currentPriceDelta = data.priceDelta ?? null;
      this.redrawHalo(data, isUnknown);
    }

    if (econChanged || navChanged || selectedChanged || visibilityChanged) {
      this.currentNavState = data.navigationState;
      this.currentSelected = isSelected;
      this.updateNavigationVisuals(data.navigationState, isSelected);
    }

    // Name — only update text when changed (avoids Pixi texture regeneration for 600+ systems)
    if (data.name !== this.currentName) {
      this.currentName = data.name;
      this.nameLabel.text = data.name;
    }
    this.nameLabel.position.set(0, SIZES.systemCoreRadius + 4);
    this.nameLabel.alpha = isUnknown ? 0.3 : 1;
    this.econLabel.position.set(0, SIZES.systemCoreRadius + 4 + SIZES.systemLabelSize + 2);

    // Unknown systems: hide economy label, ship count, event dots
    this.econLabel.visible = !isUnknown;

    if (shipChanged) {
      // Counts come from the player's own fleet data — always show regardless of fog-of-war
      this.currentSoloShipCount = data.dockedShipCount;
      this.currentConvoyCount = data.dockedConvoyCount;
      this.redrawDockedPills();
    }

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

    if (eventsChanged || visibilityChanged) {
      this.currentEventTypes = eventTypes.split(",").filter(Boolean);
      if (isUnknown) {
        this.eventDots.clear();
      } else {
        this.drawEventDots(data.activeEvents, data.navigationState);
      }
    }
  }

  /** Draw the soft-body halo — the overlay lens. Price ramp when price data is
   *  present, else the economy glow tint. The single owner of `this.glow`. */
  private redrawHalo(data: SystemNodeData, isUnknown: boolean) {
    const tint = data.priceTint;
    const hasPrice = tint != null;
    const haloColor = hasPrice ? tint : ECONOMY_COLORS[data.economyType].glow;
    const haloAlpha = isUnknown ? 0.05 : hasPrice ? GLYPH.haloPriceAlpha : GLYPH.haloAlpha;
    this.glow.clear();
    this.glow.circle(0, 0, GLYPH.haloRadius);
    this.glow.fill({ color: haloColor, alpha: haloAlpha });
  }

  private createDockedPill(): DockedPill {
    const container = new Container();
    const bg = new Graphics();
    const glyph = new Graphics();
    const count = new Text({ text: "", style: DOCKED_COUNT_STYLE, resolution: TEXT_RESOLUTION });
    count.anchor.set(0, 0.5);
    container.addChild(bg, glyph, count);
    container.visible = false;
    this.addChild(container);
    return { container, bg, glyph, count };
  }

  /** Lay out the ship + convoy pills, stacking the ship pill above the convoy
   *  pill when both are present. Both right-align to the glyph's top-left. */
  private redrawDockedPills() {
    const h = FLEET.markerHeight;
    const gap = 3;
    const x = -SIZES.systemCoreRadius + 2;
    const baseY = -SIZES.systemCoreRadius - 2;
    const hasShips = this.currentSoloShipCount > 0;
    const hasConvoys = this.currentConvoyCount > 0;

    // Convoy pill sits at the anchor (nearest the glyph); ships stack above it.
    if (hasConvoys) {
      this.drawPill(this.convoyPill, this.currentConvoyCount, FLEET.convoyFill, x, baseY);
    }
    this.convoyPill.container.visible = hasConvoys;

    if (hasShips) {
      const shipY = hasConvoys ? baseY - (h + gap) : baseY;
      this.drawPill(this.shipPill, this.currentSoloShipCount, FLEET.pillFill, x, shipY);
    }
    this.shipPill.container.visible = hasShips;
  }

  private drawPill(pill: DockedPill, count: number, color: number, x: number, y: number) {
    const h = FLEET.markerHeight;
    const pad = 5;
    const glyphW = FLEET.chevronSize;
    pill.count.text = String(count);
    const textW = pill.count.width;
    const w = pad + glyphW + 4 + textW + pad;

    pill.bg.clear();
    pill.bg.roundRect(-w, -h / 2, w, h, FLEET.pillCorner);
    pill.bg.fill(color);

    // ship glyph (small right-pointing chevron) near the left
    const gx = -w + pad;
    pill.glyph.clear();
    pill.glyph.poly([gx, -glyphW / 2, gx + glyphW, 0, gx, glyphW / 2, gx + glyphW * 0.35, 0]);
    pill.glyph.fill(FLEET.pillContent);

    pill.count.position.set(gx + glyphW + 4, 0);
    pill.container.position.set(x, y);
  }

  /** Apply LOD-based visibility. Called per frame from layer. */
  setLOD(lod: LODState) {
    const isUnknown = this.currentVisibility === "unknown";

    this.nameLabel.visible = lod.showSystemNames;
    this.nameLabel.alpha = lod.systemNameAlpha * (isUnknown ? 0.3 : 1);

    // Unknown systems: economy label hidden regardless of LOD
    this.econLabel.visible = lod.showEconomyLabels && !isUnknown;
    this.econLabel.alpha = lod.detailAlpha;

    // Fleet pills + event dots are markers, not text: they track the system
    // glyph itself (the systemLayer container already carries systemLayerAlpha),
    // so they appear/disappear in step with the price ring instead of fading
    // out earlier than it. Only the text labels above keep a staggered reveal.
    this.shipPill.container.visible = this.currentSoloShipCount > 0;
    this.shipPill.container.alpha = 1;
    this.convoyPill.container.visible = this.currentConvoyCount > 0;
    this.convoyPill.container.alpha = 1;

    this.glow.visible = lod.showGlow;

    // Unknown systems: event dots hidden regardless of LOD
    this.eventDots.visible = !isUnknown;
    this.eventDots.alpha = 1;

    // Scale core + highlight by LOD
    this.core.scale.set(lod.systemDotScale);
    this.highlight.scale.set(lod.systemDotScale);
    this.navigationRing.scale.set(lod.systemDotScale);
  }

  private updateNavigationVisuals(
    state: NavigationNodeState | undefined,
    isSelected: boolean,
  ) {
    this.navigationRing.clear();
    this.alpha = 1;
    this.scale.set(1);
    this.cursor = "pointer";

    if (isSelected && !state) {
      // Selected system (no navigation) — subtle highlight ring
      this.navigationRing.circle(0, 0, SIZES.systemCoreRadius + 4);
      this.navigationRing.stroke({ color: 0xffffff, width: 2, alpha: 0.6 });
    }

    if (!state) return;

    switch (state) {
      case "origin":
        this.navigationRing.circle(0, 0, SIZES.systemCoreRadius + 4);
        this.navigationRing.stroke({ color: NAV_COLORS.origin, width: 3, alpha: 1 });
        this.scale.set(1.1);
        break;

      case "reachable":
        // Reachability is graph topology (from atlas), not fog-of-war intel — always show
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
