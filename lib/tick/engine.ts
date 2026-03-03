import { EventEmitter } from "node:events";
import { prisma } from "@/lib/prisma";
import type { Worker as WorkerType } from "node:worker_threads";
import type {
  TickEventRaw,
  PlayerEventMap,
} from "./types";
import type { MainToWorker, WorkerToMain } from "./worker-types";

class TickEngine {
  private emitter = new EventEmitter();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private worker: WorkerType | null = null;
  private workerBusy = false;
  private tickStart = 0;

  constructor() {
    this.emitter.setMaxListeners(0); // No limit — one listener per SSE client
  }

  start() {
    if (this.running) return;
    this.running = true;
    console.log("[TickEngine] Starting with worker thread...");
    this.spawnWorker();
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;

    if (this.worker) {
      const msg: MainToWorker = { type: "shutdown" };
      this.worker.postMessage(msg);
      this.worker = null;
    }

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

  private async spawnWorker() {
    // Load Node.js built-ins at runtime via globalThis.require to prevent
    // Turbopack's NFT tracer from statically resolving them (it can't handle
    // node: protocol URLs and crashes). Safe because this only runs in Node.js
    // server context via instrumentation.ts.
    const nodeRequire = globalThis.require ?? require;
    const { Worker } = nodeRequire("worker_threads") as typeof import("node:worker_threads");
    const { fileURLToPath } = nodeRequire("url") as typeof import("node:url");
    const path = nodeRequire("path") as typeof import("node:path");
    const workerDir = path.dirname(fileURLToPath(import.meta.url));
    const workerPath = path.join(workerDir, "worker.ts");
    this.worker = new Worker(workerPath, {
      execArgv: ["--import", "tsx"],
    });

    this.worker.on("message", (msg: WorkerToMain) => {
      this.handleWorkerMessage(msg);
    });

    this.worker.on("error", (error) => {
      console.error("[TickEngine] Worker error:", error);
    });

    this.worker.on("exit", (code) => {
      this.workerBusy = false;

      if (!this.running) return; // Intentional shutdown

      console.warn(
        `[TickEngine] Worker exited with code ${code}, respawning...`,
      );
      this.worker = null;
      // Respawn after a short delay to avoid tight crash loops
      setTimeout(() => {
        if (this.running) this.spawnWorker();
      }, 1000);
    });
  }

  private handleWorkerMessage(msg: WorkerToMain) {
    switch (msg.type) {
      case "ready":
        console.log("[TickEngine] Worker ready");
        this.tick();
        this.intervalId = setInterval(() => this.tick(), 1000);
        break;

      case "tick-result": {
        this.workerBusy = false;

        const totalMs = performance.now() - this.tickStart;

        // Reconstruct Map from serialized entries
        const playerEvents = new Map<string, Partial<PlayerEventMap>>(
          msg.playerEvents,
        );

        const event: TickEventRaw = {
          currentTick: msg.tick,
          tickRate: 0, // Filled below from DB state
          events: msg.globalEvents,
          playerEvents,
        };

        if (process.env.NODE_ENV !== "production") {
          event.processors = msg.processors;
        }

        // Get tickRate from the latest state for the event
        prisma.gameWorld
          .findUnique({ where: { id: "world" } })
          .then((world) => {
            event.tickRate = world?.tickRate ?? 5000;
            this.emitter.emit("tick", event);
          })
          .catch(() => {
            event.tickRate = 5000;
            this.emitter.emit("tick", event);
          });

        // Log tick summary
        const parts = msg.timings.map(
          ([name, ms]) => `${name}: ${ms.toFixed(1)}ms`,
        );
        console.log(
          `[TickEngine] Tick ${msg.tick} (${totalMs.toFixed(0)}ms) — ${parts.join(", ")}`,
        );

        break;
      }

      case "tick-skipped":
        this.workerBusy = false;
        break;

      case "tick-error":
        this.workerBusy = false;
        console.error(
          `[TickEngine] Worker tick ${msg.tick} error: ${msg.error}`,
        );
        break;
    }
  }

  private async tick() {
    if (this.workerBusy || !this.worker) return;

    try {
      // Read game world on main thread (fast, WAL mode — doesn't block)
      const world = await prisma.gameWorld.findUnique({
        where: { id: "world" },
      });

      if (!world) return;

      const elapsed = Date.now() - world.lastTickAt.getTime();
      if (elapsed < world.tickRate) return;

      const newTick = world.currentTick + 1;
      this.tickStart = performance.now();
      this.workerBusy = true;

      const msg: MainToWorker = {
        type: "run-tick",
        tick: newTick,
        previousTick: world.currentTick,
      };
      this.worker.postMessage(msg);
    } catch (error) {
      console.error("[TickEngine] Error:", error);
    }
  }
}

// Singleton — survives HMR in dev via globalThis
declare global {
  // eslint-disable-next-line no-var
  var __tickEngine: TickEngine | undefined;
}
export const tickEngine = globalThis.__tickEngine ?? new TickEngine();
if (process.env.NODE_ENV !== "production") globalThis.__tickEngine = tickEngine;
