import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { RegionNodeData, RegionNavigationState } from "@/lib/hooks/use-map-data";
import { ECONOMY_COLORS, NAV_COLORS, SIZES, TEXT_COLORS, TEXT_RESOLUTION } from "../theme";

const NAME_STYLE = new TextStyle({
  fontSize: SIZES.regionLabelSize,
  fill: TEXT_COLORS.primary,
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontWeight: "bold",
  align: "center",
});

const ECON_STYLE = new TextStyle({
  fontSize: SIZES.regionSubLabelSize,
  fontFamily: "system-ui, -apple-system, sans-serif",
  align: "center",
});

const INFO_STYLE = new TextStyle({
  fontSize: SIZES.regionSubLabelSize,
  fill: TEXT_COLORS.tertiary,
  fontFamily: "system-ui, -apple-system, sans-serif",
  align: "center",
});

const SHIP_STYLE = new TextStyle({
  fontSize: SIZES.regionSubLabelSize,
  fill: TEXT_COLORS.ship,
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontWeight: "bold",
  align: "center",
});

export class RegionObject extends Container {
  regionId = "";

  private bg: Graphics;
  private border: Graphics;
  private navRing: Graphics;
  private nameLabel: Text;
  private econLabel: Text;
  private systemCountLabel: Text;
  private shipLabel: Text;

  private currentNavState: RegionNavigationState | undefined;

  constructor() {
    super();

    this.bg = new Graphics();
    this.addChild(this.bg);

    this.border = new Graphics();
    this.addChild(this.border);

    this.navRing = new Graphics();
    this.addChild(this.navRing);

    this.nameLabel = new Text({ text: "", style: NAME_STYLE, resolution: TEXT_RESOLUTION });
    this.nameLabel.anchor.set(0.5, 0);
    this.addChild(this.nameLabel);

    this.econLabel = new Text({ text: "", style: ECON_STYLE, resolution: TEXT_RESOLUTION });
    this.econLabel.anchor.set(0.5, 0);
    this.addChild(this.econLabel);

    this.systemCountLabel = new Text({ text: "", style: INFO_STYLE, resolution: TEXT_RESOLUTION });
    this.systemCountLabel.anchor.set(0.5, 0);
    this.addChild(this.systemCountLabel);

    this.shipLabel = new Text({ text: "", style: SHIP_STYLE, resolution: TEXT_RESOLUTION });
    this.shipLabel.anchor.set(0.5, 0);
    this.shipLabel.visible = false;
    this.addChild(this.shipLabel);

    this.eventMode = "static";
    this.cursor = "pointer";
  }

  update(data: RegionNodeData) {
    this.regionId = data.id;
    this.position.set(data.x, data.y);

    const w = SIZES.regionWidth;
    const h = SIZES.regionHeight;
    const r = SIZES.regionCornerRadius;

    // Background
    this.bg.clear();
    this.bg.roundRect(-w / 2, -h / 2, w, h, r);
    this.bg.fill({ color: 0x1e293b, alpha: 0.6 });

    // Border
    this.border.clear();
    this.border.roundRect(-w / 2, -h / 2, w, h, r);
    this.border.stroke({ color: 0x64748b, width: 2, alpha: 0.5 });

    // Set as hit area
    this.hitArea = { contains: (x: number, y: number) => {
      return x >= -w / 2 && x <= w / 2 && y >= -h / 2 && y <= h / 2;
    }};

    // Labels — stacked vertically from top of box
    const topY = -h / 2 + 12;
    this.nameLabel.text = data.name;
    this.nameLabel.position.set(0, topY);

    const colors = ECONOMY_COLORS[data.dominantEconomy];
    this.econLabel.text = data.dominantEconomy.toUpperCase();
    this.econLabel.style.fill = colors.core;
    this.econLabel.position.set(0, topY + SIZES.regionLabelSize + 4);

    this.systemCountLabel.text = `${data.systemCount} system${data.systemCount !== 1 ? "s" : ""}`;
    this.systemCountLabel.position.set(0, topY + SIZES.regionLabelSize + 4 + SIZES.regionSubLabelSize + 3);

    if (data.shipCount > 0) {
      this.shipLabel.visible = true;
      this.shipLabel.text = `${data.shipCount} SHIP${data.shipCount !== 1 ? "S" : ""}`;
      this.shipLabel.position.set(0, topY + SIZES.regionLabelSize + 4 + SIZES.regionSubLabelSize * 2 + 6);
    } else {
      this.shipLabel.visible = false;
    }

    // Navigation state
    if (data.navigationState !== this.currentNavState) {
      this.currentNavState = data.navigationState;
      this.updateNavVisuals(data.navigationState, w, h, r);
    }
  }

  private updateNavVisuals(
    state: RegionNavigationState | undefined,
    w: number,
    h: number,
    r: number,
  ) {
    this.navRing.clear();
    this.alpha = 1;
    this.cursor = "pointer";

    if (!state) return;

    switch (state) {
      case "origin":
        this.navRing.roundRect(-w / 2 - 4, -h / 2 - 4, w + 8, h + 8, r + 2);
        this.navRing.stroke({ color: NAV_COLORS.origin, width: 2, alpha: 1 });
        break;
      case "reachable":
        this.border.clear();
        this.border.roundRect(-w / 2, -h / 2, w, h, r);
        this.border.stroke({ color: NAV_COLORS.reachable, width: 2, alpha: 0.6 });
        break;
      case "unreachable":
        this.alpha = 0.4;
        this.cursor = "not-allowed";
        break;
    }
  }
}
