import { describe, it, expect } from "vitest";
import { runPriceSnapshotsProcessor } from "../price-snapshots";
import { InMemorySnapshotsWorld } from "@/lib/tick/adapters/memory/snapshots";
import { MAX_SNAPSHOTS } from "@/lib/constants/snapshot";
import { TARGET_COVER } from "@/lib/constants/market-economy";
import type { MarketView } from "@/lib/tick/world/snapshots-world";
import type { PriceHistoryEntry } from "@/lib/engine/snapshot";
import type { TickContext, TickProcessorResult } from "@/lib/tick/types";

function makeCtx(tick: number, processed?: string[]): TickContext {
  // Processor body never touches `tx`. Cast via never to avoid stubbing the
  // full Prisma client surface for a unit test that doesn't use it.
  const results = new Map<string, TickProcessorResult>();
  if (processed) {
    results.set("economy", {
      economySignals: { dissatisfactionBySystem: new Map(processed.map((id) => [id, 0])), outputUptakeBySystem: new Map() },
    });
  }
  return { tx: undefined as never, tick, results };
}

function makeMarket(
  systemId: string,
  goodId: string,
  stock: number,
): MarketView {
  return {
    systemId,
    goodId,
    stock,
    anchorMult: 1,
    demandRate: 1,
    basePrice: 100,
    // priceFloor/priceCeiling are multipliers, not absolute prices.
    priceFloor: 0.2,
    priceCeiling: 5.0,
  };
}

describe("runPriceSnapshotsProcessor", () => {
  it("snapshots only the systems economy processed this tick", async () => {
    // World has markets + history rows for both sys-a and sys-b, but only
    // sys-a is in the economy shard this tick — sys-b must not be touched.
    const world = new InMemorySnapshotsWorld(
      [
        makeMarket("sys-a", "iron", TARGET_COVER),
        makeMarket("sys-b", "iron", TARGET_COVER),
      ],
      ["sys-a", "sys-b"],
    );

    const result = await runPriceSnapshotsProcessor(world, makeCtx(20, ["sys-a"]));

    expect(world.snapshot("sys-a")).toHaveLength(1);
    expect(world.snapshot("sys-b")).toEqual([]); // not processed → not snapshotted
    expect(result.globalEvents?.priceSnapshot).toEqual([{ systemCount: 1 }]);
  });

  it("returns empty when economy did not run this tick", async () => {
    const world = new InMemorySnapshotsWorld(
      [makeMarket("sys-a", "iron", TARGET_COVER)],
      ["sys-a"],
    );

    const result = await runPriceSnapshotsProcessor(world, makeCtx(20));

    expect(result).toEqual({});
    expect(world.snapshot("sys-a")).toEqual([]);
  });

  it("appends a snapshot entry to each system with markets", async () => {
    // demandRate is 1, so the per-system reference is TARGET_COVER.
    const world = new InMemorySnapshotsWorld(
      [
        makeMarket("sys-a", "iron", TARGET_COVER), // stock == reference → price == base
        makeMarket("sys-a", "food", TARGET_COVER * 3), // stock > reference → cheap
        makeMarket("sys-b", "iron", TARGET_COVER / 2), // stock < reference → dear
      ],
      ["sys-a", "sys-b"],
    );

    const result = await runPriceSnapshotsProcessor(world, makeCtx(20, ["sys-a", "sys-b"]));

    const a = world.snapshot("sys-a")!;
    const b = world.snapshot("sys-b")!;
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].tick).toBe(20);
    expect(a[0].prices.iron).toBe(100); // stock == reference → basePrice
    expect(a[0].prices.food).toBeLessThan(100); // abundant stock → below base
    expect(b[0].prices.iron).toBeGreaterThan(100); // scarce stock → above base

    expect(result.globalEvents?.priceSnapshot).toEqual([{ systemCount: 2 }]);
  });

  it("accumulates entries across successive ticks", async () => {
    const world = new InMemorySnapshotsWorld(
      [makeMarket("sys-a", "iron", 103)],
      ["sys-a"],
    );

    await runPriceSnapshotsProcessor(world, makeCtx(20, ["sys-a"]));
    await runPriceSnapshotsProcessor(world, makeCtx(40, ["sys-a"]));
    await runPriceSnapshotsProcessor(world, makeCtx(60, ["sys-a"]));

    const a = world.snapshot("sys-a")!;
    expect(a.map((e) => e.tick)).toEqual([20, 40, 60]);
  });

  it("caps the history at MAX_SNAPSHOTS entries, dropping the oldest", async () => {
    const seed: PriceHistoryEntry[] = Array.from(
      { length: MAX_SNAPSHOTS },
      (_, i) => ({ tick: i + 1, prices: { iron: 100 } }),
    );

    const world = new InMemorySnapshotsWorld(
      [makeMarket("sys-a", "iron", 103)],
      ["sys-a"],
    );
    await world.writePriceHistories([{ systemId: "sys-a", entries: seed }]);

    await runPriceSnapshotsProcessor(world, makeCtx(999, ["sys-a"]));

    const a = world.snapshot("sys-a")!;
    expect(a).toHaveLength(MAX_SNAPSHOTS);
    expect(a[0].tick).toBe(2); // oldest (tick 1) dropped
    expect(a[a.length - 1].tick).toBe(999);
  });

  it("ignores systems with no PriceHistory row (e.g. mid-migration)", async () => {
    // sys-b has markets but no history row — must be silently skipped, not crash.
    const world = new InMemorySnapshotsWorld(
      [
        makeMarket("sys-a", "iron", 103),
        makeMarket("sys-b", "iron", 103),
      ],
      ["sys-a"],
    );

    const result = await runPriceSnapshotsProcessor(world, makeCtx(20, ["sys-a", "sys-b"]));

    expect(world.snapshot("sys-a")).toHaveLength(1);
    expect(world.snapshot("sys-b")).toBeUndefined();
    // newEntries counts both systems (it operates over markets, not histories).
    expect(result.globalEvents?.priceSnapshot).toEqual([{ systemCount: 2 }]);
  });

  it("does not invent entries for systems with no markets", async () => {
    const world = new InMemorySnapshotsWorld(
      [makeMarket("sys-a", "iron", 103)],
      ["sys-a", "sys-empty"],
    );

    await runPriceSnapshotsProcessor(world, makeCtx(20, ["sys-a", "sys-empty"]));

    expect(world.snapshot("sys-a")).toHaveLength(1);
    expect(world.snapshot("sys-empty")).toEqual([]);
  });
});
