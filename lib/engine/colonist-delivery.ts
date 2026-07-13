/**
 * Pure colonist-delivery allocation — the targeted, equalising counterpart to diffusion migration.
 *
 * Edge diffusion is a LOCAL gradient flow: it balances neighbours but is mathematically incapable of
 * reaching a colony several hops from any population (the pop puddles near the cores and never travels).
 * Colonist delivery is the fix: each pulse every sufficiently-populated developed system contributes a
 * capped slice of its DRAWABLE SPARE (idle pop above its job needs + a small staffed leak — never its
 * working population, so cores don't crater) into a faction pool, and that pool is WATER-FILLED across
 * the faction's developed systems — raising the emptiest colonies first toward a common level, capped by
 * each one's housing headroom. Because it fills the lowest, not the nearest, the frontier catches up to
 * the near colonies instead of starving: the goal is a tight distribution (mean near max), not a
 * power-law where a few near colonies hoard the flow.
 *
 * Conserved (Σ deltas = 0 per faction): what the sinks receive is exactly what the sources give.
 * Distance-agnostic within a faction for now (all territory is reachable); a topology/blockade-aware
 * routing layer — which system feeds which — layers on later without changing the allocation shape, and
 * the per-pulse {from, to} pairing it needs is the same data a migration-flow overlay would render.
 */
import type { MigrationDelta } from "@/lib/engine/migration";

/** One developed system's inputs to the allocation. */
export interface ColonistSystem {
  systemId: string;
  /** Owning faction — delivery is intra-faction. Independent systems (null) do not participate. */
  factionId: string | null;
  population: number;
  popCap: number;
  /** Heads the built base wants (Σ labour); pop above this is idle spare, the primary donatable pool. */
  labourDemand: number;
}

export interface ColonistDeliveryParams {
  /** Max fraction of its population a source contributes to the pool per pulse (paces the drain — well above the diffusion rate). */
  sourceOutflowCap: number;
  /** A system contributes/receives only once it holds at least this many people (skips freshly-seeded stubs as sources). */
  minSourcePopulation: number;
}

/**
 * Surplus a source may contribute this pulse: its IDLE SPARE — population above the jobs its built base
 * wants — rate-capped. Donating only idle spare floors a source at its labour demand, so it keeps its
 * workers and can never be drained into a death spiral; its own growth then re-donates, so reinforcement
 * is sustained rather than a one-time dump.
 */
function drawableContribution(s: ColonistSystem, params: ColonistDeliveryParams): number {
  if (s.population < params.minSourcePopulation) return 0;
  const idleSpare = Math.max(0, s.population - Math.max(0, s.labourDemand));
  return Math.min(idleSpare, params.sourceOutflowCap * s.population);
}

/**
 * Water-fill `pool` people across `sinks` (each with current `pop` and `headroom`), raising the lowest
 * toward a common level: returns the amount added to each sink (same order), Σ ≤ pool. Finds the water
 * level L by bisection — each sink takes `min(headroom, max(0, L − pop))` — then hands the tiny rounding
 * remainder to the lowest sinks so the whole affordable pool is placed. O(n · log range).
 */
function waterFill(sinks: { pop: number; headroom: number }[], pool: number): number[] {
  const add = new Array<number>(sinks.length).fill(0);
  const capacity = sinks.reduce((sum, s) => sum + Math.max(0, s.headroom), 0);
  if (pool <= 0 || capacity <= 0) return add;
  const target = Math.min(pool, capacity);

  const filledAt = (level: number): number =>
    sinks.reduce((sum, s) => sum + Math.min(Math.max(0, s.headroom), Math.max(0, level - s.pop)), 0);

  // Bisect the water level so filledAt(level) ≈ target.
  let lo = 0;
  let hi = Math.max(...sinks.map((s) => s.pop + Math.max(0, s.headroom)));
  for (let i = 0; i < 60 && hi - lo > 1e-6; i++) {
    const mid = (lo + hi) / 2;
    if (filledAt(mid) < target) lo = mid;
    else hi = mid;
  }
  const level = lo;
  let placed = 0;
  for (let i = 0; i < sinks.length; i++) {
    const a = Math.min(Math.max(0, sinks[i].headroom), Math.max(0, level - sinks[i].pop));
    add[i] = a;
    placed += a;
  }
  // Distribute the sub-level-crossing remainder to the lowest sinks with headroom left (ascending pop).
  let remainder = target - placed;
  if (remainder > 1e-6) {
    const order = sinks.map((_, i) => i).sort((a, b) => sinks[a].pop - sinks[b].pop);
    for (const i of order) {
      if (remainder <= 1e-6) break;
      const room = Math.max(0, sinks[i].headroom) - add[i];
      const take = Math.min(room, remainder);
      add[i] += take;
      remainder -= take;
    }
  }
  return add;
}

/**
 * Allocate colonists across all factions. Per faction: pool the sources' drawable spare, water-fill it
 * across the developed systems by ascending population (capped by headroom), and net it into conserved
 * deltas (sinks gain the fill; sources lose their contribution, scaled to what was actually placed).
 */
export function allocateColonists(
  systems: ColonistSystem[],
  params: ColonistDeliveryParams,
): MigrationDelta[] {
  const byFaction = new Map<string, ColonistSystem[]>();
  for (const s of systems) {
    if (s.factionId === null) continue;
    let group = byFaction.get(s.factionId);
    if (!group) {
      group = [];
      byFaction.set(s.factionId, group);
    }
    group.push(s);
  }

  const deltaBySystem = new Map<string, number>();
  const bump = (id: string, d: number) => deltaBySystem.set(id, (deltaBySystem.get(id) ?? 0) + d);

  for (const group of byFaction.values()) {
    const contributions = group.map((s) => drawableContribution(s, params));
    const pool = contributions.reduce((a, b) => a + b, 0);
    if (pool <= 0) continue;

    const sinks = group.map((s) => ({ pop: s.population, headroom: Math.max(0, s.popCap - s.population) }));
    const added = waterFill(sinks, pool);
    const placed = added.reduce((a, b) => a + b, 0);
    if (placed <= 0) continue;

    // Sources give proportionally to what was actually placed (pool may exceed total headroom).
    const scale = placed / pool;
    for (let i = 0; i < group.length; i++) {
      if (added[i] > 0) bump(group[i].systemId, added[i]);
      if (contributions[i] > 0) bump(group[i].systemId, -contributions[i] * scale);
    }
  }

  const deltas: MigrationDelta[] = [];
  for (const [systemId, delta] of deltaBySystem) if (Math.abs(delta) > 1e-9) deltas.push({ systemId, delta });
  return deltas;
}
