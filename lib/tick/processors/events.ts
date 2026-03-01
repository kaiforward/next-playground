import type { TickProcessor, TickProcessorResult, EventNotificationPayload } from "../types";
import type { TxClient } from "../types";
import {
  EVENT_DEFINITIONS,
  EVENT_SPAWN_INTERVAL,
  MAX_EVENTS_GLOBAL,
  MAX_EVENTS_PER_SYSTEM,
} from "@/lib/constants/events";
import type { SpawnDecision } from "@/lib/engine/events";
import { ECONOMY_CONSTANTS } from "@/lib/constants/economy";
import {
  checkPhaseTransition,
  buildModifiersForPhase,
  buildShocksForPhase,
  evaluateSpreadTargets,
  selectEventToSpawn,
  rollPhaseDuration,
  type EventSnapshot,
  type SystemSnapshot,
  type ShockRow,
  type NeighborSnapshot,
} from "@/lib/engine/events";
import { toEventTypeId } from "@/lib/types/guards";

// ── Helpers ──────────────────────────────────────────────────────

/** Map a DB event row to an EventSnapshot. Validates type at the Prisma boundary. */
function toSnapshot(e: {
  id: string;
  type: string;
  phase: string;
  systemId: string | null;
  regionId: string | null;
  startTick: number;
  phaseStartTick: number;
  phaseDuration: number;
  severity: number;
  sourceEventId: string | null;
}): EventSnapshot {
  return {
    id: e.id,
    type: toEventTypeId(e.type),
    phase: e.phase,
    systemId: e.systemId,
    regionId: e.regionId,
    startTick: e.startTick,
    phaseStartTick: e.phaseStartTick,
    phaseDuration: e.phaseDuration,
    severity: e.severity,
    sourceEventId: e.sourceEventId,
  };
}

/**
 * Apply one-time shocks to station markets at a system.
 * Clamps values to economy bounds [MIN_LEVEL, MAX_LEVEL].
 */
async function applyShocks(
  tx: TxClient,
  shocks: ShockRow[],
  systemId: string | null,
): Promise<void> {
  if (shocks.length === 0 || !systemId) return;

  const { MIN_LEVEL, MAX_LEVEL } = ECONOMY_CONSTANTS;

  for (const shock of shocks) {
    // Find markets at this system for the shocked good
    const markets = await tx.stationMarket.findMany({
      where: {
        goodId: shock.goodId,
        station: { systemId },
      },
      select: { id: true, supply: true, demand: true },
    });

    for (const market of markets) {
      const current = shock.parameter === "supply" ? market.supply : market.demand;
      const newValue = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, current + shock.value));
      await tx.stationMarket.update({
        where: { id: market.id },
        data: { [shock.parameter]: newValue },
      });
    }
  }
}

/**
 * Create a child event from a spread decision, including modifiers and shocks.
 * Returns the system name for notification purposes.
 */
async function createSpreadEvent(
  tx: TxClient,
  decision: SpawnDecision,
  sourceEventId: string,
  tick: number,
): Promise<string> {
  const def = EVENT_DEFINITIONS[decision.type]!;
  const firstPhase = def.phases[0];

  const newEvent = await tx.gameEvent.create({
    data: {
      type: decision.type,
      phase: decision.phase,
      systemId: decision.systemId,
      regionId: decision.regionId,
      startTick: tick,
      phaseStartTick: tick,
      phaseDuration: decision.phaseDuration,
      severity: decision.severity,
      sourceEventId,
    },
  });

  // Create modifiers
  const modifierRows = buildModifiersForPhase(
    firstPhase,
    decision.systemId,
    decision.regionId,
    decision.severity,
  );

  if (modifierRows.length > 0) {
    await tx.eventModifier.createMany({
      data: modifierRows.map((row) => ({ eventId: newEvent.id, ...row })),
    });
  }

  // Apply first-phase shocks
  const shocks = buildShocksForPhase(firstPhase, decision.severity);
  await applyShocks(tx, shocks, decision.systemId);

  const sys = await tx.starSystem.findUnique({
    where: { id: decision.systemId },
    select: { name: true },
  });
  return sys?.name ?? "Unknown";
}

// ── Processor ────────────────────────────────────────────────────

export const eventsProcessor: TickProcessor = {
  name: "events",
  frequency: 1,

  async process(ctx): Promise<TickProcessorResult> {
    const notifications: EventNotificationPayload[] = [];

    // ── 1. Fetch all active events ────────────────────────────────
    const dbEvents = await ctx.tx.gameEvent.findMany({
      select: {
        id: true,
        type: true,
        phase: true,
        systemId: true,
        regionId: true,
        startTick: true,
        phaseStartTick: true,
        phaseDuration: true,
        severity: true,
        sourceEventId: true,
        system: { select: { name: true } },
      },
    });

    const snapshots: EventSnapshot[] = dbEvents.map(toSnapshot);

    // Map id→systemName for notifications
    const systemNameById = new Map(
      dbEvents
        .filter((e) => e.systemId && e.system)
        .map((e) => [e.id, e.system!.name]),
    );

    // ── 2. Phase transitions ──────────────────────────────────────
    const expiredIds: string[] = [];

    for (const snap of snapshots) {
      const def = EVENT_DEFINITIONS[snap.type];
      if (!def) {
        expiredIds.push(snap.id);
        continue;
      }

      const result = checkPhaseTransition(snap, ctx.tick, def);

      if (result === "expire") {
        expiredIds.push(snap.id);
        const sysName = systemNameById.get(snap.id) ?? "Unknown";
        notifications.push({
          message: `${def.name} at ${sysName} has ended.`,
          type: snap.type,
          refs: snap.systemId ? { system: { id: snap.systemId, label: sysName } } : {},
        });
        continue;
      }

      if (result === "advance") {
        const currentIndex = def.phases.findIndex((p) => p.name === snap.phase);
        const nextPhase = def.phases[currentIndex + 1];
        const duration = rollPhaseDuration(nextPhase.durationRange, Math.random);

        // Delete old modifiers, create new ones
        await ctx.tx.eventModifier.deleteMany({ where: { eventId: snap.id } });

        const modifierRows = buildModifiersForPhase(
          nextPhase,
          snap.systemId,
          snap.regionId,
          snap.severity,
        );

        if (modifierRows.length > 0) {
          await ctx.tx.eventModifier.createMany({
            data: modifierRows.map((row) => ({
              eventId: snap.id,
              ...row,
            })),
          });
        }

        // Apply shocks for the new phase
        const shocks = buildShocksForPhase(nextPhase, snap.severity);
        await applyShocks(ctx.tx, shocks, snap.systemId);

        // Update event phase
        await ctx.tx.gameEvent.update({
          where: { id: snap.id },
          data: {
            phase: nextPhase.name,
            phaseStartTick: ctx.tick,
            phaseDuration: duration,
          },
        });

        const sysName = systemNameById.get(snap.id) ?? "Unknown";
        if (nextPhase.notification) {
          notifications.push({
            message: nextPhase.notification.replace("{systemName}", sysName),
            type: snap.type,
            refs: snap.systemId ? { system: { id: snap.systemId, label: sysName } } : {},
          });
        }

        console.log(
          `[events] ${def.name} at ${sysName}: ${snap.phase} → ${nextPhase.name} (${duration} ticks)`,
        );

        // ── Spread: spawn child events at neighboring systems ──
        if (nextPhase.spread && nextPhase.spread.length > 0 && !snap.sourceEventId) {
          // Fetch neighbors of this system
          const connections = await ctx.tx.systemConnection.findMany({
            where: { fromSystemId: snap.systemId! },
            select: {
              toSystem: { select: { id: true, economyType: true, regionId: true } },
            },
          });

          const neighbors: NeighborSnapshot[] = connections.map((c) => ({
            id: c.toSystem.id,
            economyType: c.toSystem.economyType,
            regionId: c.toSystem.regionId,
          }));

          // Re-fetch active events for accurate spread evaluation
          const currentEvents = await ctx.tx.gameEvent.findMany({
            select: {
              id: true, type: true, phase: true,
              systemId: true, regionId: true,
              startTick: true, phaseStartTick: true,
              phaseDuration: true, severity: true,
              sourceEventId: true,
            },
          });
          const currentSnapshots = currentEvents.map(toSnapshot);

          const spreadDecisions = evaluateSpreadTargets(
            nextPhase.spread,
            snap,
            neighbors,
            currentSnapshots,
            { maxEventsGlobal: MAX_EVENTS_GLOBAL, maxEventsPerSystem: MAX_EVENTS_PER_SYSTEM },
            EVENT_DEFINITIONS,
            Math.random,
          );

          for (const decision of spreadDecisions) {
            const childDef = EVENT_DEFINITIONS[decision.type]!;
            const childPhase = childDef.phases[0];
            const childSysName = await createSpreadEvent(ctx.tx, decision, snap.id, ctx.tick);

            if (childPhase.notification) {
              notifications.push({
                message: childPhase.notification.replace("{systemName}", childSysName),
                type: decision.type,
                refs: { system: { id: decision.systemId, label: childSysName } },
              });
            }

            console.log(
              `[events] Spread ${childDef.name} to ${childSysName} from ${sysName} (severity: ${decision.severity.toFixed(2)})`,
            );
          }
        }
      }
    }

    // ── 3. Expire completed events ────────────────────────────────
    if (expiredIds.length > 0) {
      // Modifiers cascade-deleted via onDelete: Cascade
      await ctx.tx.gameEvent.deleteMany({
        where: { id: { in: expiredIds } },
      });
      console.log(`[events] Expired ${expiredIds.length} event(s)`);
    }

    // ── 4. Spawn new events ───────────────────────────────────────
    const isSpawnTick = ctx.tick % EVENT_SPAWN_INTERVAL === 0;

    if (isSpawnTick) {
      // Re-fetch active events (post-expiry) for accurate cap checking
      const currentEvents = await ctx.tx.gameEvent.findMany({
        select: {
          id: true, type: true, phase: true,
          systemId: true, regionId: true,
          startTick: true, phaseStartTick: true,
          phaseDuration: true, severity: true,
          sourceEventId: true,
        },
      });

      const currentSnapshots: EventSnapshot[] = currentEvents.map(toSnapshot);

      // Fetch all systems for spawn selection
      const allSystems = await ctx.tx.starSystem.findMany({
        select: { id: true, economyType: true, regionId: true },
      });

      const systemSnapshots: SystemSnapshot[] = allSystems.map((s) => ({
        id: s.id,
        economyType: s.economyType,
        regionId: s.regionId,
      }));

      const decision = selectEventToSpawn(
        EVENT_DEFINITIONS,
        currentSnapshots,
        systemSnapshots,
        ctx.tick,
        { maxEventsGlobal: MAX_EVENTS_GLOBAL, maxEventsPerSystem: MAX_EVENTS_PER_SYSTEM },
        Math.random,
      );

      if (decision) {
        const def = EVENT_DEFINITIONS[decision.type]!;
        const firstPhase = def.phases[0];

        // Create the event
        const newEvent = await ctx.tx.gameEvent.create({
          data: {
            type: decision.type,
            phase: decision.phase,
            systemId: decision.systemId,
            regionId: decision.regionId,
            startTick: ctx.tick,
            phaseStartTick: ctx.tick,
            phaseDuration: decision.phaseDuration,
            severity: decision.severity,
          },
        });

        // Create initial modifiers
        const modifierRows = buildModifiersForPhase(
          firstPhase,
          decision.systemId,
          decision.regionId,
          decision.severity,
        );

        if (modifierRows.length > 0) {
          await ctx.tx.eventModifier.createMany({
            data: modifierRows.map((row) => ({
              eventId: newEvent.id,
              ...row,
            })),
          });
        }

        // Apply first-phase shocks
        const shocks = buildShocksForPhase(firstPhase, decision.severity);
        await applyShocks(ctx.tx, shocks, decision.systemId);

        // Resolve system name for notification
        const sys = await ctx.tx.starSystem.findUnique({
          where: { id: decision.systemId },
          select: { name: true },
        });
        const sysName = sys?.name ?? "Unknown";

        if (firstPhase.notification) {
          notifications.push({
            message: firstPhase.notification.replace("{systemName}", sysName),
            type: decision.type,
            refs: { system: { id: decision.systemId, label: sysName } },
          });
        }

        console.log(
          `[events] Spawned ${def.name} at ${sysName} — phase: ${decision.phase} (${decision.phaseDuration} ticks)`,
        );
      }
    }

    // ── 5. Emit results ───────────────────────────────────────────
    return {
      globalEvents: notifications.length > 0
        ? { eventNotifications: notifications }
        : {},
    };
  },
};
