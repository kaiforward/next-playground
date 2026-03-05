import { prisma } from "../lib/prisma";
import { UNIVERSE_GEN } from "../lib/constants/universe-gen";
import { scaleEventCaps, EVENT_SPAWN_INTERVAL } from "../lib/constants/events";
import { selectEventsToSpawn, type EventSnapshot, type SystemSnapshot } from "../lib/engine/events";
import { toEventTypeId } from "../lib/types/guards";

async function main() {
  console.log("UNIVERSE_SCALE:", process.env.UNIVERSE_SCALE);
  console.log("UNIVERSE_GEN.TOTAL_SYSTEMS:", UNIVERSE_GEN.TOTAL_SYSTEMS);

  const caps = scaleEventCaps(UNIVERSE_GEN.TOTAL_SYSTEMS);
  console.log("\nScaled caps:");
  console.log("  maxEventsGlobal:", caps.maxEventsGlobal);
  console.log("  maxEventsPerSystem:", caps.maxEventsPerSystem);
  console.log("  batchSize:", caps.batchSize);
  console.log("  EVENT_SPAWN_INTERVAL:", EVENT_SPAWN_INTERVAL);
  console.log("\n  Per-type maxActive:");
  for (const [key, def] of Object.entries(caps.definitions)) {
    if (def.weight > 0) {
      console.log(`    ${key}: weight=${def.weight}, maxActive=${def.maxActive}, cooldown=${def.cooldown}`);
    }
  }

  // Fetch real data
  const world = await prisma.gameWorld.findUniqueOrThrow({ where: { id: "world" } });
  const tick = world.currentTick;
  console.log("\nCurrent tick:", tick);

  const dbEvents = await prisma.gameEvent.findMany({
    select: {
      id: true, type: true, phase: true,
      systemId: true, regionId: true,
      startTick: true, phaseStartTick: true,
      phaseDuration: true, severity: true,
      sourceEventId: true,
    },
  });

  const snapshots: EventSnapshot[] = dbEvents.map((e) => ({
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
  }));

  console.log("Active events:", snapshots.length);

  const allSystems = await prisma.starSystem.findMany({
    select: { id: true, economyType: true, regionId: true },
  });

  const systemSnapshots: SystemSnapshot[] = allSystems.map((s) => ({
    id: s.id,
    economyType: s.economyType,
    regionId: s.regionId,
  }));

  console.log("Total systems:", systemSnapshots.length);

  // Run spawn selection
  const start = performance.now();
  const decisions = selectEventsToSpawn(
    caps.definitions,
    snapshots,
    systemSnapshots,
    tick,
    { maxEventsGlobal: caps.maxEventsGlobal, maxEventsPerSystem: caps.maxEventsPerSystem },
    Math.random,
    caps.batchSize,
  );
  const elapsed = performance.now() - start;

  console.log(`\nSpawn selection returned ${decisions.length} decisions in ${elapsed.toFixed(1)}ms`);
  for (const d of decisions.slice(0, 10)) {
    console.log(`  ${d.type} @ system ${d.systemId.slice(0, 12)}... phase="${d.phase}" dur=${d.phaseDuration}`);
  }
  if (decisions.length > 10) {
    console.log(`  ... and ${decisions.length - 10} more`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
