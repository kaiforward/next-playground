/**
 * Worker thread for the tick engine.
 *
 * Runs the full tick transaction (optimistic lock → processors → merge results)
 * off the main thread so API routes stay responsive during CPU-bound tick work.
 *
 * Spawned by engine.ts via `new Worker()`. Communicates via postMessage.
 *
 * Each worker thread gets its own V8 isolate, so importing the prisma singleton
 * here creates a fresh PrismaClient (separate better-sqlite3 connection, WAL mode).
 */

import { parentPort } from "node:worker_threads";
import { prisma } from "@/lib/prisma";
import { processors, sortProcessors } from "./registry";
import { mergeGlobalEvents, mergePlayerEvents } from "./helpers";
import type { TickContext, TickProcessor, GlobalEventMap, PlayerEventMap } from "./types";
import type { MainToWorker, WorkerToMain } from "./worker-types";

if (!parentPort) {
  throw new Error("worker.ts must be run as a Worker thread");
}

function send(msg: WorkerToMain) {
  parentPort!.postMessage(msg);
}

parentPort.on("message", async (msg: MainToWorker) => {
  if (msg.type === "shutdown") {
    await prisma.$disconnect();
    process.exit(0);
  }

  if (msg.type === "run-tick") {
    try {
      const activeProcessors = sortProcessors(processors, msg.tick);

      const result = await prisma.$transaction(async (tx) => {
        // Optimistic lock: only update if currentTick hasn't changed
        const updated = await tx.gameWorld.updateMany({
          where: { id: "world", currentTick: msg.previousTick },
          data: {
            currentTick: msg.tick,
            lastTickAt: new Date(),
          },
        });

        if (updated.count === 0) return null;

        // Run processors sequentially with error isolation
        const ctx: TickContext = { tx, tick: msg.tick, results: new Map() };
        const timings = new Map<string, number>();

        for (const processor of activeProcessors) {
          try {
            const start = performance.now();
            const processorResult = await processor.process(ctx);
            ctx.results.set(processor.name, processorResult);
            timings.set(processor.name, performance.now() - start);
          } catch (error) {
            console.error(
              `[Worker] Processor "${processor.name}" failed on tick ${msg.tick}:`,
              error,
            );
          }
        }

        return { results: ctx.results, timings, activeProcessors };
      });

      if (!result) {
        send({
          type: "tick-skipped",
          tick: msg.tick,
          reason: "optimistic lock failed",
        });
        return;
      }

      // Merge all processor results
      const mergedGlobalEvents: Partial<GlobalEventMap> = {};
      const mergedPlayerEvents = new Map<string, Partial<PlayerEventMap>>();

      for (const processorResult of result.results.values()) {
        mergeGlobalEvents(mergedGlobalEvents, processorResult);
        mergePlayerEvents(mergedPlayerEvents, processorResult);
      }

      // Serialize Map as entries array for structured clone compatibility
      send({
        type: "tick-result",
        tick: msg.tick,
        globalEvents: mergedGlobalEvents,
        playerEvents: [...mergedPlayerEvents.entries()],
        timings: [...result.timings.entries()],
        processors: result.activeProcessors.map((p: TickProcessor) => p.name),
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error(`[Worker] Tick ${msg.tick} error:`, error);
      send({
        type: "tick-error",
        tick: msg.tick,
        error: errorMessage,
      });
    }
  }
});

// Signal ready
send({ type: "ready" });
