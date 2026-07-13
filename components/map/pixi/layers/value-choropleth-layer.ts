import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { LODState } from "../lod";
import type { Frustum } from "../frustum";
import { TERRITORY, TEXT_RESOLUTION } from "../theme";
import { valueRampColorPixi, deEmphasize, ABSENT_COLOR, type ValueMode } from "../value-ramp";
import { formatValueNumber } from "../number-format";
import {
  buildAggregationGroups, pickTier, DEFAULT_TIER_THRESHOLDS,
  type AggGroup, type AggregationTiers, type TierThresholds,
} from "../number-aggregation";
import type { SystemCells } from "../voronoi-cache";
import type { MultiPolygon } from "../territory-utils";
import type { AtlasSystem } from "@/lib/types/game";

const NUMBER_STYLE = new TextStyle({ fontSize: 30, fill: 0xf0e9df, fontFamily: "monospace", fontWeight: "600" });

// Per-system numbers read a touch larger than the aggregate tiers (they have room) and lift clear of
// the star glyph. The glyph is world-scaled (nav ring ≈ 34 world units) while the number is
// screen-constant, so the world-space lift that clears it at any zoom is ringClear + screenLift/zoom.
const SYSTEM_NUMBER_SCALE = 1.3;
const SYSTEM_NUMBER_RING_CLEAR = 36; // world units — just outside the 34-unit nav ring
const SYSTEM_NUMBER_SCREEN_LIFT = 20; // extra on-screen px so the number's base clears the glyph

// Faction-union border drawn over the value fills so political borders stay legible while a value mode
// is active. `screenWidth` is a SCREEN-pixel thickness (world width = screenWidth / zoom, redrawn on
// zoom change) so the border stays legibly thick at the zoomed-out faction view instead of thinning to a
// hairline. `alignment: 1` insets the stroke to the INSIDE of each faction's boundary so two neighbours
// sharing an edge render their own border on their own side (a centered stroke overlaps on the shared
// edge and one paints over the other). Calibration knobs, tuned in visual smoke.
const FACTION_OUTLINE = { strokeAlpha: 0.9, screenWidth: 7, alignment: 1 } as const;

// Opacity of the value-choropleth cell fills. Well above the neutral TERRITORY.fillAlpha (0.08, used by
// the political/region tints) so the value gradient reads as a vivid, saturated choropleth on the dark
// map rather than washed out. Calibration knob — tuned in visual smoke.
const VALUE_FILL_ALPHA = 0.5;

// Modes whose reference max re-normalises to the focused faction's members when a faction is in scope.
// Stability stays globally normalised even under focus — 0..1 unrest reads the same regardless of who's
// selected; pop/development re-scale so the focused faction's own brightest system reads as the top of
// the ramp.
const RESCALES_TO_SCOPE: Record<ValueMode, boolean> = {
  population: true,
  development: true,
  stability: false,
};

/**
 * Generic per-cell value choropleth: colours every system's Voronoi cell from
 * a value map (normalised against a reference max) and overlays aggregated
 * numbers at one of three zoom-gated tiers (system / faction-region /
 * faction). Replaces the population/development/stability layers, which
 * differed only in which two maps and which `ValueMode` they fed in.
 *
 * Geometry (cells) is static per atlas — cached in `sync()`. Fills and the
 * aggregation tiers are rebuilt whenever values/mode/scope change, never per
 * frame. `updateNumbers()` runs every frame (camera moves continuously) so
 * its per-frame work is limited to frustum-gating + greedy label placement
 * over already-sorted, already-filtered groups — see `rebuildTiers`.
 */
export class ValueChoroplethLayer {
  readonly container = new Container();
  private fills = new Graphics();
  private outlines = new Graphics();
  private numbers = new Container();
  private pool: Text[] = [];

  private cells: SystemCells | null = null;
  private systems: AtlasSystem[] = [];
  private factionBySystemId = new Map<string, string | null>();
  private values = new Map<string, number>();
  private reference = new Map<string, number>();
  private mode: ValueMode = "population";
  private scopeFaction: string | null = null;
  private outlineUnions: Map<string, MultiPolygon> | null = null;
  private outlineColors: Map<string, number> | null = null;
  // Camera zoom the faction outline was last stroked at — the border width is screen-constant
  // (screenWidth / zoom), so it re-strokes on a meaningful zoom change (see updateOutlineZoom).
  private outlineZoom = 1;
  private tiers: AggregationTiers = { system: [], factionRegion: [], faction: [] };
  private thresholds: TierThresholds = DEFAULT_TIER_THRESHOLDS;
  private referenceMax = 1;
  // Per-frame number placement is skipped unless the tiers, zoom, or frustum changed since the last
  // frame (numbers are static while the camera is). `numbersDirty` forces one repaint after a tier
  // rebuild or a (re)activation.
  private numbersDirty = true;
  private lastNumbersZoom = -1;
  private lastNumbersFrustum = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  constructor() {
    this.container.addChild(this.fills);
    this.container.addChild(this.outlines);
    this.container.addChild(this.numbers);
    this.container.visible = false;
  }

  setActive(active: boolean) {
    this.container.visible = active;
    if (active) this.numbersDirty = true;
  }

  /** Static geometry — call on atlas change only. */
  sync(cells: SystemCells, systems: AtlasSystem[]) {
    this.cells = cells;
    this.systems = systems;
    this.factionBySystemId = new Map(systems.map((s) => [s.id, s.factionId]));
    this.recomputeReferenceMax();
    this.drawFills();
    this.rebuildTiers();
  }

  /** Per-mode tick data. reference == values for every value mode (development is raw points, not potential). */
  setValues(values: Map<string, number>, reference: Map<string, number>, mode: ValueMode) {
    this.values = values;
    this.reference = reference;
    this.mode = mode;
    this.recomputeReferenceMax();
    this.drawFills();
    this.rebuildTiers();
  }

  /**
   * Faction focus. When set, pop/development re-normalise to the focused faction's own max (its
   * brightest system reads as the top of the ramp) and every out-of-scope cell is de-emphasised;
   * stability stays globally normalised but still dims the rest.
   */
  setScope(factionId: string | null) {
    this.scopeFaction = factionId;
    this.recomputeReferenceMax();
    this.drawFills();
  }

  /** Faction-union border over the value fills — stroke-only, exterior rings only, reusing the political
   *  layer's cached unions (no new triangulation). Static per atlas/faction sync, so it lives in its own
   *  Graphics and is NOT touched by the per-tick drawFills. */
  setFactionOutlines(unions: Map<string, MultiPolygon> | null, colors: Map<string, number> | null) {
    this.outlineUnions = unions;
    this.outlineColors = colors;
    this.drawOutlines();
  }

  private drawOutlines() {
    this.outlines.clear();
    if (!this.outlineUnions || !this.outlineColors) return;
    const width = FACTION_OUTLINE.screenWidth / (this.outlineZoom > 0 ? this.outlineZoom : 1);
    for (const [factionId, multiPoly] of this.outlineUnions) {
      const color = this.outlineColors.get(factionId);
      if (color === undefined) continue;
      for (const poly of multiPoly) {
        const exterior = poly[0];
        if (!exterior || exterior.length < 3) continue;
        this.outlines.poly(exterior.flat()).stroke({ color, alpha: FACTION_OUTLINE.strokeAlpha, width, alignment: FACTION_OUTLINE.alignment, join: "round", cap: "round" });
      }
    }
  }

  /**
   * Keep the faction border a ~constant on-screen thickness: its world width is screenWidth / zoom, so it
   * re-strokes when the camera zoom moves past a small relative band. Called per frame from the ticker
   * while a value mode is active; the band gate keeps a continuous zoom gesture to a bounded number of
   * re-strokes rather than one per frame.
   */
  updateOutlineZoom(zoom: number) {
    if (zoom <= 0 || Math.abs(zoom - this.outlineZoom) / this.outlineZoom < 0.03) return;
    this.outlineZoom = zoom;
    this.drawOutlines();
  }

  private recomputeReferenceMax() {
    const scoped = this.scopeFaction != null && RESCALES_TO_SCOPE[this.mode];
    const members = scoped
      ? this.systems.filter((s) => s.factionId === this.scopeFaction)
      : this.systems;
    let max = 0;
    for (const s of members) max = Math.max(max, this.reference.get(s.id) ?? 0);
    this.referenceMax = max > 0 ? max : 1;
  }

  private drawFills() {
    if (!this.cells) return;
    this.fills.clear();
    for (const [id, multiPoly] of this.cells.cellsBySystemId) {
      // A cell absent from the value map is "nothing here" → black; a present system rides its ramp
      // (so an unstable-but-present system reads red, not black).
      const value = this.values.get(id);
      let color =
        value === undefined ? ABSENT_COLOR : valueRampColorPixi(value, this.referenceMax, this.mode);
      // Faction focus dims every out-of-scope cell, in every mode — independent of whether the mode
      // rescales its reference max. The absent check above always wins: never dim a black cell.
      if (color !== ABSENT_COLOR && this.scopeFaction != null && this.factionBySystemId.get(id) !== this.scopeFaction) {
        color = deEmphasize(color, "both");
      }
      for (const poly of multiPoly) {
        const exterior = poly[0];
        if (!exterior || exterior.length < 3) continue;
        const flat = exterior.flat();
        this.fills.poly(flat).fill({ color, alpha: VALUE_FILL_ALPHA });
        this.fills.poly(flat).stroke({ color, alpha: TERRITORY.strokeAlpha, width: TERRITORY.strokeWidth });
      }
    }
  }

  /**
   * Rebuild the three aggregation tiers from the current values/mode.
   *
   * Pre-sorts each tier's groups by value descending and pre-filters the
   * system tier to value > 0 (empty cells carry no number) HERE, not in
   * `updateNumbers`. This only changes when values/mode change (setValues) —
   * not per frame — so the sort/filter allocation happens once instead of on
   * every camera tick. `updateNumbers` then just walks the already-ordered
   * arrays, frustum-gating and greedily placing labels.
   */
  private rebuildTiers() {
    const raw = buildAggregationGroups(this.systems, this.values, this.mode);
    this.tiers = {
      system: raw.system.filter((g) => g.value > 0).sort((a, b) => b.value - a.value),
      factionRegion: raw.factionRegion.sort((a, b) => b.value - a.value),
      faction: raw.faction.sort((a, b) => b.value - a.value),
    };
    this.numbersDirty = true;
  }

  private lease(i: number): Text {
    let t = this.pool[i];
    if (!t) {
      t = new Text({ text: "", style: NUMBER_STYLE, resolution: TEXT_RESOLUTION });
      t.anchor.set(0.5);
      this.pool[i] = t;
      this.numbers.addChild(t);
    }
    return t;
  }

  /** Per-frame: choose tier by zoom, place pooled Text with frustum-gating + greedy collision avoidance. */
  updateNumbers(zoom: number, frustum: Frustum) {
    // Numbers are static while the camera is: skip the whole placement pass unless the tiers,
    // zoom, or frustum changed since the last frame.
    const f = this.lastNumbersFrustum;
    if (
      !this.numbersDirty &&
      zoom === this.lastNumbersZoom &&
      frustum.minX === f.minX && frustum.minY === f.minY &&
      frustum.maxX === f.maxX && frustum.maxY === f.maxY
    ) {
      return;
    }
    this.numbersDirty = false;
    this.lastNumbersZoom = zoom;
    f.minX = frustum.minX; f.minY = frustum.minY; f.maxX = frustum.maxX; f.maxY = frustum.maxY;

    const tier = pickTier(zoom, this.thresholds);
    const groups: AggGroup[] =
      tier === "system" ? this.tiers.system
      : tier === "faction-region" ? this.tiers.factionRegion
      : this.tiers.faction;

    // System numbers sit larger and lift above the star glyph so they don't overlap it; the
    // aggregate tiers (faction/region totals) sit on the group centroid.
    const isSystemTier = tier === "system";
    const scale = (isSystemTier ? SYSTEM_NUMBER_SCALE : 1) / zoom;
    const oy = isSystemTier ? SYSTEM_NUMBER_RING_CLEAR + SYSTEM_NUMBER_SCREEN_LIFT / zoom : 0;
    const boxScale = isSystemTier ? SYSTEM_NUMBER_SCALE : 1;

    // groups is already sorted value-descending by rebuildTiers — iterate in
    // place, no per-frame sort/allocation of the candidate list itself.
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    let used = 0;
    for (const g of groups) {
      if (!frustum.contains(g.cx, g.cy)) continue;
      const cy = g.cy - oy;
      const w = (90 * boxScale) / zoom, h = (44 * boxScale) / zoom; // world-space box ≈ constant screen size
      const box = { x: g.cx - w / 2, y: cy - h / 2, w, h };
      if (placed.some((p) => box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y)) continue;
      placed.push(box);
      const t = this.lease(used++);
      t.text = formatValueNumber(g.value, this.mode);
      t.position.set(g.cx, cy);
      t.scale.set(scale); // keep numbers a stable on-screen size
      t.visible = true;
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i].visible = false;
  }

  updateVisibility(lod: LODState) {
    if (!this.container.visible) return;
    this.fills.alpha = lod.valueChoroplethAlpha;
    this.outlines.alpha = lod.valueChoroplethAlpha;
  }

  destroy() {
    for (const t of this.pool) t.destroy();
    this.fills.destroy();
    this.outlines.destroy();
    this.numbers.destroy({ children: true });
    this.container.destroy({ children: true });
  }
}
