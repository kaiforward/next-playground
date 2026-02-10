import { EventEmitter } from "events";
import { prisma } from "@/lib/prisma";
import { processors, sortProcessors } from "./registry";
import type {
  TickContext,
  TickProcessorResult,
  TickEventRaw,
} from "./types";

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

  subscribe(cb: (event: TickEventRaw) => void) {
    this.emitter.on("tick", cb);
  }

  unsubscribe(cb: (event: TickEventRaw) => void) {
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
    this.intervalId = setInterval(() => this.tick(), 1000);
  }

  private async tick() {
    try {
      const world = await prisma.gameWorld.findUnique({
        where: { id: "world" },
      });

      if (!world) return;

      const elapsed = Date.now() - world.lastTickAt.getTime();
      if (elapsed < world.tickRate) return;

      const newTick = world.currentTick + 1;
      const tickStart = performance.now();

      // Determine which processors run this tick
      const activeProcessors = sortProcessors(processors, newTick);

      const result = await prisma.$transaction(async (tx) => {
        // Optimistic lock: only update if currentTick hasn't changed
        const updated = await tx.gameWorld.updateMany({
          where: { id: "world", currentTick: world.currentTick },
          data: {
            currentTick: newTick,
            lastTickAt: new Date(),
          },
        });

        if (updated.count === 0) return null;

        // Run processors sequentially with error isolation
        const ctx: TickContext = { tx, tick: newTick, results: new Map() };
        const timings = new Map<string, number>();

        for (const processor of activeProcessors) {
          try {
            const start = performance.now();
            const processorResult = await processor.process(ctx);
            ctx.results.set(processor.name, processorResult);
            timings.set(processor.name, performance.now() - start);
          } catch (error) {
            console.error(
              `[TickEngine] Processor "${processor.name}" failed on tick ${newTick}:`,
              error,
            );
          }
        }

        return { results: ctx.results, timings };
      });

      if (!result) return;

      const totalMs = performance.now() - tickStart;

      // Merge all processor results into a single event
      const mergedGlobalEvents: Record<string, unknown[]> = {};
      const mergedPlayerEvents = new Map<string, Record<string, unknown[]>>();

      for (const processorResult of result.results.values()) {
        mergeGlobalEvents(mergedGlobalEvents, processorResult);
        mergePlayerEvents(mergedPlayerEvents, processorResult);
      }

      const event: TickEventRaw = {
        currentTick: newTick,
        tickRate: world.tickRate,
        events: mergedGlobalEvents,
        playerEvents: mergedPlayerEvents,
      };

      if (process.env.NODE_ENV !== "production") {
        event.processors = activeProcessors.map((p) => p.name);
      }

      this.emitter.emit("tick", event);

      // Log tick summary with per-processor timing
      const parts = [...result.timings.entries()].map(
        ([name, ms]) => `${name}: ${ms.toFixed(1)}ms`,
      );
      console.log(
        `[TickEngine] Tick ${newTick} (${totalMs.toFixed(0)}ms) — ${parts.join(", ")}`,
      );

      // Overrun warning
      if (totalMs > world.tickRate * 0.8) {
        console.warn(
          `[TickEngine] WARN Tick ${newTick} took ${totalMs.toFixed(0)}ms ` +
            `(${((totalMs / world.tickRate) * 100).toFixed(0)}% of ${world.tickRate}ms tick rate) — ${parts.join(", ")}`,
        );
      }
    } catch (error) {
      console.error("[TickEngine] Error:", error);
    }
  }
}

function mergeGlobalEvents(
  target: Record<string, unknown[]>,
  result: TickProcessorResult,
) {
  if (!result.globalEvents) return;
  for (const [key, events] of Object.entries(result.globalEvents)) {
    target[key] = [...(target[key] ?? []), ...events];
  }
}

function mergePlayerEvents(
  target: Map<string, Record<string, unknown[]>>,
  result: TickProcessorResult,
) {
  if (!result.playerEvents) return;
  for (const [playerId, events] of result.playerEvents) {
    const existing = target.get(playerId) ?? {};
    for (const [key, eventList] of Object.entries(events)) {
      existing[key] = [...(existing[key] ?? []), ...eventList];
    }
    target.set(playerId, existing);
  }
}

// Singleton — survives HMR in dev via globalThis
const globalForTick = globalThis as unknown as { tickEngine: TickEngine };
export const tickEngine = globalForTick.tickEngine || new TickEngine();
if (process.env.NODE_ENV !== "production") globalForTick.tickEngine = tickEngine;
