import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import type { SystemNodeData } from "@/lib/hooks/use-map-data";
import type { SunClass, SystemVisibility } from "@/lib/types/game";
import { isValueMapMode, type MapMode } from "@/lib/types/map";
import type { LODState } from "../lod";
import { SUN_CLASS_COLORS_PIXI, SIZES, TEXT_COLORS, GLYPH, LABEL, SETTLEMENT_MARK, TEXT_RESOLUTION } from "../theme";
import type { SettlementMark } from "@/lib/types/map";
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
  private markRoot: Container;    // settlement mark (badge + pulse) — scaled as one by LOD
  private markBadge: Graphics;
  private markPulse: Sprite;      // the forming ping — glow texture expanding from the badge centre
  private nameBg: Graphics;
  private nameLabel: Text;

  // Track state for update diffing
  private currentName = "";
  private currentSunClass: SunClass = "yellow";
  private currentMode: MapMode = "none";
  private currentVisibility: SystemVisibility = "unknown";
  // Selection is the cell (`CellHighlightLayer`), not a ring on the glyph — the glyph draws nothing
  // for it; the flag is kept because the selected system's name always shows whatever the label
  // fit says.
  private currentSelected = false;
  private currentMark: SettlementMark | null = null;

  // setLOD runs every frame for every visible system; its output depends only
  // on the incoming LODState plus the tracked state above (all mutated in
  // update()). `lodDirty` is set whenever update() runs so the next setLOD
  // reapplies; otherwise an unchanged LOD short-circuits the per-frame writes.
  private appliedLod: LODState | null = null;
  private lodDirty = true;

  constructor() {
    super();

    // Soft radial bloom (shared gradient texture, tinted per star colour) — sits
    // under the core so the dot has a glow that actually fades to transparent.
    this.bloom = new Sprite(getGlowTexture());
    this.bloom.anchor.set(0.5);
    this.addChild(this.bloom);

    // Star-type dot: a crisp bright core disc over the bloom.
    this.core = new Graphics();
    this.addChild(this.core);

    // Settlement mark — badge at the star's NE shoulder, pulse behind it. One
    // sub-container so LOD scales badge + pulse together while the pulse's own
    // per-frame scale (tickSettlementPulse) composes underneath.
    this.markRoot = new Container();
    this.markPulse = new Sprite(getGlowTexture());
    this.markPulse.anchor.set(0.5);
    this.markPulse.tint = SETTLEMENT_MARK.formingColor;
    this.markPulse.visible = false;
    this.markPulse.position.set(
      SETTLEMENT_MARK.offsetX + SETTLEMENT_MARK.size / 2,
      SETTLEMENT_MARK.offsetY + SETTLEMENT_MARK.size / 2,
    );
    this.markRoot.addChild(this.markPulse);
    this.markBadge = new Graphics();
    this.markRoot.addChild(this.markBadge);
    this.markRoot.visible = false;
    this.addChild(this.markRoot);

    // Name label, over a semi-transparent backing for legibility against the
    // bloom/halo behind it. Backing is added first so it sits behind the text.
    this.nameBg = new Graphics();
    this.addChild(this.nameBg);
    this.nameLabel = new Text({ text: "", style: NAME_STYLE, resolution: TEXT_RESOLUTION });
    this.nameLabel.anchor.set(0.5, 0);
    this.addChild(this.nameLabel);
    // Label backing + text sit at a fixed offset below the glyph — set once.
    this.nameLabel.position.set(0, LABEL.offsetY);
    this.nameBg.position.set(0, LABEL.offsetY);

    // Selection is the cell/lane (`CellHighlightLayer`/`ConnectionLayer`), never the star — the
    // stage resolves every click and hover, so the glyph takes no pointer events at all.
    this.eventMode = "none";
  }

  update(data: SystemNodeData, isSelected: boolean) {
    this.systemId = data.id;
    this.position.set(data.x, data.y);

    const sunClassChanged = data.sunClass !== this.currentSunClass;
    const visibilityChanged = data.visibility !== this.currentVisibility;
    const selectedChanged = isSelected !== this.currentSelected;
    const markChanged = data.settlementMark !== this.currentMark;

    const isUnknown = data.visibility === "unknown";

    if (sunClassChanged || visibilityChanged) {
      this.currentSunClass = data.sunClass;
      this.currentVisibility = data.visibility;
      this.drawStar();
    }

    if (markChanged || visibilityChanged) {
      this.currentMark = data.settlementMark;
      this.drawSettlementMark();
    }

    if (selectedChanged) {
      this.currentSelected = isSelected;
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

  /** Draw the star-type dot from tracked sunClass / visibility / mode. A dim
   *  same-hue bloom under a bright core disc — no gradient fill (regresses at
   *  max zoom). Value modes subdue the dot so the Voronoi cell carries the
   *  value; unknown systems dim. */
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
  }

  /** Set the active map mode (subdues the dot under value modes). Marks LOD
   *  dirty so the next frame reapplies. */
  setMode(mode: MapMode) {
    if (this.currentMode === mode) return;
    this.currentMode = mode;
    this.drawStar();
    this.drawSettlementMark();
    this.lodDirty = true;
  }

  /** Draw the settlement badge from the tracked mark / mode. Hollow slate =
   *  claimed, hollow amber = colony forming (the pulse rides per-frame in
   *  tickSettlementPulse), solid copper = developed. Subdued under value modes
   *  so the Voronoi cell keeps carrying the value, same as the star dot. */
  private drawSettlementMark() {
    const mark = this.currentMark;
    this.markRoot.visible = mark !== null;
    if (mark === null) {
      this.markPulse.visible = false;
      return;
    }
    const M = SETTLEMENT_MARK;
    this.markBadge.clear();
    this.markBadge.roundRect(M.offsetX, M.offsetY, M.size, M.size, M.cornerRadius);
    if (mark === "developed") {
      this.markBadge.fill({ color: M.developedColor });
    } else {
      this.markBadge.fill({ color: M.backingColor, alpha: M.backingAlpha });
      this.markBadge.stroke({
        color: mark === "forming" ? M.formingColor : M.controlledColor,
        width: M.strokeWidth,
      });
    }
    this.markRoot.alpha = isValueMapMode(this.currentMode) ? 0.5 : 1;
    if (mark !== "forming") this.markPulse.visible = false;
  }

  /** Per-frame pulse for a forming colony: a soft glow expanding from the badge
   *  centre and fading as it reaches the frame (the approved prototype's ping).
   *  Cheap no-op for every other mark — called only for in-frustum objects. */
  tickSettlementPulse(timeMs: number) {
    if (this.currentMark !== "forming") return;
    const M = SETTLEMENT_MARK;
    const phase = (timeMs % M.pulsePeriodMs) / M.pulsePeriodMs;
    const radius = 1.5 + (M.pulseMaxRadius - 1.5) * phase;
    this.markPulse.scale.set((radius * 2) / GLOW_TEXTURE_SIZE);
    this.markPulse.alpha =
      phase < M.pulseFadeStart ? 1 : 1 - (phase - M.pulseFadeStart) / (1 - M.pulseFadeStart);
    this.markPulse.visible = true;
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

    // Scale the dot by LOD.
    this.core.scale.set(lod.systemDotScale);
    this.bloom.scale.set(BLOOM_BASE_SCALE * lod.systemDotScale);
    this.markRoot.scale.set(lod.systemDotScale);
  }
}
