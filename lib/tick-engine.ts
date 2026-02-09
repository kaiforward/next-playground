import { EventEmitter } from "events";
import { prisma } from "@/lib/prisma";
import { simulateEconomyTick } from "@/lib/engine/tick";
import { ECONOMY_PRODUCTION, ECONOMY_CONSUMPTION } from "@/lib/constants/universe";
import type { EconomyType } from "@/lib/types/game";
import type { TickEvent } from "@/lib/types/api";

class TickEngine {
  private emitter = new EventEmitter();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor() {
    this.emitter.setMaxListeners(0); // No limit — one listener per SSE client
  }

  start() {
    if (this.running) return;
    this.running = true;
    console.log("[TickEngine] Started");

    // Run first tick check immediately, then on interval
    this.tick();
    this.scheduleNext();
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
    console.log("[TickEngine] Stopped");
  }

  /** Ensure engine is running (idempotent) */
  ensureStarted() {
    if (!this.running) this.start();
  }

  subscribe(cb: (event: TickEvent) => void) {
    this.emitter.on("tick", cb);
  }

  unsubscribe(cb: (event: TickEvent) => void) {
    this.emitter.off("tick", cb);
  }

  async getState(): Promise<{ currentTick: number; tickRate: number }> {
    const world = await prisma.gameWorld.findUnique({
      where: { id: "world" },
    });
    return {
      currentTick: world?.currentTick ?? 0,
      tickRate: world?.tickRate ?? 5000,
    };
  }

  private scheduleNext() {
    // Use a fixed 1s poll interval — the tick only advances when
    // enough real time (tickRate) has elapsed since lastTickAt.
    this.intervalId = setInterval(() => this.tick(), 1000);
  }

  private async tick() {
    try {
      const world = await prisma.gameWorld.findUnique({
        where: { id: "world" },
      });

      if (!world) return;

      // Check if enough time has elapsed
      const elapsed = Date.now() - world.lastTickAt.getTime();
      if (elapsed < world.tickRate) return;

      const newTick = world.currentTick + 1;

      // Execute tick in a transaction with optimistic locking
      const result = await prisma.$transaction(async (tx) => {
        // Optimistic lock: only update if currentTick hasn't changed
        const updated = await tx.gameWorld.updateMany({
          where: { id: "world", currentTick: world.currentTick },
          data: {
            currentTick: newTick,
            lastTickAt: new Date(),
          },
        });

        // Another tick beat us to it
        if (updated.count === 0) return null;

        // 1. Process ship arrivals
        const arrivingShips = await tx.ship.findMany({
          where: {
            status: "in_transit",
            arrivalTick: { lte: newTick },
          },
          select: { id: true, destinationSystemId: true },
        });

        const arrivedShipIds: string[] = [];
        for (const ship of arrivingShips) {
          if (ship.destinationSystemId) {
            await tx.ship.update({
              where: { id: ship.id },
              data: {
                systemId: ship.destinationSystemId,
                status: "docked",
                destinationSystemId: null,
                departureTick: null,
                arrivalTick: null,
              },
            });
            arrivedShipIds.push(ship.id);
          }
        }

        // 2. Run economy simulation on all markets
        const markets = await tx.stationMarket.findMany({
          include: {
            good: true,
            station: { include: { system: true } },
          },
        });

        const tickEntries = markets.map((m) => {
          const econ = m.station.system.economyType as EconomyType;
          return {
            goodId: m.good.id,
            supply: m.supply,
            demand: m.demand,
            basePrice: m.good.basePrice,
            economyType: econ,
            produces: ECONOMY_PRODUCTION[econ] ?? [],
            consumes: ECONOMY_CONSUMPTION[econ] ?? [],
          };
        });

        const simulated = simulateEconomyTick(tickEntries);

        // Write back updated supply/demand
        for (let i = 0; i < markets.length; i++) {
          await tx.stationMarket.update({
            where: { id: markets[i].id },
            data: {
              supply: simulated[i].supply,
              demand: simulated[i].demand,
            },
          });
        }

        return { arrivedShipIds };
      });

      // Only emit if we actually advanced the tick
      if (result) {
        const event: TickEvent = {
          currentTick: newTick,
          tickRate: world.tickRate,
          arrivedShipIds: result.arrivedShipIds,
        };
        this.emitter.emit("tick", event);
        console.log(
          `[TickEngine] Tick ${newTick}` +
            (result.arrivedShipIds.length
              ? ` — ${result.arrivedShipIds.length} ship(s) arrived`
              : ""),
        );
      }
    } catch (error) {
      console.error("[TickEngine] Error:", error);
    }
  }
}

// Singleton — survives HMR in dev via globalThis
const globalForTick = globalThis as unknown as { tickEngine: TickEngine };
export const tickEngine = globalForTick.tickEngine || new TickEngine();
if (process.env.NODE_ENV !== "production") globalForTick.tickEngine = tickEngine;
