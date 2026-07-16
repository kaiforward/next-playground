import type {
  TickContext,
  TickProcessorResult,
  EventNotificationPayload,
} from "../types";
import type { EventPhaseDefinition, EventTypeId } from "@/lib/constants/events";
import {
  checkPhaseTransition,
  buildModifiersForPhase,
  buildShocksForPhase,
  evaluateSpreadTargets,
  selectEventsToSpawn,
  rollPhaseDuration,
  type SystemSnapshot,
  type ShockRow,
} from "@/lib/engine/events";

/**
 * Relations-spawned events whose lifecycle is owned by the relations
 * processor (single-phase, informational, expiry resolved via
 * `metadata.expiresAtTick`). The events processor skips phase transitions
 * for these; `border_conflict` is intentionally NOT in this set because it
 * has multi-phase modifiers driven by the events processor as normal.
 */
const RELATIONS_OWNED_LIFECYCLE: ReadonlySet<EventTypeId> = new Set<EventTypeId>([
  "pact_under_negotiation",
  "alliance_dissolved",
]);
import type {
  EventCreate,
  EventsProcessorParams,
  EventsWorld,
  EventWithName,
  NeighborWithName,
  PhaseAdvance,
  SystemShock,
} from "@/lib/tick/world/events-world";

/**
 * Expand ShockRow[] for a single system into SystemShock[]. The processor
 * body owns shock-mode handling now — the live adapter used to expand inline,
 * the sim used to drop the mode entirely. Both bugs go away once the work
 * happens here.
 */
function expandShocks(rows: ShockRow[], systemId: string | null): SystemShock[] {
  if (!systemId || rows.length === 0) return [];
  return rows.map((r) => ({
    systemId,
    goodId: r.goodId,
    parameter: r.parameter,
    value: r.value,
    mode: r.mode,
  }));
}

/**
 * Pure processor body, run against the in-memory adapter — the one backend.
 * Knobs the body shouldn't hard-code (RNG, caps, batch size, definitions,
 * spawn gating) arrive via `params`.
 */
export async function runEventsProcessor(
  world: EventsWorld,
  ctx: TickContext,
  params: EventsProcessorParams,
): Promise<TickProcessorResult> {
  const { rng, caps, batchSize, spawnInterval, definitions, spawnEnabled } = params;

  const notifications: EventNotificationPayload[] = [];

  // ── 1. Fetch active events ────────────────────────────────────
  const events = await world.getEvents();

  // ── 2. Phase transitions ──────────────────────────────────────
  interface AdvancingEvent {
    snap: EventWithName;
    nextPhase: EventPhaseDefinition;
    duration: number;
  }
  const advancing: AdvancingEvent[] = [];
  const expiredIds: string[] = [];

  for (const ev of events) {
    const def = definitions[ev.type];
    if (!def) {
      expiredIds.push(ev.id);
      continue;
    }

    // Skip events whose lifecycle the relations processor owns. Their stored
    // phaseDuration is a sentinel (RELATIONS_PHASE_SENTINEL); never advance
    // or auto-expire them — relations resolves them via metadata.expiresAtTick.
    if (RELATIONS_OWNED_LIFECYCLE.has(ev.type)) continue;

    const result = checkPhaseTransition(ev, ctx.tick, def);
    if (result === "expire") {
      expiredIds.push(ev.id);
      const sysName = ev.systemName ?? "Unknown";
      notifications.push({
        message: `${def.name} at ${sysName} has ended.`,
        type: ev.type,
        refs: ev.systemId ? { system: { id: ev.systemId, label: sysName } } : {},
      });
      continue;
    }

    if (result === "advance") {
      const currentIndex = def.phases.findIndex((p) => p.name === ev.phase);
      const nextPhase = def.phases[currentIndex + 1];
      const duration = rollPhaseDuration(nextPhase.durationRange, rng);
      advancing.push({ snap: ev, nextPhase, duration });
    }
  }

  // Apply advances + transition shocks + spread, in that order
  if (advancing.length > 0) {
    const advances: PhaseAdvance[] = advancing.map((a) => ({
      eventId: a.snap.id,
      nextPhaseName: a.nextPhase.name,
      phaseStartTick: ctx.tick,
      phaseDuration: a.duration,
      modifiers: buildModifiersForPhase(
        a.nextPhase,
        a.snap.systemId,
        a.snap.regionId,
        a.snap.severity,
      ),
    }));
    await world.advancePhases(advances);

    const transitionShocks: SystemShock[] = [];
    for (const a of advancing) {
      transitionShocks.push(
        ...expandShocks(
          buildShocksForPhase(a.nextPhase, a.snap.severity),
          a.snap.systemId,
        ),
      );
    }
    await world.applyShocks(transitionShocks);

    // Notifications + logging for advancing events
    for (const { snap, nextPhase, duration } of advancing) {
      const def = definitions[snap.type]!;
      const sysName = snap.systemName ?? "Unknown";
      if (nextPhase.notification) {
        notifications.push({
          message: nextPhase.notification.replace("{systemName}", sysName),
          type: snap.type,
          refs: snap.systemId
            ? { system: { id: snap.systemId, label: sysName } }
            : {},
        });
      }
      console.log(
        `[events] ${def.name} at ${sysName}: ${snap.phase} → ${nextPhase.name} (${duration} ticks)`,
      );
    }

    // Spread — only for root events (no sourceEventId) that have spread rules.
    const spreadSources = advancing.filter(
      (a) =>
        a.nextPhase.spread &&
        a.nextPhase.spread.length > 0 &&
        !a.snap.sourceEventId &&
        a.snap.systemId,
    );

    if (spreadSources.length > 0) {
      const sourceSystemIds = spreadSources.map((a) => a.snap.systemId!);
      const neighborMap = await world.getNeighborsBySystem(sourceSystemIds);

      // Re-snapshot active events post-advance for accurate cap checks
      const currentEvents = await world.getEvents();

      interface SpreadCreate {
        create: EventCreate;
        nameForLog: string;
        parentName: string;
      }
      const spreadCreates: SpreadCreate[] = [];

      for (const { snap, nextPhase } of spreadSources) {
        const neighbors: NeighborWithName[] =
          neighborMap.get(snap.systemId!) ?? [];

        const decisions = evaluateSpreadTargets(
          nextPhase.spread!,
          snap,
          neighbors,
          currentEvents,
          { maxEventsGlobal: caps.maxEventsGlobal, maxEventsPerSystem: caps.maxEventsPerSystem },
          definitions,
          rng,
        );

        for (const d of decisions) {
          const childDef = definitions[d.type]!;
          const childPhase = childDef.phases[0];
          const neighborName =
            neighbors.find((n) => n.id === d.systemId)?.name ?? "Unknown";
          spreadCreates.push({
            create: {
              type: d.type,
              phase: d.phase,
              systemId: d.systemId,
              regionId: d.regionId,
              startTick: ctx.tick,
              phaseStartTick: ctx.tick,
              phaseDuration: d.phaseDuration,
              severity: d.severity,
              sourceEventId: snap.id,
              modifiers: buildModifiersForPhase(
                childPhase,
                d.systemId,
                d.regionId,
                d.severity,
              ),
            },
            nameForLog: neighborName,
            parentName: snap.systemName ?? "Unknown",
          });
        }
      }

      if (spreadCreates.length > 0) {
        await world.createEvents(spreadCreates.map((s) => s.create));

        // Apply spread shocks (first-phase shocks for each new child).
        const spreadShocks: SystemShock[] = [];
        for (const { create } of spreadCreates) {
          const childDef = definitions[create.type]!;
          spreadShocks.push(
            ...expandShocks(
              buildShocksForPhase(childDef.phases[0], create.severity),
              create.systemId,
            ),
          );
        }
        await world.applyShocks(spreadShocks);

        for (const { create, nameForLog, parentName } of spreadCreates) {
          const childDef = definitions[create.type]!;
          const childPhase = childDef.phases[0];
          if (childPhase.notification) {
            notifications.push({
              message: childPhase.notification.replace("{systemName}", nameForLog),
              type: create.type,
              refs: { system: { id: create.systemId, label: nameForLog } },
            });
          }
          console.log(
            `[events] Spread ${childDef.name} to ${nameForLog} from ${parentName} (severity: ${create.severity.toFixed(2)})`,
          );
        }
      }
    }
  }

  // ── 3. Expire completed events ────────────────────────────────
  if (expiredIds.length > 0) {
    await world.expireEvents(expiredIds);
    console.log(`[events] Expired ${expiredIds.length} event(s)`);
  }

  // ── 4. Spawn new events on spawn ticks ─────────────────────────
  const isSpawnTick = ctx.tick % spawnInterval === 0;
  if (isSpawnTick && spawnEnabled) {
    // Re-snapshot post-expiry for accurate cap checking
    const currentEvents = await world.getEvents();
    const systems = await world.getSystems();
    const systemSnapshots: SystemSnapshot[] = systems.map((s) => ({
      id: s.id,
      economyType: s.economyType,
      regionId: s.regionId,
    }));
    const nameMap = new Map(systems.map((s) => [s.id, s.name]));

    const selectStart = performance.now();
    const decisions = selectEventsToSpawn(
      definitions,
      currentEvents,
      systemSnapshots,
      ctx.tick,
      { maxEventsGlobal: caps.maxEventsGlobal, maxEventsPerSystem: caps.maxEventsPerSystem },
      rng,
      batchSize,
    );
    const selectMs = performance.now() - selectStart;

    if (decisions.length > 0) {
      const createStart = performance.now();
      const spawnCreates: EventCreate[] = decisions.map((d) => {
        const def = definitions[d.type]!;
        const firstPhase = def.phases[0];
        return {
          type: d.type,
          phase: d.phase,
          systemId: d.systemId,
          regionId: d.regionId,
          startTick: ctx.tick,
          phaseStartTick: ctx.tick,
          phaseDuration: d.phaseDuration,
          severity: d.severity,
          sourceEventId: null,
          modifiers: buildModifiersForPhase(
            firstPhase,
            d.systemId,
            d.regionId,
            d.severity,
          ),
        };
      });

      await world.createEvents(spawnCreates);

      const spawnShocks: SystemShock[] = [];
      for (const c of spawnCreates) {
        const def = definitions[c.type]!;
        spawnShocks.push(
          ...expandShocks(buildShocksForPhase(def.phases[0], c.severity), c.systemId),
        );
      }
      const shocksApplied = await world.applyShocks(spawnShocks);

      const createMs = performance.now() - createStart;

      for (const c of spawnCreates) {
        const def = definitions[c.type]!;
        const firstPhase = def.phases[0];
        const sysName = nameMap.get(c.systemId) ?? "Unknown";
        if (firstPhase.notification) {
          notifications.push({
            message: firstPhase.notification.replace("{systemName}", sysName),
            type: c.type,
            refs: { system: { id: c.systemId, label: sysName } },
          });
        }
      }

      const modifierCount = spawnCreates.reduce((n, c) => n + c.modifiers.length, 0);
      console.log(
        `[events] Spawn tick ${ctx.tick}: ${currentEvents.length} active, ${systems.length} systems, ` +
          `caps={global:${caps.maxEventsGlobal},batch:${batchSize}}, ` +
          `selected ${decisions.length} in ${selectMs.toFixed(0)}ms, ` +
          `created ${decisions.length} events + ${modifierCount} modifiers + ${shocksApplied} shocks in ${createMs.toFixed(0)}ms`,
      );
    } else {
      console.log(
        `[events] Spawn tick ${ctx.tick}: ${currentEvents.length} active, ${systems.length} systems, ` +
          `caps={global:${caps.maxEventsGlobal},batch:${batchSize}}, selected 0 in ${selectMs.toFixed(0)}ms`,
      );
    }
  }

  return {
    globalEvents:
      notifications.length > 0 ? { eventNotifications: notifications } : {},
  };
}
