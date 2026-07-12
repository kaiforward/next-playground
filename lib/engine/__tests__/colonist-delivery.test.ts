import { describe, it, expect } from "vitest";
import { allocateColonists, type ColonistSystem, type ColonistDeliveryParams } from "../colonist-delivery";
import type { MigrationDelta } from "@/lib/tick/world/migration-world";

const P: ColonistDeliveryParams = { sourceOutflowCap: 0.05, minSourcePopulation: 100 };

function sys(id: string, factionId: string | null, population: number, popCap: number, labourDemand = 0): ColonistSystem {
  return { systemId: id, factionId, population, popCap, labourDemand };
}
const net = (deltas: MigrationDelta[], id: string): number => deltas.find((d) => d.systemId === id)?.delta ?? 0;
const sum = (deltas: MigrationDelta[]): number => deltas.reduce((s, d) => s + d.delta, 0);

describe("allocateColonists", () => {
  it("conserves population (Σ deltas = 0)", () => {
    const deltas = allocateColonists(
      [sys("core", "f1", 1000, 1000), sys("c1", "f1", 10, 1000), sys("c2", "f1", 30, 1000)],
      P,
    );
    expect(sum(deltas)).toBeCloseTo(0, 6);
  });

  it("water-fills the emptiest colony hardest (equalising, not nearest-wins)", () => {
    const deltas = allocateColonists(
      [sys("core", "f1", 1000, 1000), sys("low", "f1", 10, 1000), sys("high", "f1", 100, 1000)],
      P,
    );
    expect(net(deltas, "low")).toBeGreaterThan(net(deltas, "high"));
    expect(net(deltas, "core")).toBeLessThan(0); // the core donated
  });

  it("caps a colony's intake at its housing headroom", () => {
    // The colony has only 5 headroom; it can't absorb more even though the pool is larger.
    const deltas = allocateColonists([sys("core", "f1", 1000, 1000), sys("c", "f1", 95, 100)], P);
    expect(net(deltas, "c")).toBeLessThanOrEqual(5 + 1e-6);
    expect(sum(deltas)).toBeCloseTo(0, 6); // sources scale to what was actually placed
  });

  it("floors a source at its labour demand — never donates its workers", () => {
    // Idle spare = pop − labourDemand = 300; the source gives that and no more (with the rate cap lifted),
    // so it keeps its 700 workers.
    const params: ColonistDeliveryParams = { sourceOutflowCap: 1, minSourcePopulation: 100 };
    const deltas = allocateColonists([sys("core", "f1", 1000, 1000, 700), sys("c", "f1", 10, 10000)], params);
    expect(net(deltas, "core")).toBeGreaterThanOrEqual(-300 - 1e-6); // kept its 700 workers
    expect(net(deltas, "core")).toBeLessThan(0); // but did shed the idle spare
  });

  it("a fully-staffed source contributes ~nothing (keeps its workers)", () => {
    // pop == labourDemand ⇒ zero idle spare; with the leak off it donates nothing.
    const deltas = allocateColonists([sys("core", "f1", 1000, 1000, 1000), sys("c", "f1", 10, 1000)], P);
    expect(net(deltas, "core")).toBeCloseTo(0, 6);
    expect(net(deltas, "c")).toBeCloseTo(0, 6);
  });

  it("does not drain a below-threshold stub as a source", () => {
    const deltas = allocateColonists([sys("stub", "f1", 30, 1000), sys("c", "f1", 10, 1000)], P); // both < 100
    expect(deltas).toHaveLength(0); // no eligible source ⇒ no pool ⇒ no movement
  });

  it("does not move population across factions", () => {
    // f1's only same-faction sink is the core itself (headroom 0); f2's colony has no same-faction source.
    const deltas = allocateColonists([sys("core", "f1", 1000, 1000), sys("c", "f2", 10, 1000)], P);
    expect(net(deltas, "c")).toBe(0);
    expect(net(deltas, "core")).toBeCloseTo(0, 6);
  });

  it("skips independent (factionless) systems", () => {
    const deltas = allocateColonists([sys("core", null, 1000, 1000), sys("c", null, 10, 1000)], P);
    expect(deltas).toHaveLength(0);
  });
});
