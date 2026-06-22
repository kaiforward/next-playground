import { shardRange, catchUpFactor } from "@/lib/tick/shard";
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
