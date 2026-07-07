import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { SystemNodeData, SystemEventInfo } from "@/lib/hooks/use-map-data";
import type { SystemVisibility } from "@/lib/types/game";
import type { LODState } from "../lod";
import { ECONOMY_COLORS, SIZES, TEXT_COLORS, EVENT_DOT_COLORS, EVENT_ICON, GLYPH, PILL, PILL_ANCHOR, LABEL, TEXT_RESOLUTION } from "../theme";

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

const PILL_LABEL_STYLE = new TextStyle({
  fontSize: 13,
  fill: 0xffffff,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontWeight: "700",
  align: "center",
});

// Event-pill count uses a light fill — the pill body is dark (slate-800).
const EVENT_COUNT_STYLE = new TextStyle({
  fontSize: 12,
  fill: TEXT_COLORS.primary,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontWeight: "700",
  align: "center",
});

/** Top-right price pill: signed % delta, tinted to the price ramp. */
interface PricePill {
  container: Container;
  bg: Graphics;
  label: Text;
}

/** Bottom-right event pill: dominant event icon + count, accent-bordered. */
interface EventPill {
  container: Container;
  bg: Graphics;
  icon: Text;
  count: Text;
}

/** The LODState fields setLOD() actually reads. Kept in sync with setLOD's body
 *  so the per-frame guard can skip redundant reapplies when only unrelated LOD
 *  bands (territory alpha, region labels, …) changed. */
function lodVisuallyEqual(a: LODState, b: LODState): boolean {
  return (
    a.showSystemNames === b.showSystemNames &&
    a.systemNameAlpha === b.systemNameAlpha &&
    a.showEconomyLabels === b.showEconomyLabels &&
    a.detailAlpha === b.detailAlpha &&
    a.showPillContent === b.showPillContent &&
    a.pillContentAlpha === b.pillContentAlpha &&
    a.showGlow === b.showGlow &&
    a.systemDotScale === b.systemDotScale
  );
}

export class SystemObject extends Container {
  systemId = "";

  private glow: Graphics;
  private core: Graphics;
  private highlight: Graphics;
  private selectionRing: Graphics;
  private nameBg: Graphics;
  private nameLabel: Text;
  private econBg: Graphics;
  private econLabel: Text;
  private pricePill: PricePill;   // top-right — price-ramp delta
  private eventPill: EventPill;   // bottom-right — dominant event icon + count

  // For hit testing
  private hitCircle: Graphics;

  // Track state for update diffing
  private currentName = "";
  private currentEconomy = "";
  private currentVisibility: SystemVisibility = "unknown";
  private currentSelected = false;
  private currentEventTypes: string[] = [];
  private currentPriceTint: number | null = null;
  private currentPriceDelta: number | null = null;
  private hasEventPill = false;
  private eventHasCount = false;

  // ── Ambient-visibility gating ─────────────────────────────────
  // The event pill renders ambiently only when its overlay is on; otherwise it
  // reveals on hover or selection (overlay-off hides the clutter, it doesn't
  // hide the data). Defaults to the overlay's default (on).
  private showEvents = true;
  private isHovered = false;

  // setLOD runs every frame for every visible system; its output depends only
  // on the incoming LODState plus the tracked state above (all mutated in
  // update()). `lodDirty` is set whenever update() runs so the next setLOD
  // reapplies; otherwise an unchanged LOD short-circuits the per-frame writes.
  private appliedLod: LODState | null = null;
  private lodDirty = true;

  constructor() {
    super();

    // Glow / soft-body halo (bottom)
    this.glow = new Graphics();
    this.addChild(this.glow);

    // Selection focus ring (behind core)
    this.selectionRing = new Graphics();
    this.addChild(this.selectionRing);

    // Core circle
    this.core = new Graphics();
    this.addChild(this.core);

    // Highlight dot
    this.highlight = new Graphics();
    this.addChild(this.highlight);

    // Name label, over a semi-transparent backing for legibility against the
    // ring/halo behind it. Backing is added first so it sits behind the text;
    // both stay below the corner pills (added later) in the z-stack.
    this.nameBg = new Graphics();
    this.addChild(this.nameBg);
    this.nameLabel = new Text({ text: "", style: NAME_STYLE, resolution: TEXT_RESOLUTION });
    this.nameLabel.anchor.set(0.5, 0);
    this.addChild(this.nameLabel);
    // Label backing + text sit at a fixed offset below the glyph — set once.
    this.nameLabel.position.set(0, LABEL.offsetY);
    this.nameBg.position.set(0, LABEL.offsetY);

    // Economy label (same backing treatment)
    this.econBg = new Graphics();
    this.addChild(this.econBg);
    this.econLabel = new Text({ text: "", style: ECON_STYLE, resolution: TEXT_RESOLUTION });
    this.econLabel.anchor.set(0.5, 0);
    this.addChild(this.econLabel);

    // Price pill (top-right of the glyph) — tinted to the price ramp.
    this.pricePill = this.createPricePill();

    // Event pill (bottom-right of the glyph) — dominant event icon + count.
    this.eventPill = this.createEventPill();

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
    const visibilityChanged = data.visibility !== this.currentVisibility;
    const selectedChanged = isSelected !== this.currentSelected;
    const eventTypes = data.activeEvents?.map((e) => e.type).join(",") ?? "";
    const eventsChanged = eventTypes !== this.currentEventTypes.join(",");
    const priceChanged =
      data.priceTint !== this.currentPriceTint ||
      data.priceDelta !== this.currentPriceDelta;

    const isUnknown = data.visibility === "unknown";

    if (econChanged || visibilityChanged) {
      this.currentEconomy = data.economyType;
      this.currentVisibility = data.visibility;
      const colors = ECONOMY_COLORS[data.economyType];
      const undeveloped = !data.developed;

      // Undeveloped systems carry an economy-type label but no built economy, so
      // they read as a hollow ring (labelled potential) rather than a filled disc
      // (live economy). The ring keeps the economy colour; a faint fill stops the
      // small marker from looking like a hole.
      this.core.clear();
      this.core.circle(0, 0, SIZES.systemCoreRadius);
      if (undeveloped) {
        this.core.fill({ color: colors.core, alpha: GLYPH.undevelopedFillAlpha });
        this.core.stroke({ color: colors.core, width: GLYPH.undevelopedRingWidth });
      } else {
        this.core.fill(colors.core);
      }
      this.core.alpha = isUnknown ? 0.4 : 1;

      // The specular highlight implies a solid body — drop it on hollow markers.
      this.highlight.clear();
      if (!undeveloped) {
        this.highlight.circle(0, 0, 4);
        this.highlight.fill({ color: 0xffffff, alpha: isUnknown ? 0.2 : 0.6 });
        this.highlight.position.set(-3, -3);
      }

      this.econLabel.text = data.economyType.toUpperCase();
      this.econLabel.style.fill = colors.core;
      this.drawLabelBg(this.econBg, this.econLabel);
    }

    // Halo is the overlay lens: it owns its own draw path so navigation state
    // (which used to redraw the glow) can't clobber the price tint.
    if (econChanged || visibilityChanged || priceChanged) {
      this.currentPriceTint = data.priceTint;
      this.currentPriceDelta = data.priceDelta;
      this.redrawHalo(data, isUnknown);
      this.redrawPricePill();
    }

    if (econChanged || selectedChanged || visibilityChanged) {
      this.currentSelected = isSelected;
      this.updateSelectionRing(isSelected);
    }

    // Name — only update text + backing when changed (avoids Pixi texture
    // regeneration for 600+ systems). The economy line stacks under the name
    // *backing*, so its Y only shifts when the name's measured height changes —
    // recompute it here, inside the same guard, not every update.
    if (data.name !== this.currentName) {
      this.currentName = data.name;
      this.nameLabel.text = data.name;
      this.drawLabelBg(this.nameBg, this.nameLabel);

      // Use the name's measured height (≈14), not its 11px font size, or the
      // two labels overlap.
      const econY = LABEL.offsetY + this.nameLabel.height + LABEL.bgPadY * 2 + LABEL.lineGap;
      this.econLabel.position.set(0, econY);
      this.econBg.position.set(0, econY);
    }
    this.nameLabel.alpha = isUnknown ? 0.3 : 1;

    // Unknown systems: hide economy label (ship/price/event pills gated in setLOD)
    this.econLabel.visible = !isUnknown;
    this.econBg.visible = !isUnknown;

    if (eventsChanged || visibilityChanged) {
      this.currentEventTypes = eventTypes.split(",").filter(Boolean);
      this.redrawEventPill(isUnknown ? undefined : data.activeEvents);
    }

    // Tracked state may have changed — force the next setLOD to reapply.
    this.lodDirty = true;
  }

  /** Set whether the event pill shows ambiently (overlay flag). When off, the
   *  pill still reveals on hover/selection. Marks LOD dirty so the next frame
   *  reapplies. */
  setOverlayFlags(showEvents: boolean) {
    if (this.showEvents === showEvents) return;
    this.showEvents = showEvents;
    this.lodDirty = true;
  }

  /** Hovering reveals this system's overlay-gated pills. Marks LOD dirty. */
  setHovered(hovered: boolean) {
    if (this.isHovered === hovered) return;
    this.isHovered = hovered;
    this.lodDirty = true;
  }

  /** Draw the soft-body halo — the overlay lens. Price ramp when price data is
   *  present, else the economy glow tint. The single owner of `this.glow`. */
  private redrawHalo(data: SystemNodeData, isUnknown: boolean) {
    const tint = data.priceTint;
    const hasPrice = tint != null;
    const haloColor = hasPrice ? tint : ECONOMY_COLORS[data.economyType].glow;
    // Undeveloped systems (no live economy, never priced) get a dimmed glow so
    // the filled-vs-hollow distinction reads at the halo level too.
    const haloAlpha = isUnknown
      ? 0.05
      : !data.developed
        ? GLYPH.haloUndevelopedAlpha
        : hasPrice
          ? GLYPH.haloPriceAlpha
          : GLYPH.haloAlpha;
    this.glow.clear();
    this.glow.circle(0, 0, GLYPH.haloRadius);
    this.glow.fill({ color: haloColor, alpha: haloAlpha });
  }

  /** Size a label's backing rect to the (already-set) text, centred under its
   *  top-centre anchor with a little padding. Redrawn only when the text
   *  changes — position is set per-frame in update(). */
  private drawLabelBg(bg: Graphics, label: Text) {
    const w = label.width + LABEL.bgPadX * 2;
    const h = label.height + LABEL.bgPadY * 2;
    bg.clear();
    bg.roundRect(-w / 2, -LABEL.bgPadY, w, h, LABEL.bgCorner);
    bg.fill({ color: LABEL.bgFill, alpha: LABEL.bgAlpha });
  }

  private createPricePill(): PricePill {
    const container = new Container();
    const bg = new Graphics();
    const label = new Text({ text: "", style: PILL_LABEL_STYLE, resolution: TEXT_RESOLUTION });
    label.anchor.set(0, 0.5);
    container.addChild(bg, label);
    container.visible = false;
    this.addChild(container);
    return { container, bg, label };
  }

  /** Draw the top-right price pill from the tracked tint/delta. Visibility is
   *  decided per-frame in setLOD; this just lays out the shape + label. */
  private redrawPricePill() {
    const tint = this.currentPriceTint;
    const delta = this.currentPriceDelta;
    if (tint == null || delta == null) return;

    const h = PILL.height;
    const { label, bg } = this.pricePill;
    label.text = `${delta > 0 ? "+" : ""}${delta}%`;
    const w = PILL.padX + label.width + PILL.padX;

    bg.clear();
    bg.roundRect(0, -h / 2, w, h, PILL.corner);
    bg.fill(tint);

    label.position.set(PILL.padX, 0);
    // Top-right anchor; grows rightward.
    this.pricePill.container.position.set(PILL_ANCHOR.x, PILL_ANCHOR.yTop);
  }

  /** Apply LOD-based visibility. Called per frame from layer. */
  setLOD(lod: LODState) {
    // Idle-frame fast path: nothing in update() changed and the LOD bands this
    // method reads are identical to last frame — skip the ~25 display-object
    // writes (nothing about this system changed this frame).
    if (!this.lodDirty && this.appliedLod && lodVisuallyEqual(this.appliedLod, lod)) {
      return;
    }
    this.appliedLod = lod;
    this.lodDirty = false;

    const isUnknown = this.currentVisibility === "unknown";

    const nameAlpha = lod.systemNameAlpha * (isUnknown ? 0.3 : 1);
    this.nameLabel.visible = lod.showSystemNames;
    this.nameLabel.alpha = nameAlpha;
    this.nameBg.visible = lod.showSystemNames;
    this.nameBg.alpha = nameAlpha;

    // Unknown systems: economy label hidden regardless of LOD
    const showEcon = lod.showEconomyLabels && !isUnknown;
    this.econLabel.visible = showEcon;
    this.econLabel.alpha = lod.detailAlpha;
    this.econBg.visible = showEcon;
    this.econBg.alpha = lod.detailAlpha;

    // ── Corner pills: two-stage reveal ──
    // The coloured pill *shape* (bg) shows whenever its data is present — it
    // tracks the system glyph (the systemLayer container carries
    // systemLayerAlpha). The *content* (chevron / icon / text) fades in one
    // band later, alongside system names, so far-out pills read as bare colour.
    const showContent = lod.showPillContent;
    const contentAlpha = lod.pillContentAlpha;

    // Hover or selection always reveals a system's event pill, even with the
    // Events overlay off.
    const reveal = this.isHovered || this.currentSelected;
    const revealEvents = this.showEvents || reveal;

    const showPrice = this.currentPriceTint != null && !isUnknown;
    this.pricePill.container.visible = showPrice;
    if (showPrice) this.stagePillContent(showContent, contentAlpha, this.pricePill.label);

    const showEvent = revealEvents && this.hasEventPill && !isUnknown;
    this.eventPill.container.visible = showEvent;
    if (showEvent) {
      this.stagePillContent(showContent, contentAlpha, this.eventPill.icon);
      this.eventPill.count.visible = showContent && this.eventHasCount;
      this.eventPill.count.alpha = contentAlpha;
    }

    this.glow.visible = lod.showGlow;

    // Scale core + highlight by LOD
    this.core.scale.set(lod.systemDotScale);
    this.highlight.scale.set(lod.systemDotScale);
    this.selectionRing.scale.set(lod.systemDotScale);
  }

  /** Two-stage LOD helper: toggle a pill's content nodes (text/icons) together.
   *  The pill *shape* (bg) is gated separately by the caller. */
  private stagePillContent(visible: boolean, alpha: number, ...nodes: (Graphics | Text)[]) {
    for (const node of nodes) {
      node.visible = visible;
      node.alpha = alpha;
    }
  }

  /** Stroke a dashed ring as a series of short arcs (Pixi v12 has no native
   *  dashed stroke on circle()). Each dash is its own subpath so no chords
   *  connect them. */
  private strokeDashedRing(g: Graphics, radius: number, color: number, width: number, alpha = 1) {
    // Target dash/gap (radians). They're rescaled to a whole number of dashes so
    // the pattern tiles the circle exactly — otherwise the leftover at the
    // 0-radian seam is a short gap and the first/last dashes nearly collide.
    const targetDash = 0.5;
    const targetGap = 0.32;
    const count = Math.max(1, Math.round((Math.PI * 2) / (targetDash + targetGap)));
    const period = (Math.PI * 2) / count;
    const dash = period * (targetDash / (targetDash + targetGap));
    for (let i = 0; i < count; i++) {
      const a = i * period;
      g.moveTo(Math.cos(a) * radius, Math.sin(a) * radius);
      g.arc(0, 0, radius, a, a + dash);
    }
    g.stroke({ color, width, alpha });
  }

  private updateSelectionRing(isSelected: boolean) {
    this.selectionRing.clear();
    if (isSelected) {
      // Selected system — bright white dashed focus ring so the selection
      // reads clearly at a glance.
      this.strokeDashedRing(this.selectionRing, GLYPH.navRingRadius, 0xffffff, GLYPH.selectedRingWidth, 1);
    }
  }

  private createEventPill(): EventPill {
    const container = new Container();
    const bg = new Graphics();
    const icon = new Text({
      text: "",
      style: new TextStyle({ fontSize: 13, fontFamily: "system-ui, -apple-system, sans-serif" }),
      resolution: TEXT_RESOLUTION,
    });
    icon.anchor.set(0, 0.5);
    const count = new Text({ text: "", style: EVENT_COUNT_STYLE, resolution: TEXT_RESOLUTION });
    count.anchor.set(0, 0.5);
    container.addChild(bg, icon, count);
    container.visible = false;
    this.addChild(container);
    return { container, bg, icon, count };
  }

  /** Draw the bottom-right event pill from the dominant (highest-priority)
   *  event. Visibility is finalised in setLOD via `hasEventPill`. */
  private redrawEventPill(events: SystemEventInfo[] | undefined) {
    this.hasEventPill = !!events && events.length > 0;
    if (!this.hasEventPill || !events) return;

    const top = [...events].sort((a, b) => b.priority - a.priority)[0];
    const color = EVENT_DOT_COLORS[top.color] ?? EVENT_DOT_COLORS.slate;
    const h = PILL.height;
    const { bg, icon, count } = this.eventPill;

    icon.text = EVENT_ICON[top.color] ?? EVENT_ICON.slate;
    icon.style.fill = color;
    icon.position.set(PILL.padX, 0);

    this.eventHasCount = events.length > 1;
    let w: number;
    if (this.eventHasCount) {
      count.text = String(events.length);
      count.position.set(PILL.padX + icon.width + PILL.gap, 0);
      w = count.x + count.width + PILL.padX;
    } else {
      count.text = "";
      w = PILL.padX + icon.width + PILL.padX;
    }

    bg.clear();
    bg.roundRect(0, -h / 2, w, h, PILL.corner);
    bg.fill(0x1e293b);
    bg.stroke({ color, width: 1.5 });

    // Bottom-right: mirror of the price pill anchor, below the core.
    this.eventPill.container.position.set(PILL_ANCHOR.x, PILL_ANCHOR.yBottom);
  }
}
