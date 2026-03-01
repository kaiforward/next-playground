import { EventEmitter } from "events";
import { prisma } from "@/lib/prisma";
import { processors, sortProcessors } from "./registry";
import type {
  TickContext,
  TickProcessorResult,
  TickEventRaw,
  GlobalEventMap,
  PlayerEventMap,
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
      const mergedGlobalEvents: Partial<GlobalEventMap> = {};
      const mergedPlayerEvents = new Map<string, Partial<PlayerEventMap>>();

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
  target: Partial<GlobalEventMap>,
  result: TickProcessorResult,
) {
  if (!result.globalEvents) return;
  for (const _key of Object.keys(result.globalEvents)) {
    const key = _key as keyof GlobalEventMap;
    const source = result.globalEvents[key];
    if (!source) continue;
    const existing = target[key];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- merging heterogeneous arrays by key
    (target as any)[key] = existing ? [...existing, ...source] : [...source];
  }
}

function mergePlayerEvents(
  target: Map<string, Partial<PlayerEventMap>>,
  result: TickProcessorResult,
) {
  if (!result.playerEvents) return;
  for (const [playerId, events] of result.playerEvents) {
    const existing = target.get(playerId) ?? {};
    for (const _key of Object.keys(events)) {
      const key = _key as keyof PlayerEventMap;
      const source = events[key];
      if (!source) continue;
      const current = existing[key];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- merging heterogeneous arrays by key
      (existing as any)[key] = current ? [...current, ...source] : [...source];
    }
    target.set(playerId, existing);
  }
}

// Singleton — survives HMR in dev via globalThis
declare global {
  // eslint-disable-next-line no-var
  var __tickEngine: TickEngine | undefined;
}
export const tickEngine = globalThis.__tickEngine ?? new TickEngine();
if (process.env.NODE_ENV !== "production") globalThis.__tickEngine = tickEngine;
