import { shardRange, catchUpFactor, shardGroupForIndex, ticksUntilShard, pulseShard, isPulseTick } from "@/lib/tick/shard";
import { REFERENCE_INTERVAL } from "@/lib/constants/tick-cadence";

it("covers every index exactly once across one interval, no overlap", () => {
  const total = 100, interval = 24;
  const seen = new Set<number>();
  for (let t = 0; t < interval; t++) {
    const { start, end } = shardRange(total, t, interval);
    for (let i = start; i < end; i++) { expect(seen.has(i)).toBe(false); seen.add(i); }
  }
  expect(seen.size).toBe(total); // full, disjoint coverage
});
it("splits as evenly as possible (windows differ by ≤1)", () => {
  const sizes = Array.from({ length: 24 }, (_, t) => { const w = shardRange(100, t, 24); return w.end - w.start; });
  expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
});
it("is periodic in tick and handles negative/large ticks", () => {
  expect(shardRange(100, 24, 24)).toEqual(shardRange(100, 0, 24));
  expect(shardRange(100, 25, 24)).toEqual(shardRange(100, 1, 24));
});
it("degenerates safely: total 0, interval ≤ 1 → whole list", () => {
  expect(shardRange(0, 5, 24)).toEqual({ start: 0, end: 0 });
  expect(shardRange(50, 5, 1)).toEqual({ start: 0, end: 50 });
});
it("catchUpFactor is 1 at the reference interval, linear otherwise", () => {
  expect(catchUpFactor(REFERENCE_INTERVAL)).toBe(1);
  expect(catchUpFactor(REFERENCE_INTERVAL * 2)).toBe(2);
  expect(catchUpFactor(REFERENCE_INTERVAL / 2)).toBe(0.5);
});
it("shardGroupForIndex inverts shardRange: every index falls in its group's window", () => {
  // Covers total>interval (most systems), total<interval (sparse — empty ticks),
  // and total==interval (one per group).
  for (const [total, interval] of [[100, 24], [7886, 24], [50, 7], [3, 24], [24, 24]] as const) {
    for (let i = 0; i < total; i++) {
      const g = shardGroupForIndex(i, total, interval);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThan(interval);
      const { start, end } = shardRange(total, g, interval);
      expect(i).toBeGreaterThanOrEqual(start);
      expect(i).toBeLessThan(end);
    }
  }
});
it("shardGroupForIndex degenerates safely (empty list → group 0)", () => {
  expect(shardGroupForIndex(0, 0, 24)).toBe(0);
});
it("isPulseTick: true only on the boundary tick, periodic in tick", () => {
  const interval = 24;
  for (const t of [0, 24, 48, 240]) expect(isPulseTick(t, interval)).toBe(true);
  for (let t = 1; t < interval; t++) expect(isPulseTick(t, interval)).toBe(false);
  expect(isPulseTick(25, interval)).toBe(false);
});
it("isPulseTick: degenerates safely (interval ≤ 1 → every tick; non-integer floors; negative ticks)", () => {
  expect(isPulseTick(7, 1)).toBe(true);   // interval 1 → every tick is a pulse
  expect(isPulseTick(7, 0)).toBe(true);   // clamped to 1
  expect(isPulseTick(7, -5)).toBe(true);  // clamped to 1
  expect(isPulseTick(24, 24.9)).toBe(true);  // floors to 24
  expect(isPulseTick(25, 24.9)).toBe(false);
  // Negative ticks stay non-negative through the double-modulo, so they agree with
  // their positive counterparts rather than reporting a spurious pulse.
  expect(isPulseTick(-24, 24)).toBe(true);
  expect(isPulseTick(-1, 24)).toBe(false);
});
it("isPulseTick: is the predicate pulseShard resolves — the two can never disagree", () => {
  // runWorldTick gates pulse stages' setup on isPulseTick while the bodies bail on
  // pulseShard; a divergence would silently skip a stage. Pin them to one definition.
  for (const interval of [1, 3, 24, 24.9]) {
    for (let t = 0; t < 50; t++) {
      const { start, end } = pulseShard(100, t, interval);
      expect(start < end).toBe(isPulseTick(t, interval));
    }
  }
});
it("pulseShard: whole list on the boundary tick, empty otherwise", () => {
  const total = 100, interval = 24;
  expect(pulseShard(total, 0, interval)).toEqual({ start: 0, end: total });   // tick 0 → boundary
  expect(pulseShard(total, 24, interval)).toEqual({ start: 0, end: total });  // 24 % 24 = 0
  expect(pulseShard(total, 48, interval)).toEqual({ start: 0, end: total });
  for (let t = 1; t < interval; t++) {
    expect(pulseShard(total, t, interval)).toEqual({ start: 0, end: 0 });     // every off-boundary tick empty
  }
});
it("pulseShard: degenerates safely (total 0 → empty; interval ≤ 1 → whole list every tick)", () => {
  expect(pulseShard(0, 0, 24)).toEqual({ start: 0, end: 0 });
  expect(pulseShard(50, 5, 1)).toEqual({ start: 0, end: 50 }); // interval 1 → every tick is a boundary
  expect(pulseShard(50, 7, 1)).toEqual({ start: 0, end: 50 });
});
it("pulseShard: covers the whole list exactly once per interval (one boundary per period)", () => {
  const total = 100, interval = 24;
  let covered = 0;
  for (let t = 0; t < interval; t++) {
    const { start, end } = pulseShard(total, t, interval);
    covered += end - start;
  }
  expect(covered).toBe(total); // exactly one full pass per interval
});
it("ticksUntilShard: 0 on the system's own tick, counts down, periodic, handles negatives", () => {
  const iv = 24;
  // A system in group 5 updates on ticks ≡ 5 (mod 24).
  expect(ticksUntilShard(5, 5, iv)).toBe(0);
  expect(ticksUntilShard(5, 4, iv)).toBe(1);
  expect(ticksUntilShard(5, 6, iv)).toBe(iv - 1);
  expect(ticksUntilShard(5, 5 + iv, iv)).toBe(0); // periodic
  expect(ticksUntilShard(5, -19, iv)).toBe(0); // -19 ≡ 5 (mod 24)
});
