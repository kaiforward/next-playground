import { describe, it, expect } from "vitest";
import { generateWorld } from "../gen";
import { runWorldTick } from "../tick";
import type { World, WorldSystem } from "../types";
import { EXPANSION } from "@/lib/constants/expansion";
import type { TickCadence } from "@/lib/constants/tick-cadence";

/**
 * Which unclaimed system a faction reaches for, and how far it will reach.
 *
 * The tick assembles each faction's claim candidates itself — the reach radius and the per-candidate
 * substrate summary are built here, not in the expansion engine. Both are quiet failures: a galaxy
 * whose factions claim the wrong rock, or claim past their reach, still fills up at roughly the right
 * pace and passes every "expansion happened" assertion.
 */

const NEVER = 1_000_000;
const CLAIMS_RESOLVE: TickCadence = { cycle: 1, construction: 1, logistics: NEVER };

const SLOT_COLUMNS = [
  "countGas", "countMinerals", "countOre", "countBiomass", "countArable", "countWater", "countRadioactive",
] as const;

/** Deposit-slot columns, all seven at once. */
function slots(value: number) {
  return {
    countGas: value, countMinerals: value, countOre: value, countBiomass: value,
    countArable: value, countWater: value, countRadioactive: value,
  };
}

/** Deposit slots for exactly `kinds` of the seven resources — the resource-diversity count. */
function slotsForKinds(kinds: number) {
  const columns = slots(0);
  for (const [i, column] of SLOT_COLUMNS.entries()) if (i < kinds) columns[column] = 1;
  return columns;
}

/** A rock nothing would ever want: no habitable space, no deposits — it scores below the floor. */
function inertRock(s: WorldSystem): WorldSystem {
  return { ...s, peopleLand: 0, ...slots(0) };
}

interface CandidateSpec {
  /** Jumps from the faction's homeworld; relay systems are inserted to make up the distance. */
  hops: number;
  peopleLand: number;
  /** How many of the seven deposit types this system has any slot for. */
  resourceKinds: number;
}

/**
 * A faction's homeworld cut off from the galaxy and rewired to a private set of candidate rocks, each
 * at a chosen hop distance through inert relays. Every candidate is unclaimed and reachable by nobody
 * else, so exactly one claim is on offer and the choice between them is the faction's alone.
 *
 * Returns the candidate ids in spec order — ASCENDING by system id, so the engine's
 * lowest-id-wins tie-break favours the FIRST spec. A test that expects a later one to win is
 * therefore asserting the score, not the tie-break.
 */
function claimWorld(specs: CandidateSpec[]): { world: World; candidateIds: string[] } {
  const base = generateWorld({ systemCount: 120, seed: 11 });
  const faction = base.factions[0];
  const home = base.systems.find((s) => s.id === faction.homeworldId);
  if (!home) throw new Error("fixture premise: the faction has no homeworld system");

  const spare = base.systems.filter((s) => s.control === "unclaimed");
  const needed = specs.reduce((n, spec) => n + spec.hops, 0);
  if (spare.length < needed) throw new Error("fixture premise: not enough unclaimed systems for the corridors");

  const byId = [...spare].sort((a, b) => a.id.localeCompare(b.id));
  const overrides = new Map<string, WorldSystem>();
  const links: { fromId: string; toId: string; fuelCost: number }[] = [];
  const touched = new Set<string>([home.id]);
  const candidateIds: string[] = [];

  let next = 0;
  // Candidates first, in ascending id order, so `candidateIds[0]` is the tie-break winner.
  const candidates = specs.map(() => byId[next++]);
  for (const [i, spec] of specs.entries()) {
    const candidate = candidates[i];
    const relays = Array.from({ length: spec.hops - 1 }, () => byId[next++]);
    const chain = [home.id, ...relays.map((r) => r.id), candidate.id];
    for (const relay of relays) {
      overrides.set(relay.id, inertRock(relay));
      touched.add(relay.id);
    }
    overrides.set(candidate.id, {
      ...candidate,
      peopleLand: spec.peopleLand,
      ...slotsForKinds(spec.resourceKinds),
    });
    touched.add(candidate.id);
    candidateIds.push(candidate.id);
    for (const [j, from] of chain.slice(0, -1).entries()) {
      links.push({ fromId: from, toId: chain[j + 1], fuelCost: 1 });
      links.push({ fromId: chain[j + 1], toId: from, fuelCost: 1 });
    }
  }

  const world: World = {
    ...base,
    meta: { ...base.meta, currentTick: 0 },
    systems: base.systems.map((s) => overrides.get(s.id) ?? s),
    connections: [
      ...base.connections.filter((c) => !touched.has(c.fromId) && !touched.has(c.toId)),
      ...links,
    ],
  };
  return { world, candidateIds };
}

async function claimedAmong(world: World, candidateIds: string[]): Promise<string[]> {
  const after = (await runWorldTick(world, { cadence: CLAIMS_RESOLVE })).world;
  return after.systems
    .filter((s) => candidateIds.includes(s.id) && s.factionId !== null)
    .map((s) => s.id);
}

/**
 * A faction holding TWO developed systems, both of which can see the same prize rock — the near one
 * a single jump away, the far one `farHops` jumps away through inert relays. A rival rock, worth less
 * than the prize measured from the near owner but more than it measured from the far one, is the
 * discriminator: it wins only if the prize's distance is taken from the wrong owner.
 *
 * `farOwnerFirst` places the distant owner before or after the near one in the system list, which is
 * the order the candidate scan walks — so the same fixture catches both "last write wins" and "first
 * write wins".
 */
function twoOwnerWorld(farHops: number, farOwnerFirst: boolean) {
  const base = generateWorld({ systemCount: 120, seed: 11 });
  const faction = base.factions[0];
  const near = base.systems.find((s) => s.id === faction.homeworldId);
  const far = base.systems.find((s) => s.control === "developed" && s.id !== faction.homeworldId);
  const spare = base.systems.filter((s) => s.control === "unclaimed");
  if (!near || !far || spare.length < farHops + 2) throw new Error("fixture premise: not enough systems");

  const byId = [...spare].sort((a, b) => a.id.localeCompare(b.id));
  const prize = byId[0];
  const rival = byId[1];
  const relays = byId.slice(2, 2 + farHops - 1);

  const overrides = new Map<string, WorldSystem>([
    [far.id, { ...far, factionId: faction.id }],
    // Prize: substrate 31 → 20.7 measured at one jump, 12.4 measured at `farHops`.
    [prize.id, { ...prize, peopleLand: 10, ...slotsForKinds(7) }],
    // Rival: substrate 25 → 16.7 at one jump. Between the prize's two readings.
    [rival.id, { ...rival, peopleLand: 25, ...slotsForKinds(0) }],
    ...relays.map((r): [string, WorldSystem] => [r.id, inertRock(r)]),
  ]);

  const farChain = [far.id, ...relays.map((r) => r.id), prize.id];
  const links = [
    { fromId: near.id, toId: prize.id, fuelCost: 1 },
    { fromId: prize.id, toId: near.id, fuelCost: 1 },
    { fromId: near.id, toId: rival.id, fuelCost: 1 },
    { fromId: rival.id, toId: near.id, fuelCost: 1 },
    ...farChain.slice(0, -1).flatMap((from, i) => [
      { fromId: from, toId: farChain[i + 1], fuelCost: 1 },
      { fromId: farChain[i + 1], toId: from, fuelCost: 1 },
    ]),
  ];
  const touched = new Set([near.id, far.id, prize.id, rival.id, ...relays.map((r) => r.id)]);

  const patched = base.systems.map((s) => overrides.get(s.id) ?? s);
  const withoutOwners = patched.filter((s) => s.id !== near.id && s.id !== far.id);
  const nearRow = patched.find((s) => s.id === near.id);
  const farRow = patched.find((s) => s.id === far.id);
  if (!nearRow || !farRow) throw new Error("fixture premise: owner rows went missing");
  const ordered = farOwnerFirst ? [farRow, nearRow, ...withoutOwners] : [nearRow, farRow, ...withoutOwners];

  const world: World = {
    ...base,
    meta: { ...base.meta, currentTick: 0 },
    systems: ordered,
    connections: [
      ...base.connections.filter((c) => !touched.has(c.fromId) && !touched.has(c.toId)),
      ...links,
    ],
  };
  return { world, prizeId: prize.id, rivalId: rival.id };
}

describe("runWorldTick — the claim candidates a faction is offered", () => {
  it("prefers the resource-richer of two otherwise identical rocks", async () => {
    // Same habitable space, same distance — the ONLY thing separating them is how many deposit kinds
    // each has, and the poorer one holds the lower id, so it wins any tie. Flatten, invert or ignore
    // the diversity count and the claim lands on the poor rock.
    const { world, candidateIds } = claimWorld([
      { hops: 1, peopleLand: 10, resourceKinds: 1 },
      { hops: 1, peopleLand: 10, resourceKinds: 7 },
    ]);
    const [poor, rich] = candidateIds;
    expect(poor.localeCompare(rich)).toBeLessThan(0); // premise: a tie would go to the poor rock

    expect(await claimedAmong(world, candidateIds)).toEqual([rich]);
  });

  it("claims at exactly REACH_JUMPS, and not one jump further however good the prize", async () => {
    // The far rock outscores the near one several times over on substrate alone, so the only thing
    // keeping it unclaimed is the reach bound — and the near one sits exactly ON the bound, so a
    // bound applied one jump short leaves the faction with nothing to claim at all.
    const { world, candidateIds } = claimWorld([
      { hops: EXPANSION.REACH_JUMPS, peopleLand: 10, resourceKinds: 3 },
      { hops: EXPANSION.REACH_JUMPS + 1, peopleLand: 500, resourceKinds: 7 },
    ]);
    const [atLimit, beyondLimit] = candidateIds;

    const claimed = await claimedAmong(world, candidateIds);
    expect(claimed).toContain(atLimit);
    expect(claimed).not.toContain(beyondLimit);
  });

  // A candidate visible from two of a faction's systems must be priced at the NEAREST of them: the
  // proximity discount is what stops a realm claiming across its own diameter. Both orderings are
  // run, because "keep whichever the scan saw last" and "keep whichever it saw first" each look
  // correct from one side.
  for (const farOwnerFirst of [false, true]) {
    it(`prices a candidate at its nearest owner, not its ${farOwnerFirst ? "first" : "last"}-scanned one`, async () => {
      const { world, prizeId, rivalId } = twoOwnerWorld(EXPANSION.REACH_JUMPS, farOwnerFirst);
      const claimed = await claimedAmong(world, [prizeId, rivalId]);
      expect(claimed).toEqual([prizeId]);
    });
  }
});
