import type { TickProcessor, TickProcessorResult, EventNotificationPayload } from "../types";
import type { TxClient } from "../types";
import {
  EVENT_SPAWN_INTERVAL,
  scaleEventCaps,
  type EventPhaseDefinition,
  type EventTypeId,
} from "@/lib/constants/events";
import { UNIVERSE_GEN } from "@/lib/constants/universe-gen";
import { ECONOMY_CONSTANTS } from "@/lib/constants/economy";
import {
  checkPhaseTransition,
  buildModifiersForPhase,
  buildShocksForPhase,
  evaluateSpreadTargets,
  selectEventsToSpawn,
  rollPhaseDuration,
  type EventSnapshot,
  type SystemSnapshot,
  type ShockRow,
  type ModifierRow,
  type NeighborSnapshot,
} from "@/lib/engine/events";
import { toEventTypeId } from "@/lib/types/guards";

const { maxEventsGlobal, maxEventsPerSystem, batchSize, definitions: SCALED_DEFINITIONS } =
  scaleEventCaps(UNIVERSE_GEN.TOTAL_SYSTEMS);

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

/** A shock targeting a specific system's market. */
interface SystemShock {
  systemId: string;
  goodId: string;
  parameter: "supply" | "demand";
  value: number;
  /** "absolute" = raw delta, "percentage" = fraction of current value. */
  mode: "absolute" | "percentage";
}

/**
 * Expand ShockRow[] for a system into SystemShock[].
 * Skips when systemId is null (region-only events have no market to shock).
 */
function expandShocks(
  shocks: ShockRow[],
  systemId: string | null,
): SystemShock[] {
  if (!systemId || shocks.length === 0) return [];
  return shocks.map((s) => ({
    systemId,
    goodId: s.goodId,
    parameter: s.parameter,
    value: s.value,
    mode: s.mode,
  }));
}

/**
 * Bulk-apply one-time shocks to station markets across multiple systems.
 * Finds all affected markets in a single Prisma query, aggregates shock
 * deltas in JS, then batch-updates with unnest(). Returns count of markets updated.
 */
async function applyShocksBulk(
  tx: TxClient,
  shocks: SystemShock[],
): Promise<number> {
  if (shocks.length === 0) return 0;

  const { MIN_LEVEL, MAX_LEVEL } = ECONOMY_CONSTANTS;

  // 1. Unique system IDs targeted by shocks
  const systemIds = [...new Set(shocks.map((s) => s.systemId))];

  // 2. Single query: fetch all markets at affected systems
  const allMarkets = await tx.stationMarket.findMany({
    where: { station: { systemId: { in: systemIds } } },
    select: {
      id: true,
      supply: true,
      demand: true,
      goodId: true,
      station: { select: { systemId: true } },
    },
  });

  if (allMarkets.length === 0) return 0;

  // 3. Lookup: "systemId|goodId" → mutable market snapshot
  const marketByKey = new Map<string, { id: string; supply: number; demand: number }>();
  for (const m of allMarkets) {
    marketByKey.set(`${m.station.systemId}|${m.goodId}`, {
      id: m.id,
      supply: m.supply,
      demand: m.demand,
    });
  }

  // 4. Aggregate shock deltas (absolute = raw delta, percentage = fraction of current value)
  const touchedIds = new Set<string>();
  for (const shock of shocks) {
    const market = marketByKey.get(`${shock.systemId}|${shock.goodId}`);
    if (!market) continue;

    const delta = shock.mode === "percentage"
      ? Math.round((shock.parameter === "supply" ? market.supply : market.demand) * shock.value)
      : shock.value;

    if (shock.parameter === "supply") {
      market.supply += delta;
    } else {
      market.demand += delta;
    }
    touchedIds.add(market.id);
  }

  if (touchedIds.size === 0) return 0;

  // 5. Clamp and build update arrays
  const ids: string[] = [];
  const supplies: number[] = [];
  const demands: number[] = [];

  for (const market of marketByKey.values()) {
    if (!touchedIds.has(market.id)) continue;
    ids.push(market.id);
    const s = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, market.supply));
    const d = Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, market.demand));
    supplies.push(isFinite(s) ? s : 0);
    demands.push(isFinite(d) ? d : 0);
  }

  // 6. Batch update with unnest()
  await tx.$executeRaw`
    UPDATE "StationMarket" AS sm
    SET "supply" = batch."supply", "demand" = batch."demand"
    FROM unnest(${ids}::text[], ${supplies}::double precision[], ${demands}::double precision[])
      AS batch("id", "supply", "demand")
    WHERE sm."id" = batch."id"`;

  return ids.length;
}

/**
 * Collect modifier rows for a set of (eventId, phase, decision) tuples.
 * Returns flat array ready for a single createMany call.
 */
function collectModifierRows(
  entries: Array<{
    eventId: string;
    phase: EventPhaseDefinition;
    systemId: string | null;
    regionId: string | null;
    severity: number;
  }>,
): Array<ModifierRow & { eventId: string }> {
  const rows: Array<ModifierRow & { eventId: string }> = [];
  for (const entry of entries) {
    const modifiers = buildModifiersForPhase(
      entry.phase,
      entry.systemId,
      entry.regionId,
      entry.severity,
    );
    for (const row of modifiers) {
      rows.push({ eventId: entry.eventId, ...row });
    }
  }
  return rows;
}

/**
 * Collect SystemShock tuples for a set of (phase, severity, systemId) entries.
 */
function collectSystemShocks(
  entries: Array<{
    phase: EventPhaseDefinition;
    severity: number;
    systemId: string | null;
  }>,
): SystemShock[] {
  const result: SystemShock[] = [];
  for (const entry of entries) {
    const shocks = buildShocksForPhase(entry.phase, entry.severity);
    const expanded = expandShocks(shocks, entry.systemId);
    for (const s of expanded) result.push(s);
  }
  return result;
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

    // ── 2. Phase transitions (batched) ─────────────────────────────
    const expiredIds: string[] = [];

    // Collect all advancing events in one pass
    interface AdvancingEvent {
      snap: EventSnapshot;
      nextPhase: EventPhaseDefinition;
      duration: number;
    }
    const advancing: AdvancingEvent[] = [];

    for (const snap of snapshots) {
      const def = SCALED_DEFINITIONS[snap.type];
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
        advancing.push({ snap, nextPhase, duration });
      }
    }

    // Batch process all advancing events
    if (advancing.length > 0) {
      const advancingIds = advancing.map((a) => a.snap.id);

      // Batch delete old modifiers (1 query instead of N)
      await ctx.tx.eventModifier.deleteMany({
        where: { eventId: { in: advancingIds } },
      });

      // Batch create new modifiers (1 query instead of N)
      const modifierEntries = advancing.map((a) => ({
        eventId: a.snap.id,
        phase: a.nextPhase,
        systemId: a.snap.systemId,
        regionId: a.snap.regionId,
        severity: a.snap.severity,
      }));
      const allModifierRows = collectModifierRows(modifierEntries);
      if (allModifierRows.length > 0) {
        await ctx.tx.eventModifier.createMany({ data: allModifierRows });
      }

      // Batch apply shocks (2-3 queries instead of N×M)
      const transitionShocks = collectSystemShocks(
        advancing.map((a) => ({
          phase: a.nextPhase,
          severity: a.snap.severity,
          systemId: a.snap.systemId,
        })),
      );
      await applyShocksBulk(ctx.tx, transitionShocks);

      // Batch update event phases with unnest() (1 query instead of N)
      const phaseNames = advancing.map((a) => a.nextPhase.name);
      const phaseTicks = advancing.map(() => ctx.tick);
      const phaseDurations = advancing.map((a) => a.duration);

      await ctx.tx.$executeRaw`
        UPDATE "GameEvent" AS ge
        SET "phase" = batch."phase",
            "phaseStartTick" = batch."phaseStartTick",
            "phaseDuration" = batch."phaseDuration"
        FROM unnest(
          ${advancingIds}::text[],
          ${phaseNames}::text[],
          ${phaseTicks}::int[],
          ${phaseDurations}::int[]
        ) AS batch("id", "phase", "phaseStartTick", "phaseDuration")
        WHERE ge."id" = batch."id"`;

      // Notifications and logging
      for (const { snap, nextPhase, duration } of advancing) {
        const def = SCALED_DEFINITIONS[snap.type]!;
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
      }

      // ── Spread: batch-create child events at neighboring systems ──
      const spreadSources = advancing.filter(
        (a) => a.nextPhase.spread && a.nextPhase.spread.length > 0 && !a.snap.sourceEventId,
      );

      if (spreadSources.length > 0) {
        // Re-fetch active events once (not per-source)
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

        // Batch fetch all neighbors for all spread-source systems (1 query instead of N)
        const sourceSystemIds = spreadSources
          .map((s) => s.snap.systemId)
          .filter((id): id is string => id !== null);

        const allConnections = await ctx.tx.systemConnection.findMany({
          where: { fromSystemId: { in: sourceSystemIds } },
          select: {
            fromSystemId: true,
            toSystem: { select: { id: true, name: true, economyType: true, regionId: true } },
          },
        });

        // Group by source system
        const connectionsBySystem = new Map<string, typeof allConnections>();
        for (const conn of allConnections) {
          let list = connectionsBySystem.get(conn.fromSystemId);
          if (!list) {
            list = [];
            connectionsBySystem.set(conn.fromSystemId, list);
          }
          list.push(conn);
        }

        // Evaluate spread targets and collect all decisions
        interface SpreadDecisionWithSource {
          type: EventTypeId;
          phase: string;
          systemId: string;
          regionId: string;
          phaseDuration: number;
          severity: number;
          sourceEventId: string;
        }
        const allSpreadDecisions: SpreadDecisionWithSource[] = [];
        const spreadNameMap = new Map<string, string>(); // systemId → name

        for (const { snap, nextPhase } of spreadSources) {
          if (!snap.systemId) continue;

          const conns = connectionsBySystem.get(snap.systemId) ?? [];
          const neighbors: NeighborSnapshot[] = conns.map((c) => ({
            id: c.toSystem.id,
            economyType: c.toSystem.economyType,
            regionId: c.toSystem.regionId,
          }));
          for (const c of conns) spreadNameMap.set(c.toSystem.id, c.toSystem.name);

          const decisions = evaluateSpreadTargets(
            nextPhase.spread!,
            snap,
            neighbors,
            currentSnapshots,
            { maxEventsGlobal, maxEventsPerSystem },
            SCALED_DEFINITIONS,
            Math.random,
          );

          for (const d of decisions) {
            allSpreadDecisions.push({ ...d, sourceEventId: snap.id });
          }
        }

        if (allSpreadDecisions.length > 0) {
          // Bulk create spread events (1 query instead of N)
          const createdSpread = await ctx.tx.gameEvent.createManyAndReturn({
            data: allSpreadDecisions.map((d) => ({
              type: d.type,
              phase: d.phase,
              systemId: d.systemId,
              regionId: d.regionId,
              startTick: ctx.tick,
              phaseStartTick: ctx.tick,
              phaseDuration: d.phaseDuration,
              severity: d.severity,
              sourceEventId: d.sourceEventId,
            })),
            select: { id: true },
          });

          // Bulk create spread modifiers (1 query instead of N)
          const spreadModifierEntries = allSpreadDecisions.map((d, i) => {
            const def = SCALED_DEFINITIONS[d.type]!;
            return {
              eventId: createdSpread[i].id,
              phase: def.phases[0],
              systemId: d.systemId,
              regionId: d.regionId,
              severity: d.severity,
            };
          });
          const spreadModifierRows = collectModifierRows(spreadModifierEntries);
          if (spreadModifierRows.length > 0) {
            await ctx.tx.eventModifier.createMany({ data: spreadModifierRows });
          }

          // Bulk apply spread shocks (2-3 queries instead of N×M)
          const spreadShocks = collectSystemShocks(
            allSpreadDecisions.map((d) => {
              const def = SCALED_DEFINITIONS[d.type]!;
              return {
                phase: def.phases[0],
                severity: d.severity,
                systemId: d.systemId,
              };
            }),
          );
          await applyShocksBulk(ctx.tx, spreadShocks);

          // Notifications and logging
          for (const d of allSpreadDecisions) {
            const childDef = SCALED_DEFINITIONS[d.type]!;
            const childPhase = childDef.phases[0];
            const childSysName = spreadNameMap.get(d.systemId) ?? "Unknown";

            if (childPhase.notification) {
              notifications.push({
                message: childPhase.notification.replace("{systemName}", childSysName),
                type: d.type,
                refs: { system: { id: d.systemId, label: childSysName } },
              });
            }

            // Find the parent system name for logging
            const parentSnap = spreadSources.find((s) => s.snap.id === d.sourceEventId)?.snap;
            const parentSysName = parentSnap ? (systemNameById.get(parentSnap.id) ?? "Unknown") : "Unknown";
            console.log(
              `[events] Spread ${childDef.name} to ${childSysName} from ${parentSysName} (severity: ${d.severity.toFixed(2)})`,
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

    // ── 4. Spawn new events (batched) ─────────────────────────────
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

      // Fetch all systems for spawn selection (include name to avoid N+1 lookup)
      const allSystems = await ctx.tx.starSystem.findMany({
        select: { id: true, name: true, economyType: true, regionId: true },
      });

      const systemNameMap = new Map(allSystems.map((s) => [s.id, s.name]));

      const systemSnapshots: SystemSnapshot[] = allSystems.map((s) => ({
        id: s.id,
        economyType: s.economyType,
        regionId: s.regionId,
      }));

      const selectStart = performance.now();
      const decisions = selectEventsToSpawn(
        SCALED_DEFINITIONS,
        currentSnapshots,
        systemSnapshots,
        ctx.tick,
        { maxEventsGlobal, maxEventsPerSystem },
        Math.random,
        batchSize,
      );
      const selectMs = performance.now() - selectStart;

      if (decisions.length > 0) {
        const createStart = performance.now();

        // Bulk create all events (1 query instead of N)
        const createdEvents = await ctx.tx.gameEvent.createManyAndReturn({
          data: decisions.map((d) => ({
            type: d.type,
            phase: d.phase,
            systemId: d.systemId,
            regionId: d.regionId,
            startTick: ctx.tick,
            phaseStartTick: ctx.tick,
            phaseDuration: d.phaseDuration,
            severity: d.severity,
          })),
          select: { id: true },
        });

        // Bulk create all modifiers (1 query instead of N)
        const modifierEntries = decisions.map((d, i) => {
          const def = SCALED_DEFINITIONS[d.type]!;
          return {
            eventId: createdEvents[i].id,
            phase: def.phases[0],
            systemId: d.systemId,
            regionId: d.regionId,
            severity: d.severity,
          };
        });
        const allModifierRows = collectModifierRows(modifierEntries);
        if (allModifierRows.length > 0) {
          await ctx.tx.eventModifier.createMany({ data: allModifierRows });
        }

        // Bulk apply all shocks (2-3 queries instead of N×M)
        const allShocks = collectSystemShocks(
          decisions.map((d) => {
            const def = SCALED_DEFINITIONS[d.type]!;
            return {
              phase: def.phases[0],
              severity: d.severity,
              systemId: d.systemId,
            };
          }),
        );
        const shocksApplied = await applyShocksBulk(ctx.tx, allShocks);

        const createMs = performance.now() - createStart;

        // Notifications
        for (let i = 0; i < decisions.length; i++) {
          const decision = decisions[i];
          const def = SCALED_DEFINITIONS[decision.type]!;
          const firstPhase = def.phases[0];
          const sysName = systemNameMap.get(decision.systemId) ?? "Unknown";

          if (firstPhase.notification) {
            notifications.push({
              message: firstPhase.notification.replace("{systemName}", sysName),
              type: decision.type,
              refs: { system: { id: decision.systemId, label: sysName } },
            });
          }
        }

        console.log(
          `[events] Spawn tick ${ctx.tick}: ${currentSnapshots.length} active, ${allSystems.length} systems, ` +
          `caps={global:${maxEventsGlobal},batch:${batchSize}}, ` +
          `selected ${decisions.length} in ${selectMs.toFixed(0)}ms, ` +
          `created ${decisions.length} events + ${allModifierRows.length} modifiers + ${shocksApplied} shocks in ${createMs.toFixed(0)}ms`,
        );
      } else {
        console.log(
          `[events] Spawn tick ${ctx.tick}: ${currentSnapshots.length} active, ${allSystems.length} systems, ` +
          `caps={global:${maxEventsGlobal},batch:${batchSize}}, selected 0 in ${selectMs.toFixed(0)}ms`,
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
