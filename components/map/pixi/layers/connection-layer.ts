import { Container } from "pixi.js";
import { ConnectionObject, type ConnectionDrawMode } from "../objects/connection-object";
import type { ConnectionData, SystemNodeData } from "@/lib/hooks/use-map-data";
import type { Frustum } from "../frustum";
import type { LODState } from "../lod";
import type { MapMode } from "@/lib/types/map";
import { LANE_MODE } from "../theme";

/** Sine-eased pulse: 0 at phase 0/1, 1 at phase 0.5 — a smooth breathe rather than a linear
 *  sawtooth, so the congested overlay never snaps at the loop point. */
function pulseAlphaForPhase(phase: number): number {
  return (1 - Math.cos(phase * Math.PI * 2)) / 2;
}

export class ConnectionLayer {
  readonly container = new Container();
  private objects = new Map<string, ConnectionObject>();
  /** Position cache for frustum checks and fuel label LOD */
  private positions = new Map<string, { fromX: number; fromY: number; toX: number; toY: number }>();
  /** Last-synced data per connection id, so `setHovered` can re-`update()` a single lane without a
   *  full `sync`. */
  private dataById = new Map<string, ConnectionData>();
  /** `laneKey` → connection id, so `setHovered` can find the object for a hovered lane. */
  private idByLaneKey = new Map<string, string>();
  private selectedLaneKey: string | null = null;
  private hoveredLaneKey: string | null = null;
  /** `base` draws the always-on quiet layer; `lanes` draws the Lanes map mode style. Set by
   *  `setMode`, read by every `update()` call this layer issues. */
  private drawMode: ConnectionDrawMode = "base";
  private factionColors: Map<string, number> | null = null;
  /** Connection ids currently drawing congested (`lanes` mode + `band === "congested"`) — the only
   *  ids `update(dtMs)` ever touches, never the full object map. */
  private congestedIds = new Set<string>();
  private pulseClockMs = 0;

  /** Sync all connections using system positions. `selectedLaneKey` drives the copper highlight. */
  sync(connections: ConnectionData[], systems: SystemNodeData[], selectedLaneKey: string | null = null) {
    const posMap = new Map<string, { x: number; y: number }>();
    for (const s of systems) {
      posMap.set(s.id, { x: s.x, y: s.y });
    }

    this.selectedLaneKey = selectedLaneKey;
    const incoming = new Set<string>();
    const congested = new Set<string>();

    for (const data of connections) {
      incoming.add(data.id);
      const from = posMap.get(data.fromId);
      const to = posMap.get(data.toId);
      if (!from || !to) continue;

      let obj = this.objects.get(data.id);
      if (!obj) {
        obj = new ConnectionObject();
        this.objects.set(data.id, obj);
        this.container.addChild(obj);
      }
      obj.update(data, from.x, from.y, to.x, to.y, this.stateFor(data, selectedLaneKey));
      this.positions.set(data.id, { fromX: from.x, fromY: from.y, toX: to.x, toY: to.y });
      this.dataById.set(data.id, data);
      this.idByLaneKey.set(data.laneKey, data.id);
      if (this.drawMode === "lanes" && data.band === "congested") congested.add(data.id);
    }

    // Remove stale
    for (const [id, obj] of this.objects) {
      if (!incoming.has(id)) {
        const data = this.dataById.get(id);
        if (data) this.idByLaneKey.delete(data.laneKey);
        this.container.removeChild(obj);
        obj.destroy({ children: true });
        this.objects.delete(id);
        this.positions.delete(id);
        this.dataById.delete(id);
      }
    }

    this.settleCongested(congested);
  }

  /**
   * Which map mode drives the lane draw, and the investor colours (from
   * `PoliticalTerritoryLayer.getFactionColors()`) it draws with. Re-draws every existing object from
   * cached data/positions — no re-`sync()` needed on a mode toggle.
   */
  setMode(mode: MapMode, factionColors: Map<string, number> | null) {
    const drawMode: ConnectionDrawMode = mode === "lanes" ? "lanes" : "base";
    if (drawMode === this.drawMode && factionColors === this.factionColors) return;
    this.drawMode = drawMode;
    this.factionColors = factionColors;

    const congested = new Set<string>();
    for (const [id, data] of this.dataById) {
      const pos = this.positions.get(id);
      const obj = this.objects.get(id);
      if (!obj || !pos) continue;
      obj.update(data, pos.fromX, pos.fromY, pos.toX, pos.toY, this.stateFor(data, this.selectedLaneKey));
      if (drawMode === "lanes" && data.band === "congested") congested.add(id);
    }
    this.settleCongested(congested);
  }

  /** Advances the congested-lane pulse — a per-frame alpha on each congested lane's own pulse
   *  overlay (`ConnectionObject.setPulseAlpha`), touching only `congestedIds`, never the full lane
   *  set. A no-op outside `lanes` mode or when nothing is congested. */
  update(dtMs: number) {
    if (this.drawMode !== "lanes" || this.congestedIds.size === 0) return;
    this.pulseClockMs = (this.pulseClockMs + dtMs) % LANE_MODE.pulsePeriodMs;
    const alpha = pulseAlphaForPhase(this.pulseClockMs / LANE_MODE.pulsePeriodMs);
    for (const id of this.congestedIds) {
      this.objects.get(id)?.setPulseAlpha(alpha);
    }
  }

  /** Replaces `congestedIds`, clearing the pulse overlay of any lane that just left the set (a lane
   *  no longer congested, or the mode leaving `lanes`) so it never keeps a stale pulse frozen on. */
  private settleCongested(next: Set<string>) {
    for (const id of this.congestedIds) {
      if (!next.has(id)) this.objects.get(id)?.setPulseAlpha(0);
    }
    this.congestedIds = next;
  }

  private stateFor(data: ConnectionData, selectedLaneKey: string | null) {
    const factionColor =
      this.drawMode === "lanes" && data.investorFactionId !== null
        ? this.factionColors?.get(data.investorFactionId) ?? null
        : null;
    return {
      selected: data.laneKey === selectedLaneKey,
      hovered: data.laneKey === this.hoveredLaneKey,
      mode: this.drawMode,
      factionColor,
    };
  }

  /** Re-renders only the lane leaving hover and the lane entering it, using the data/positions
   *  cached by the last `sync` — no full re-sync needed on a pointer move. */
  setHovered(laneKey: string | null) {
    if (laneKey === this.hoveredLaneKey) return;
    const previous = this.hoveredLaneKey;
    this.hoveredLaneKey = laneKey;
    this.redrawLane(previous);
    this.redrawLane(laneKey);
  }

  private redrawLane(laneKey: string | null) {
    if (laneKey === null) return;
    const id = this.idByLaneKey.get(laneKey);
    if (id === undefined) return;
    const obj = this.objects.get(id);
    const data = this.dataById.get(id);
    const pos = this.positions.get(id);
    if (!obj || !data || !pos) return;
    obj.update(data, pos.fromX, pos.fromY, pos.toX, pos.toY, this.stateFor(data, this.selectedLaneKey));
  }

  /** Per-frame visibility update: frustum culling */
  updateVisibility(frustum: Frustum, _lod: LODState, layerAlpha = 1) {
    // Skip entirely when invisible (universe view)
    this.container.alpha = layerAlpha;
    if (layerAlpha === 0) {
      this.container.visible = false;
      return;
    }
    this.container.visible = true;

    for (const [id, obj] of this.objects) {
      const pos = this.positions.get(id);
      if (!pos) { obj.visible = false; continue; }
      obj.visible = frustum.intersects(pos.fromX, pos.fromY, pos.toX, pos.toY);
    }
  }

  destroy() {
    for (const obj of this.objects.values()) {
      obj.destroy({ children: true });
    }
    this.objects.clear();
    this.positions.clear();
    this.dataById.clear();
    this.idByLaneKey.clear();
    this.congestedIds.clear();
    this.container.destroy({ children: true });
  }
}
