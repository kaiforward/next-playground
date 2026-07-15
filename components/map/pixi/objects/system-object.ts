import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import type { SystemNodeData } from "@/lib/hooks/use-map-data";
import type { SunClass, SystemVisibility } from "@/lib/types/game";
import { isValueMapMode, type MapMode } from "@/lib/types/map";
import type { LODState } from "../lod";
import { SUN_CLASS_COLORS_PIXI, SIZES, TEXT_COLORS, GLYPH, LABEL, TEXT_RESOLUTION } from "../theme";
import { getGlowTexture, GLOW_TEXTURE_SIZE } from "./glow-texture";

// Scale that maps the shared glow texture down to the bloom's world diameter.
// Multiplied by the LOD dot-scale each frame in setLOD.
const BLOOM_BASE_SCALE = (GLYPH.bloomRadius * 2) / GLOW_TEXTURE_SIZE;

const NAME_STYLE = new TextStyle({
  fontSize: SIZES.systemLabelSize,
  fill: TEXT_COLORS.primary,
  fontFamily: "system-ui, -apple-system, sans-serif",
  align: "center",
});

/** The LODState fields setLOD() actually reads. Kept in sync with setLOD's body
 *  so the per-frame guard can skip redundant reapplies when only unrelated LOD
 *  bands (territory alpha, region labels, …) changed. */
function lodVisuallyEqual(a: LODState, b: LODState): boolean {
  return (
    a.showSystemNames === b.showSystemNames &&
    a.systemNameAlpha === b.systemNameAlpha &&
    a.systemDotScale === b.systemDotScale
  );
}

export class SystemObject extends Container {
  systemId = "";

  private bloom: Sprite;          // soft radial glow under the core (shared gradient texture)
  private core: Graphics;         // crisp bright core disc
  private hoverRing: Graphics;    // star-coloured ring, shown only on hover
  private selectionRing: Graphics;
  private nameBg: Graphics;
  private nameLabel: Text;

  // For hit testing
  private hitCircle: Graphics;

  // Track state for update diffing
  private currentName = "";
  private currentSunClass: SunClass = "yellow";
  private currentMode: MapMode = "none";
  private currentVisibility: SystemVisibility = "unknown";
  private currentSelected = false;

  // Hover state — drives the hover ring (see drawStar / setLOD).
  private isHovered = false;

  // setLOD runs every frame for every visible system; its output depends only
  // on the incoming LODState plus the tracked state above (all mutated in
  // update()). `lodDirty` is set whenever update() runs so the next setLOD
  // reapplies; otherwise an unchanged LOD short-circuits the per-frame writes.
  private appliedLod: LODState | null = null;
  private lodDirty = true;

  constructor() {
    super();

    // Selection focus ring (behind the dot)
    this.selectionRing = new Graphics();
    this.addChild(this.selectionRing);

    // Soft radial bloom (shared gradient texture, tinted per star colour) — sits
    // under the core so the dot has a glow that actually fades to transparent.
    this.bloom = new Sprite(getGlowTexture());
    this.bloom.anchor.set(0.5);
    this.addChild(this.bloom);

    // Star-type dot: a crisp bright core disc over the bloom.
    this.core = new Graphics();
    this.addChild(this.core);

    // Hover ring — star-coloured, above the dot, toggled on hover.
    this.hoverRing = new Graphics();
    this.hoverRing.visible = false;
    this.addChild(this.hoverRing);

    // Name label, over a semi-transparent backing for legibility against the
    // ring/halo behind it. Backing is added first so it sits behind the text.
    this.nameBg = new Graphics();
    this.addChild(this.nameBg);
    this.nameLabel = new Text({ text: "", style: NAME_STYLE, resolution: TEXT_RESOLUTION });
    this.nameLabel.anchor.set(0.5, 0);
    this.addChild(this.nameLabel);
    // Label backing + text sit at a fixed offset below the glyph — set once.
    this.nameLabel.position.set(0, LABEL.offsetY);
    this.nameBg.position.set(0, LABEL.offsetY);

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

    const sunClassChanged = data.sunClass !== this.currentSunClass;
    const visibilityChanged = data.visibility !== this.currentVisibility;
    const selectedChanged = isSelected !== this.currentSelected;

    const isUnknown = data.visibility === "unknown";

    if (sunClassChanged || visibilityChanged) {
      this.currentSunClass = data.sunClass;
      this.currentVisibility = data.visibility;
      this.drawStar();
    }

    if (selectedChanged || visibilityChanged) {
      this.currentSelected = isSelected;
      this.updateSelectionRing(isSelected);
    }

    // Name — only update text + backing when changed (avoids Pixi texture
    // regeneration for 600+ systems).
    if (data.name !== this.currentName) {
      this.currentName = data.name;
      this.nameLabel.text = data.name;
      this.drawLabelBg(this.nameBg, this.nameLabel);
    }
    this.nameLabel.alpha = isUnknown ? 0.3 : 1;

    // Tracked state may have changed — force the next setLOD to reapply.
    this.lodDirty = true;
  }

  /** Draw the star-type dot (+ hover ring) from tracked sunClass / visibility /
   *  mode. A dim same-hue bloom under a bright core disc — no gradient fill
   *  (regresses at max zoom). Value modes subdue the dot so the Voronoi cell
   *  carries the value; unknown systems dim. */
  private drawStar() {
    const color = SUN_CLASS_COLORS_PIXI[this.currentSunClass];
    const isUnknown = this.currentVisibility === "unknown";
    const subdued = isValueMapMode(this.currentMode);

    // Crisp bright core.
    this.core.clear();
    this.core.circle(0, 0, GLYPH.coreRadius).fill({ color });
    this.core.alpha = isUnknown ? 0.4 : subdued ? 0.5 : 1;

    // Soft glow — the texture carries the radial fade; tint + alpha carry colour
    // and strength. Subdued under value modes so the Voronoi cell reads.
    this.bloom.tint = color;
    this.bloom.alpha = isUnknown ? 0.2 : subdued ? 0.18 : 0.5;

    this.hoverRing.clear();
    this.hoverRing.circle(0, 0, GLYPH.hoverRingRadius).stroke({ color, width: 2, alpha: 0.9 });
  }

  /** Set the active map mode (subdues the dot under value modes). Marks LOD
   *  dirty so the next frame reapplies. */
  setMode(mode: MapMode) {
    if (this.currentMode === mode) return;
    this.currentMode = mode;
    this.drawStar();
    this.lodDirty = true;
  }

  /** Hovering shows the hover ring (see drawStar / setLOD). Marks LOD dirty. */
  setHovered(hovered: boolean) {
    if (this.isHovered === hovered) return;
    this.isHovered = hovered;
    this.lodDirty = true;
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

    // Scale the dot + rings by LOD; the hover ring shows only while hovered.
    this.core.scale.set(lod.systemDotScale);
    this.selectionRing.scale.set(lod.systemDotScale);
    this.hoverRing.scale.set(lod.systemDotScale);
    this.hoverRing.visible = this.isHovered;
    this.bloom.scale.set(BLOOM_BASE_SCALE * lod.systemDotScale);
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
}
