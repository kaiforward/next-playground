import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { LODState } from "../lod";
import type { Frustum } from "../frustum";
import { TERRITORY, TEXT_RESOLUTION } from "../theme";
import { valueRampColorPixi, type ValueMode } from "../value-ramp";
import {
  buildAggregationGroups, pickTier, DEFAULT_TIER_THRESHOLDS,
  type AggGroup, type AggregationTiers, type TierThresholds,
} from "../number-aggregation";
import type { SystemCells } from "../voronoi-cache";
import type { AtlasSystem } from "@/lib/types/game";

const NUMBER_STYLE = new TextStyle({ fontSize: 28, fill: 0xf0e9df, fontFamily: "monospace", fontWeight: "600" });

/** Compact SI-ish formatting for population; 0..1 scores render ×100. */
function formatNumber(value: number, mode: ValueMode): string {
  if (mode === "population") {
    if (value >= 1e6) return `${(value / 1e6).toFixed(value < 1e7 ? 1 : 0)}M`;
    if (value >= 1e3) return `${Math.round(value / 1e3)}K`;
    return `${Math.round(value)}`;
  }
  return `${Math.round(value * 100)}`;
}

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
  private numbers = new Container();
  private pool: Text[] = [];

  private cells: SystemCells | null = null;
  private systems: AtlasSystem[] = [];
  private values = new Map<string, number>();
  private reference = new Map<string, number>();
  private mode: ValueMode = "population";
  private scopeFaction: string | null = null;
  private tiers: AggregationTiers = { system: [], factionRegion: [], faction: [] };
  private thresholds: TierThresholds = DEFAULT_TIER_THRESHOLDS;
  private referenceMax = 1;

  constructor() {
    this.container.addChild(this.fills);
    this.container.addChild(this.numbers);
    this.container.visible = false;
  }

  setActive(active: boolean) { this.container.visible = active; }

  /** Static geometry — call on atlas change only. */
  sync(cells: SystemCells, systems: AtlasSystem[]) {
    this.cells = cells;
    this.systems = systems;
    this.recomputeReferenceMax();
    this.drawFills();
    this.rebuildTiers();
  }

  /** Per-mode tick data. reference == values for pop/stability; == potential for development. */
  setValues(values: Map<string, number>, reference: Map<string, number>, mode: ValueMode) {
    this.values = values;
    this.reference = reference;
    this.mode = mode;
    this.recomputeReferenceMax();
    this.drawFills();
    this.rebuildTiers();
  }

  /** Phase 1: global only. Phase 2 re-normalises to a faction and de-emphasises the rest. */
  setScope(factionId: string | null) {
    this.scopeFaction = factionId;
    this.recomputeReferenceMax();
    this.drawFills();
  }

  private scopeMembers(): AtlasSystem[] {
    return this.scopeFaction == null
      ? this.systems
      : this.systems.filter((s) => s.factionId === this.scopeFaction);
  }

  private recomputeReferenceMax() {
    let max = 0;
    for (const s of this.scopeMembers()) max = Math.max(max, this.reference.get(s.id) ?? 0);
    this.referenceMax = max > 0 ? max : 1;
  }

  private drawFills() {
    if (!this.cells) return;
    this.fills.clear();
    for (const [id, multiPoly] of this.cells.cellsBySystemId) {
      const color = valueRampColorPixi(this.values.get(id) ?? 0, this.referenceMax, this.mode);
      for (const poly of multiPoly) {
        const exterior = poly[0];
        if (!exterior || exterior.length < 3) continue;
        const flat = exterior.flat();
        this.fills.poly(flat).fill({ color, alpha: TERRITORY.fillAlpha + 0.12 });
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
    const tier = pickTier(zoom, this.thresholds);
    const groups: AggGroup[] =
      tier === "system" ? this.tiers.system
      : tier === "faction-region" ? this.tiers.factionRegion
      : this.tiers.faction;

    // groups is already sorted value-descending by rebuildTiers — iterate in
    // place, no per-frame sort/allocation of the candidate list itself.
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    let used = 0;
    for (const g of groups) {
      if (!frustum.contains(g.cx, g.cy)) continue;
      const w = 90 / zoom, h = 44 / zoom; // world-space box ≈ constant screen size
      const box = { x: g.cx - w / 2, y: g.cy - h / 2, w, h };
      if (placed.some((p) => box.x < p.x + p.w && box.x + box.w > p.x && box.y < p.y + p.h && box.y + box.h > p.y)) continue;
      placed.push(box);
      const t = this.lease(used++);
      t.text = formatNumber(g.value, this.mode);
      t.position.set(g.cx, g.cy);
      t.scale.set(1 / zoom); // keep numbers a stable on-screen size
      t.visible = true;
    }
    for (let i = used; i < this.pool.length; i++) this.pool[i].visible = false;
  }

  updateVisibility(lod: LODState) {
    if (!this.container.visible) return;
    this.fills.alpha = lod.territoryAlpha;
  }

  destroy() {
    for (const t of this.pool) t.destroy();
    this.fills.destroy();
    this.numbers.destroy({ children: true });
    this.container.destroy({ children: true });
  }
}
