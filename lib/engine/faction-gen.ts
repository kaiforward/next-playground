/**
 * Faction generation — pure functions, zero DB dependency.
 *
 * Builds the roster (8 majors from FACTION_ROSTER + N procedurally-named minors),
 * then places one spaced, seed-biased homeworld per faction. Majors and minors are
 * placed identically — major/minor dominance emerges from expansion, not seeding.
 * Ownership at world-gen is homeworld-only; every other system starts unclaimed.
 *
 * See docs/active/gameplay/faction-system.md for the design intent.
 */

import type { Doctrine, EconomyType, GovernmentType, ResourceVector } from "@/lib/types/game";
import { ALL_DOCTRINES, ALL_GOVERNMENT_TYPES, toDoctrine, toGovernmentType } from "@/lib/types/guards";
import {
  FACTION_ROSTER,
  MINOR_ADJECTIVES,
  MINOR_NOUNS,
  HOMEWORLD_PLACEMENT,
} from "@/lib/constants/factions";
import { RESOURCE_TYPES } from "@/lib/engine/resources";
import type { RNG, GeneratedSystem } from "./universe-gen";
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
  /** Index into `systems` — the faction's single developed homeworld. */
  homeworldSystemIndex: number;
}

// ── Configuration ───────────────────────────────────────────────

export interface FactionGenParams {
  /** Number of minor factions to procedurally generate. */
  minorFactionCount: number;
  /** Map size — sets the homeworld spacing threshold. */
  mapSize: number;
}

// ── Faction generation ──────────────────────────────────────────

/**
 * Generate the faction roster (8 majors from FACTION_ROSTER + `minorFactionCount`
 * procedurally-named minors), then place one spaced, seed-biased homeworld per
 * faction. Majors and minors get identical treatment — status (major/minor
 * dominance) emerges from expansion, not seeding. Identities only differ by
 * name/government/doctrine/color.
 */
export function generateFactions(
  rng: RNG,
  systems: GeneratedSystem[],
  params: FactionGenParams,
): GeneratedFaction[] {
  const factions: GeneratedFaction[] = [];
  const usedHues: number[] = [];

  // ── Majors: one per government, from the fixed roster ──
  for (let i = 0; i < FACTION_ROSTER.length; i++) {
    const def = FACTION_ROSTER[i];
    factions.push({
      index: i,
      key: def.key,
      name: def.name,
      description: def.description,
      governmentType: def.governmentType,
      doctrine: def.doctrine,
      color: def.color,
      isMajor: true,
      homeworldSystemIndex: -1, // assigned by placeHomeworlds below
    });
    usedHues.push(hexToHue(def.color));
  }

  // ── Minors: procedurally named/colored, random government + doctrine ──
  const usedMinorNames = new Set<string>();
  for (let k = 0; k < params.minorFactionCount; k++) {
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
      homeworldSystemIndex: -1,
    });
  }

  // ── Placement: every faction gets a spaced, seed-biased homeworld ──
  const homeworlds = placeHomeworlds(systems, factions.length, params.mapSize);
  for (let i = 0; i < factions.length; i++) {
    factions[i].homeworldSystemIndex = homeworlds[i];
  }

  return factions;
}

/**
 * Ownership at emergent world-gen: only faction homeworlds are owned; every other
 * system is unclaimed (-1). Downstream (`gen.ts`) maps -1 → factionId null.
 */
export function assignHomeworldOwnership(
  systemCount: number,
  factions: GeneratedFaction[],
): number[] {
  const owner = new Array<number>(systemCount).fill(-1);
  for (const f of factions) owner[f.homeworldSystemIndex] = f.index;
  return owner;
}

// ── Homeworld placement (spaced + seed-biased) ──────────────────

/** Count of resources this system has any deposit slot for — the "resource diversity" term. */
function homeworldResourceDiversity(slotCap: ResourceVector): number {
  let n = 0;
  for (const r of RESOURCE_TYPES) if (slotCap[r] > 0) n++;
  return n;
}

/**
 * Pick one well-spaced, high-substrate homeworld per faction. Score = weighted sum
 * of normalized (habitable base, resource diversity) minus normalized danger;
 * greedy-select highest score first, requiring each pick to sit at least the
 * spacing threshold from all prior picks. The threshold relaxes on failure so a dense
 * galaxy degrades to "as spaced as it can be" rather than throwing on tight spacing; it
 * throws only when there are fewer systems than requested homeworlds, since each faction
 * needs a distinct one. Deterministic: scores derive from already-seeded substrate; ties
 * break on index.
 */
export function placeHomeworlds(systems: GeneratedSystem[], count: number, mapSize: number): number[] {
  if (count <= 0) return [];
  if (count > systems.length) {
    throw new Error(
      `placeHomeworlds: cannot place ${count} distinct homeworlds among ${systems.length} systems`,
    );
  }

  let maxHab = 1, maxDanger = 1;
  for (const s of systems) {
    if (s.habitableSpace > maxHab) maxHab = s.habitableSpace;
    if (s.bodyDanger > maxDanger) maxDanger = s.bodyDanger;
  }

  const w = HOMEWORLD_PLACEMENT.SCORE_WEIGHTS;
  const scored = systems
    .map((s) => ({
      idx: s.index,
      x: s.x,
      y: s.y,
      score:
        w.habitable * (s.habitableSpace / maxHab) +
        w.diversity * (homeworldResourceDiversity(s.slotCap) / RESOURCE_TYPES.length) -
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
  // Fully relaxed and still can't space `count` apart → give up on spacing and take the top
  // `count` by substrate quality. `count <= systems.length` (guarded above), so this is exactly `count`.
  return scored.slice(0, count).map((p) => p.idx);
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
