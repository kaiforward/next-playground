/**
 * Faction generation — pure functions, zero DB dependency.
 *
 * Seeds 8 majors (one per government, sourced from FACTION_ROSTER) plus N minors
 * with archetype-respecting placement. Then flood-fills system ownership from
 * each faction's homeworld via jump-lane hops.
 *
 * See docs/design/active/faction-system.md §6 + §7.1 for the design intent.
 */

import type { Doctrine, EconomyType, GovernmentType, ResourceVector } from "@/lib/types/game";
import { ALL_DOCTRINES, ALL_GOVERNMENT_TYPES, toDoctrine, toGovernmentType } from "@/lib/types/guards";
import {
  FACTION_ROSTER,
  MINOR_ADJECTIVES,
  MINOR_NOUNS,
  MINOR_ARCHETYPE_DISTRIBUTION,
  HOMEWORLD_PLACEMENT,
  type MinorFactionArchetype,
} from "@/lib/constants/factions";
import { RESOURCE_TYPES } from "@/lib/engine/resources";
import type {
  RNG,
  GeneratedConnection,
  GeneratedRegion,
  GeneratedSystem,
} from "./universe-gen";
import { distance, randInt } from "./universe-gen";

// ── Output types ────────────────────────────────────────────────

export interface GeneratedFaction {
  /** Position in the faction list. */
  index: number;
  /** Stable key — `FACTION_ROSTER[i].key` for majors, `minor_${i}` for minors. */
  key: string;
  name: string;
  description: string;
  governmentType: GovernmentType;
  doctrine: Doctrine;
  color: string;
  isMajor: boolean;
  /** null for majors; one of the four placement archetypes for minors. */
  archetype: MinorFactionArchetype | null;
  /** Index into `systems` — the faction's capital. */
  homeworldSystemIndex: number;
}

// ── Configuration ───────────────────────────────────────────────

export interface FactionGenParams {
  /** Number of minor factions to procedurally generate. */
  minorFactionCount: number;
  /** Map size — used for frontier-archetype edge detection. */
  mapSize: number;
  /** Minimum starting territory per minor faction (enforced after flood-fill). */
  minMinorTerritory: number;
}

// ── Doctrine tiebreak ordering ──────────────────────────────────

/**
 * Higher rank wins contested-system tiebreaks. Mirrors faction-system.md §2
 * doctrine-incompatibility narrative — expansionist factions push hardest into
 * contested territory, protectionist factions cede borderline systems.
 */
const DOCTRINE_RANK: Record<Doctrine, number> = {
  expansionist: 4,
  opportunistic: 3,
  hegemonic: 2,
  mercantile: 1,
  protectionist: 0,
} as const;

// ── Faction generation ──────────────────────────────────────────

/**
 * Generate the full faction roster: 8 majors with anchor-region homeworlds plus
 * `minorFactionCount` procedurally placed minors. Output order is majors first
 * (in FACTION_ROSTER order), then minors grouped by archetype.
 */
export function generateFactions(
  rng: RNG,
  regions: GeneratedRegion[],
  systems: GeneratedSystem[],
  params: FactionGenParams,
): GeneratedFaction[] {
  const factions: GeneratedFaction[] = [];

  // ── Majors: one anchor region per major, well-spread ──────────
  const anchorRegions = pickAnchorRegions(rng, regions, FACTION_ROSTER.length);
  const usedHomeworlds = new Set<number>();

  for (let i = 0; i < FACTION_ROSTER.length; i++) {
    const def = FACTION_ROSTER[i];
    const anchor = anchorRegions[i];
    const homeworldIndex = selectHomeworld(systems, anchor.index, usedHomeworlds);
    usedHomeworlds.add(homeworldIndex);

    factions.push({
      index: i,
      key: def.key,
      name: def.name,
      description: def.description,
      governmentType: def.governmentType,
      doctrine: def.doctrine,
      color: def.color,
      isMajor: true,
      archetype: null,
      homeworldSystemIndex: homeworldIndex,
    });
  }

  // ── Minors: archetype-respecting placement ────────────────────
  const archetypeCounts = computeArchetypeCounts(params.minorFactionCount);
  const usedMinorNames = new Set<string>();
  const majorHomeworlds = factions.map((f) => f.homeworldSystemIndex);
  // Hue accumulator — seeded with major colors, appended per minor placement.
  // Avoids re-deriving hues from the full faction list on every minor pick.
  const usedHues: number[] = factions.map((f) => hexToHue(f.color));

  for (const { archetype, count } of archetypeCounts) {
    for (let k = 0; k < count; k++) {
      const anchorSystemIndex = pickMinorAnchor(
        rng,
        archetype,
        regions,
        systems,
        majorHomeworlds,
        usedHomeworlds,
        params.mapSize,
      );
      usedHomeworlds.add(anchorSystemIndex);

      const index = factions.length;
      const color = makeMinorColor(rng, usedHues);
      usedHues.push(hexToHue(color));
      factions.push({
        index,
        key: `minor_${index}`,
        name: makeMinorName(rng, usedMinorNames),
        description: "",
        governmentType: pickRandomGovernment(rng),
        doctrine: pickRandomDoctrine(rng),
        color,
        isMajor: false,
        archetype,
        homeworldSystemIndex: anchorSystemIndex,
      });
    }
  }

  return factions;
}

// ── Homeworld placement (spaced + seed-biased) ──────────────────

function homeworldTraitQuality(s: GeneratedSystem): number {
  let q = 0;
  for (const t of s.traits) q += t.quality;
  return q;
}

/** Count of resources this system has any deposit slot for — the "resource diversity" term. */
function homeworldResourceDiversity(slotCap: ResourceVector): number {
  let n = 0;
  for (const r of RESOURCE_TYPES) if (slotCap[r] > 0) n++;
  return n;
}

/**
 * Pick one well-spaced, high-substrate homeworld per faction. Score = weighted sum
 * of normalized (habitable base, resource diversity, trait quality) minus normalized
 * danger; greedy-select highest score first, requiring each pick to sit at least the
 * spacing threshold from all prior picks. The threshold relaxes on failure so a dense
 * galaxy degrades to "as spaced as it can be" rather than throwing. Deterministic:
 * scores derive from already-seeded substrate; ties break on index.
 */
export function placeHomeworlds(systems: GeneratedSystem[], count: number, mapSize: number): number[] {
  if (count <= 0 || systems.length === 0) return [];

  let maxHab = 1, maxDanger = 1, maxTrait = 1;
  for (const s of systems) {
    if (s.habitableSpace > maxHab) maxHab = s.habitableSpace;
    if (s.bodyDanger > maxDanger) maxDanger = s.bodyDanger;
    const tq = homeworldTraitQuality(s);
    if (tq > maxTrait) maxTrait = tq;
  }

  const w = HOMEWORLD_PLACEMENT.SCORE_WEIGHTS;
  const scored = systems
    .map((s) => ({
      idx: s.index,
      x: s.x,
      y: s.y,
      score:
        w.habitable * (s.habitableSpace / maxHab) +
        w.diversity * (homeworldResourceDiversity(s.slotCap) / RESOURCE_TYPES.length) +
        w.trait * (homeworldTraitQuality(s) / maxTrait) -
        w.danger * (s.bodyDanger / maxDanger),
    }))
    .sort((a, b) => b.score - a.score || a.idx - b.idx);

  let threshold = mapSize * HOMEWORLD_PLACEMENT.MIN_DISTANCE_FRACTION;
  for (let step = 0; step <= HOMEWORLD_PLACEMENT.MAX_RELAX_STEPS; step++) {
    const picked: { idx: number; x: number; y: number }[] = [];
    for (const c of scored) {
      if (picked.length === count) break;
      if (picked.every((p) => distance(c.x, c.y, p.x, p.y) >= threshold)) picked.push(c);
    }
    if (picked.length === count) return picked.map((p) => p.idx);
    threshold *= HOMEWORLD_PLACEMENT.RELAX_RATE;
  }
  // Fully relaxed and still short (fewer than `count` spaceable systems) → take the top-scoring.
  return scored.slice(0, count).map((p) => p.idx);
}

// ── Anchor region selection (max-distance sampling) ─────────────

function pickAnchorRegions(
  rng: RNG,
  regions: GeneratedRegion[],
  count: number,
): GeneratedRegion[] {
  if (regions.length < count) {
    throw new Error(
      `Cannot place ${count} major anchor regions in ${regions.length} regions; bump REGION_COUNT.`,
    );
  }

  const picked: GeneratedRegion[] = [];
  const pickedSet = new Set<GeneratedRegion>();
  // First anchor: random
  const firstIdx = Math.floor(rng() * regions.length);
  picked.push(regions[firstIdx]);
  pickedSet.add(regions[firstIdx]);

  // Subsequent anchors: maximize min-distance to already-picked
  while (picked.length < count) {
    let bestRegion = regions[0];
    let bestScore = -Infinity;
    for (const r of regions) {
      if (pickedSet.has(r)) continue;
      let minDist = Infinity;
      for (const p of picked) {
        const d = distance(r.x, r.y, p.x, p.y);
        if (d < minDist) minDist = d;
      }
      if (minDist > bestScore) {
        bestScore = minDist;
        bestRegion = r;
      }
    }
    picked.push(bestRegion);
    pickedSet.add(bestRegion);
  }

  return picked;
}

// ── Homeworld selection ─────────────────────────────────────────

/**
 * Highest aggregate trait quality in the region wins, ties broken by position
 * (x+y) for determinism. Excludes systems already claimed as a homeworld.
 */
function selectHomeworld(
  systems: GeneratedSystem[],
  regionIndex: number,
  used: Set<number>,
): number {
  const candidates = systems.filter(
    (s) => s.regionIndex === regionIndex && !used.has(s.index),
  );
  if (candidates.length === 0) {
    // Fallback: any unclaimed system. Shouldn't happen with REGION_COUNT >= 8.
    const fallback = systems.find((s) => !used.has(s.index));
    if (!fallback) throw new Error("No unclaimed systems available for homeworld");
    return fallback.index;
  }

  let best = candidates[0];
  let bestScore = scoreHomeworldCandidate(best);
  for (const s of candidates) {
    const score = scoreHomeworldCandidate(s);
    if (
      score > bestScore ||
      (score === bestScore && s.x + s.y < best.x + best.y)
    ) {
      best = s;
      bestScore = score;
    }
  }
  return best.index;
}

function scoreHomeworldCandidate(sys: GeneratedSystem): number {
  // Aggregate trait quality + core-economy bias. Matches "highest-prosperity-traits"
  // from the plan; the bias keeps faction capitals on richer-than-frontier worlds.
  let score = sys.traits.reduce((sum, t) => sum + t.quality, 0);
  if (sys.economyType === "core") score += 5;
  if (sys.economyType === "industrial" || sys.economyType === "tech") score += 2;
  return score;
}

// ── Minor archetype counts ──────────────────────────────────────

interface ArchetypeAllocation {
  archetype: MinorFactionArchetype;
  count: number;
}

function computeArchetypeCounts(total: number): ArchetypeAllocation[] {
  // ceil(N × proportion) for buffer/frontier/enclave; cluster absorbs the rest
  // so the totals match `total` exactly. Cluster gets at least 1 if any minors
  // are configured at all (per design — clusters are the "natural alliance"
  // archetype that needs at least 2 to express the pattern, but we don't
  // require 2 — a 1-faction cluster is fine).
  const counts: ArchetypeAllocation[] = [];
  let remaining = total;
  for (const { archetype, proportion } of MINOR_ARCHETYPE_DISTRIBUTION) {
    if (archetype === "cluster") {
      counts.push({ archetype, count: Math.max(0, remaining) });
      remaining = 0;
    } else {
      const allocated = Math.min(remaining, Math.ceil(total * proportion));
      counts.push({ archetype, count: allocated });
      remaining -= allocated;
    }
  }
  return counts;
}

// ── Minor anchor placement (archetype-driven) ───────────────────

function pickMinorAnchor(
  rng: RNG,
  archetype: MinorFactionArchetype,
  regions: GeneratedRegion[],
  systems: GeneratedSystem[],
  majorHomeworlds: number[],
  used: Set<number>,
  mapSize: number,
): number {
  switch (archetype) {
    case "buffer":
      return pickBufferAnchor(rng, systems, majorHomeworlds, used);
    case "frontier":
      return pickFrontierAnchor(rng, systems, majorHomeworlds, used, mapSize);
    case "enclave":
      return pickEnclaveAnchor(rng, regions, systems, majorHomeworlds, used);
    case "cluster":
      return pickClusterAnchor(rng, systems, majorHomeworlds, used);
  }
}

/** Between two majors: pick the system closest to the midpoint of two major homeworlds. */
function pickBufferAnchor(
  rng: RNG,
  systems: GeneratedSystem[],
  majorHomeworlds: number[],
  used: Set<number>,
): number {
  const a = systems[majorHomeworlds[randInt(rng, 0, majorHomeworlds.length - 1)]];
  let b = systems[majorHomeworlds[randInt(rng, 0, majorHomeworlds.length - 1)]];
  // Re-roll a few times to avoid (a === b); pure idempotence isn't required since
  // we still get a valid placement either way.
  for (let i = 0; i < 5 && a.index === b.index; i++) {
    b = systems[majorHomeworlds[randInt(rng, 0, majorHomeworlds.length - 1)]];
  }
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  return findNearestUnused(systems, midX, midY, used);
}

/** Map edge: pick the unclaimed system with the largest distance from map center. */
function pickFrontierAnchor(
  rng: RNG,
  systems: GeneratedSystem[],
  _majorHomeworlds: number[],
  used: Set<number>,
  mapSize: number,
): number {
  const center = mapSize / 2;
  // Rank by distance from center, then weighted-pick from the top 20% to keep
  // multiple frontier minors from clumping on the same single furthest system.
  const ranked = systems
    .filter((s) => !used.has(s.index))
    .map((s) => ({ s, score: distance(s.x, s.y, center, center) }))
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) {
    throw new Error("No unclaimed systems available for frontier anchor");
  }
  const poolSize = Math.max(1, Math.floor(ranked.length * 0.2));
  return ranked[randInt(rng, 0, poolSize - 1)].s.index;
}

/** Within one major: pick an unclaimed system in a random major's anchor region. */
function pickEnclaveAnchor(
  rng: RNG,
  _regions: GeneratedRegion[],
  systems: GeneratedSystem[],
  majorHomeworlds: number[],
  used: Set<number>,
): number {
  const target = systems[majorHomeworlds[randInt(rng, 0, majorHomeworlds.length - 1)]];
  // Same region as the chosen major, excluding the major's homeworld itself.
  const candidates = systems.filter(
    (s) => s.regionIndex === target.regionIndex && !used.has(s.index),
  );
  if (candidates.length === 0) {
    // Fallback: nearest unused system to that major.
    return findNearestUnused(systems, target.x, target.y, used);
  }
  return candidates[randInt(rng, 0, candidates.length - 1)].index;
}

/** Cluster: pick any unclaimed system far enough from all majors to feel its own. */
function pickClusterAnchor(
  rng: RNG,
  systems: GeneratedSystem[],
  majorHomeworlds: number[],
  used: Set<number>,
): number {
  // Score = min distance to any major homeworld. Pick from the top 30% to
  // produce a "naturally clustered" placement that doesn't crowd a major.
  const ranked = systems
    .filter((s) => !used.has(s.index))
    .map((s) => {
      let minD = Infinity;
      for (const hwIdx of majorHomeworlds) {
        const hw = systems[hwIdx];
        const d = distance(s.x, s.y, hw.x, hw.y);
        if (d < minD) minD = d;
      }
      return { s, score: minD };
    })
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) {
    throw new Error("No unclaimed systems available for cluster anchor");
  }
  const poolSize = Math.max(1, Math.floor(ranked.length * 0.3));
  return ranked[randInt(rng, 0, poolSize - 1)].s.index;
}

function findNearestUnused(
  systems: GeneratedSystem[],
  x: number,
  y: number,
  used: Set<number>,
): number {
  let bestIdx = -1;
  let bestDist = Infinity;
  for (const s of systems) {
    if (used.has(s.index)) continue;
    const d = distance(s.x, s.y, x, y);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = s.index;
    }
  }
  if (bestIdx === -1) {
    throw new Error("No unclaimed systems available for placement");
  }
  return bestIdx;
}

// ── Procedural minor naming ─────────────────────────────────────

function makeMinorName(rng: RNG, used: Set<string>): string {
  const maxAttempts = 50;
  for (let i = 0; i < maxAttempts; i++) {
    const adj = MINOR_ADJECTIVES[randInt(rng, 0, MINOR_ADJECTIVES.length - 1)];
    const noun = MINOR_NOUNS[randInt(rng, 0, MINOR_NOUNS.length - 1)];
    const name = `${adj} ${noun}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  // Defensive fallback — pool collision exhausted (unlikely with 30×20 pool).
  let suffix = 1;
  while (used.has(`Minor Faction ${suffix}`)) suffix++;
  const fallback = `Minor Faction ${suffix}`;
  used.add(fallback);
  return fallback;
}

// ── Procedural minor coloring ───────────────────────────────────

function makeMinorColor(rng: RNG, usedHues: number[]): string {
  // Hash-spread hues, lower saturation/lightness than majors so minor territory
  // reads as politically secondary. Rejection-sample for sufficient hue distance
  // from already-placed colors to maintain legibility on the political map.
  const maxAttempts = 20;

  for (let i = 0; i < maxAttempts; i++) {
    const hue = Math.floor(rng() * 360);
    const tooClose = usedHues.some((h) => hueDistance(h, hue) < 20);
    if (!tooClose) return hslToHex(hue, 0.45, 0.45);
  }
  // Accept anything if we exhausted attempts (still distinct enough on the map).
  return hslToHex(Math.floor(rng() * 360), 0.4, 0.4);
}

function hexToHue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const toHex = (v: number) =>
    Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ── Random government / doctrine for minors ─────────────────────

function pickRandomGovernment(rng: RNG): GovernmentType {
  return toGovernmentType(ALL_GOVERNMENT_TYPES[randInt(rng, 0, ALL_GOVERNMENT_TYPES.length - 1)]);
}

function pickRandomDoctrine(rng: RNG): Doctrine {
  return toDoctrine(ALL_DOCTRINES[randInt(rng, 0, ALL_DOCTRINES.length - 1)]);
}

// ── System ownership flood-fill ─────────────────────────────────

/**
 * Assign every system to a faction via multi-source BFS from each homeworld.
 * Closest-hops wins; ties broken by doctrine rank then by faction name.
 *
 * Post-process: any minor below `minMinorTerritory` claims the nearest systems
 * from its largest neighbor until it hits the floor. Majors absorb the cost.
 */
export function assignSystemFactions(
  systems: GeneratedSystem[],
  connections: GeneratedConnection[],
  factions: GeneratedFaction[],
  params: { minMinorTerritory: number },
): number[] {
  const n = systems.length;
  // Build adjacency from system index → neighbor indices.
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const c of connections) {
    adj[c.fromSystemIndex].push(c.toSystemIndex);
  }

  // For each system: (factionIndex, hopDistance) — start with homeworlds.
  const ownerOf: number[] = new Array(n).fill(-1);
  const hopsOf: number[] = new Array(n).fill(Infinity);

  // Each layer holds systems claimed at this hop distance. BFS expands all
  // factions simultaneously: a system tied between two homeworlds at the same
  // hop count goes to the doctrine-priority winner, mirroring the design intent
  // that expansionist factions push hardest into contested space.
  let frontier: number[] = [];
  for (const f of factions) {
    const hw = f.homeworldSystemIndex;
    if (ownerOf[hw] === -1 || beatsTiebreak(factions, f.index, ownerOf[hw])) {
      ownerOf[hw] = f.index;
      hopsOf[hw] = 0;
    }
  }
  // Seed frontier from claimed homeworlds.
  for (let i = 0; i < n; i++) {
    if (ownerOf[i] !== -1) frontier.push(i);
  }

  let currentHops = 0;
  while (frontier.length > 0) {
    currentHops++;
    const nextFrontier: number[] = [];
    // Tentative claims at this layer — resolved via tiebreak before commit.
    const tentative = new Map<number, number>(); // systemIdx → factionIdx

    for (const sysIdx of frontier) {
      const ownerFaction = ownerOf[sysIdx];
      for (const nbr of adj[sysIdx]) {
        if (ownerOf[nbr] !== -1) continue;
        const prev = tentative.get(nbr);
        if (prev === undefined || beatsTiebreak(factions, ownerFaction, prev)) {
          tentative.set(nbr, ownerFaction);
        }
      }
    }

    for (const [sysIdx, factionIdx] of tentative) {
      ownerOf[sysIdx] = factionIdx;
      hopsOf[sysIdx] = currentHops;
      nextFrontier.push(sysIdx);
    }
    frontier = nextFrontier;
  }

  // Any remaining unclaimed (disconnected components) — assign to nearest faction
  // by Euclidean distance to its homeworld. Defensive; shouldn't trigger under
  // current world-gen which guarantees a connected gateway graph.
  for (let i = 0; i < n; i++) {
    if (ownerOf[i] !== -1) continue;
    let bestFaction = 0;
    let bestDist = Infinity;
    for (const f of factions) {
      const hw = systems[f.homeworldSystemIndex];
      const d = distance(systems[i].x, systems[i].y, hw.x, hw.y);
      if (d < bestDist) {
        bestDist = d;
        bestFaction = f.index;
      }
    }
    ownerOf[i] = bestFaction;
  }

  enforceMinorMinimum(systems, ownerOf, factions, params.minMinorTerritory);

  return ownerOf;
}

/** Return true if faction `a` outranks faction `b` for contested-system tiebreaks. */
function beatsTiebreak(
  factions: GeneratedFaction[],
  a: number,
  b: number,
): boolean {
  const fa = factions[a];
  const fb = factions[b];
  const rankA = DOCTRINE_RANK[fa.doctrine];
  const rankB = DOCTRINE_RANK[fb.doctrine];
  if (rankA !== rankB) return rankA > rankB;
  // Alphabetic — purely deterministic, no design weight.
  return fa.name.localeCompare(fb.name) < 0;
}

/**
 * If any minor finishes flood-fill with fewer than `minTerritory` systems, flip
 * its closest non-owned systems away from the largest *non-minor* neighbor until
 * it reaches the floor. Walks systems by Euclidean distance from the minor's
 * homeworld — cheap and "looks right" on the map; not jump-distance-optimal.
 */
function enforceMinorMinimum(
  systems: GeneratedSystem[],
  ownerOf: number[],
  factions: GeneratedFaction[],
  minTerritory: number,
): void {
  const sizeByFaction = new Map<number, number>();
  for (const o of ownerOf) sizeByFaction.set(o, (sizeByFaction.get(o) ?? 0) + 1);

  for (const minor of factions) {
    if (minor.isMajor) continue;
    let size = sizeByFaction.get(minor.index) ?? 0;
    if (size >= minTerritory) continue;

    const hw = systems[minor.homeworldSystemIndex];
    // Order systems by distance to the minor's homeworld; flip closest first.
    const ordered = systems
      .map((s) => ({ idx: s.index, d: distance(s.x, s.y, hw.x, hw.y) }))
      .sort((a, b) => a.d - b.d);

    for (const { idx } of ordered) {
      if (size >= minTerritory) break;
      const currentOwner = ownerOf[idx];
      if (currentOwner === minor.index) continue;
      const ownerFaction = factions[currentOwner];
      // Only take from majors — never strip another minor below its floor.
      if (!ownerFaction.isMajor) continue;
      ownerOf[idx] = minor.index;
      sizeByFaction.set(minor.index, ++size);
      sizeByFaction.set(currentOwner, (sizeByFaction.get(currentOwner) ?? 0) - 1);
    }
  }
}

// ── Dominant economy derivation ─────────────────────────────────

/**
 * Mode of `economyType` across a region's systems. Used at seed time and
 * reserved for the conquest hook (lands with the war system).
 * Ties broken alphabetically for determinism.
 */
export function deriveDominantEconomy(
  systems: { economyType: EconomyType }[],
): EconomyType {
  if (systems.length === 0) return "extraction";
  const counts = new Map<EconomyType, number>();
  for (const s of systems) {
    counts.set(s.economyType, (counts.get(s.economyType) ?? 0) + 1);
  }
  let best: EconomyType = "extraction";
  let bestCount = 0;
  for (const [econ, count] of counts) {
    if (count > bestCount || (count === bestCount && econ < best)) {
      best = econ;
      bestCount = count;
    }
  }
  return best;
}
