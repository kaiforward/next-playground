/**
 * The game worker (client-runtime spec §1, §4, §6, §9) — boots world-less, answers the
 * save-lifecycle commands (`listSaves`/`newGame`/`loadGame`) in that state, and afterwards runs the
 * real `TickLoop` behind its existing 250 ms throttle, pushing pacing + state frames to whatever
 * host it's wired to (a real `Worker`'s `self` via `host.ts`, or a fake host in tests).
 *
 * **The boot seam (spec §6):** static imports here are deliberately limited to protocol/schema
 * TYPES (erased at compile time — zero runtime footprint) plus `./boot` and `./host`, neither of
 * which reaches the engine/constants graph. Everything that does — `tick-loop`, `store`,
 * `runtime/snapshot`, the mutation services, and the Zod schemas that validate command payloads —
 * arrives only via the dynamic `import()`s inside `loadEngine`, called AFTER `bootHost` has set the
 * boot-configuration global, so `ECONOMY_SCALE`'s module-evaluation-time constant tables see the
 * resolved scale rather than the Node default. The schemas are dynamic-imported for the same
 * reason stated in the task's architecture note — not because they reach `ECONOMY_SCALE`
 * themselves (they don't), but because the module's own static-import surface is the thing being
 * kept small and inspectable, not case-by-case judged per import.
 *
 * **Command-versus-queue call pattern (ledgered item 1, `lib/runtime/snapshot.ts`):** every state
 * frame built here passes `buildStateFrame` the EXACT reference `getWorld()` returns immediately
 * beforehand — never a world constructed elsewhere and not yet committed. That is what makes
 * `ensureWorldCommitted` safe to throw on a mismatch instead of silently adopting a foreign world
 * (see that module's docstring for the resolution).
 */
import type { BootConfig, CommandEnvelope, CommandResult, InterestSet, PacingFrame, TickFailedMsg } from "@/lib/runtime/channel";
import { EMPTY_INTEREST } from "@/lib/runtime/channel";
import type { StateFrame } from "@/lib/runtime/snapshot";
import type { Speed } from "@/lib/world/tick-loop";
import type { WorldMeta } from "@/lib/world/types";
import type { SaveInfo } from "@/lib/world/save-backend";
import type {
  NewGameInput,
  LoadGameInput,
  SaveGameInput,
  SpeedInput,
  ExportSaveInput,
  ImportSaveInput,
} from "@/lib/schemas/game-setup";
import type { OrderBuildInput, OrderLaneUpgradeInput, AutomationInput } from "@/lib/schemas/construction-orders";
import type { ClaimSystemInput } from "@/lib/schemas/claims";
import type { TreasuryPolicyInput } from "@/lib/schemas/treasury";
import type { PinInput } from "@/lib/schemas/player-pins";
import type { AlertCategoryInput, TrackerSectionInput } from "@/lib/schemas/player-settings";
import type { OrderBuildResult, OrderColonyResult, OrderLaneUpgradeResult, CancelOrderResult, SetAutomationResult } from "@/lib/services/construction-orders";
import type { ClaimSystemResult } from "@/lib/services/claims";
import type { UpdateTreasuryPolicyResult } from "@/lib/services/treasury";
import type { SetSystemPinResult } from "@/lib/services/player-pins";
import type { SetAlertCategoryResult, SetTrackerSectionResult } from "@/lib/services/player-settings";
import type { LoadGameResult, SaveGameResult, ExportSaveResult, ImportSaveResult } from "@/lib/services/game";
import type { DevCommandEnvelope, DevCommandResultMessage, DevHandlers } from "./dev-commands";

import { bootHost } from "./boot";
import { createWorkerHost, type WorkerHost, type RawWorkerScope } from "./host";

// ── Command registry ───────────────────────────────────────────────────────
//
// Every command the worker answers, and the exact result each yields — reused verbatim from the
// mutation services' own exported result types (never a parallel DTO), same rule
// `lib/runtime/snapshot.ts` follows for `MarketSlice`. Dev cheats are out of scope (a later task);
// every other mutation hook in `lib/hooks/` today has an entry here.

type OrderBuildData = Extract<OrderBuildResult, { ok: true }>["data"];
type OrderColonyData = Extract<OrderColonyResult, { ok: true }>["data"];
type OrderLaneUpgradeData = Extract<OrderLaneUpgradeResult, { ok: true }>["data"];
type ClaimSystemData = Extract<ClaimSystemResult, { ok: true }>["data"];
type CancelOrderData = Extract<CancelOrderResult, { ok: true }>["data"];
type SetAutomationData = Extract<SetAutomationResult, { ok: true }>["data"];
type UpdateTreasuryPolicyData = Extract<UpdateTreasuryPolicyResult, { ok: true }>["data"];
type SetSystemPinData = Extract<SetSystemPinResult, { ok: true }>["data"];
type SetAlertCategoryData = Extract<SetAlertCategoryResult, { ok: true }>["data"];
type SetTrackerSectionData = Extract<SetTrackerSectionResult, { ok: true }>["data"];
type LoadGameData = Extract<LoadGameResult, { ok: true }>["data"];
type SaveGameData = Extract<SaveGameResult, { ok: true }>["data"];
type ExportSaveData = Extract<ExportSaveResult, { ok: true }>["data"];
type ImportSaveData = Extract<ImportSaveResult, { ok: true }>["data"];

export interface GameCommandMap {
  orderBuild: { payload: OrderBuildInput & { systemId: string }; data: OrderBuildData };
  orderColony: { payload: { systemId: string }; data: OrderColonyData };
  orderLaneUpgrade: { payload: OrderLaneUpgradeInput; data: OrderLaneUpgradeData };
  claimSystem: { payload: ClaimSystemInput; data: ClaimSystemData };
  cancelOrder: { payload: { projectId: string }; data: CancelOrderData };
  setAutomation: { payload: AutomationInput; data: SetAutomationData };
  updateTreasuryPolicy: { payload: TreasuryPolicyInput & { factionId: string }; data: UpdateTreasuryPolicyData };
  setSystemPin: { payload: PinInput; data: SetSystemPinData };
  setAlertCategory: { payload: AlertCategoryInput; data: SetAlertCategoryData };
  setTrackerSection: { payload: TrackerSectionInput; data: SetTrackerSectionData };
  setSpeed: { payload: SpeedInput; data: { speed: Speed } };
  listSaves: { payload: null; data: SaveInfo[] };
  newGame: { payload: NewGameInput; data: WorldMeta };
  loadGame: { payload: LoadGameInput; data: LoadGameData };
  saveGame: { payload: SaveGameInput; data: SaveGameData };
  exportSave: { payload: ExportSaveInput; data: ExportSaveData };
  importSave: { payload: ImportSaveInput; data: ImportSaveData };
}

export type GameCommandType = keyof GameCommandMap;

/** One posted command — a discriminated union over every command type, each carrying exactly its
 *  own payload shape (`CommandEnvelope` from `lib/runtime/channel.ts`, concretised here). */
export type GameCommandEnvelope = {
  [K in GameCommandType]: CommandEnvelope<K, GameCommandMap[K]["payload"]>;
}[GameCommandType];

/** One command's answer, correlated back to its envelope's `id`. */
export type GameCommandResultMessage = {
  [K in GameCommandType]: { type: "commandResult"; id: string; result: CommandResult<GameCommandMap[K]["data"]> };
}[GameCommandType];

// ── Wire protocol ───────────────────────────────────────────────────────────

export type InboundMessage =
  | { type: "boot"; config: BootConfig }
  | { type: "subscribe" }
  | { type: "interest"; interest: InterestSet }
  | { type: "command"; envelope: GameCommandEnvelope | DevCommandEnvelope };

export type OutboundMessage =
  | { type: "pacing"; frame: PacingFrame }
  | { type: "state"; frame: StateFrame }
  | { type: "tickFailed"; msg: TickFailedMsg }
  /** An autosave attempt's result (spec §5) — `error: null` on a clean write,
   *  the failure's message otherwise. Relayed from `TickLoop.subscribeAutosave`
   *  (`lib/world/tick-loop.ts`); `client/worker-connection.ts` turns this into
   *  `GameStore.setAutosaveFailure`, so a persistently failing autosave reaches the player rather
   *  than only `console.error`. */
  | { type: "autosaveResult"; error: string | null }
  | GameCommandResultMessage
  | DevCommandResultMessage;

// ── The dynamically-imported engine graph ───────────────────────────────────

type TickLoopModule = typeof import("@/lib/world/tick-loop");
type StoreModule = typeof import("@/lib/world/store");
type SnapshotModule = typeof import("@/lib/runtime/snapshot");
type GameServiceModule = typeof import("@/lib/services/game");
type ConstructionOrdersModule = typeof import("@/lib/services/construction-orders");
type ClaimsModule = typeof import("@/lib/services/claims");
type TreasuryModule = typeof import("@/lib/services/treasury");
type PlayerPinsModule = typeof import("@/lib/services/player-pins");
type PlayerSettingsModule = typeof import("@/lib/services/player-settings");
type GameSetupSchemas = typeof import("@/lib/schemas/game-setup");
type ConstructionOrderSchemas = typeof import("@/lib/schemas/construction-orders");
type ClaimsSchemas = typeof import("@/lib/schemas/claims");
type TreasurySchemas = typeof import("@/lib/schemas/treasury");
type PlayerPinsSchemas = typeof import("@/lib/schemas/player-pins");
type PlayerSettingsSchemas = typeof import("@/lib/schemas/player-settings");

interface Engine {
  tickLoop: TickLoopModule["tickLoop"];
  hasWorld: StoreModule["hasWorld"];
  getWorld: StoreModule["getWorld"];
  getWorldVersion: StoreModule["getWorldVersion"];
  buildStateFrame: SnapshotModule["buildStateFrame"];
  newGame: GameServiceModule["newGame"];
  setGameSpeed: GameServiceModule["setGameSpeed"];
  loadGame: GameServiceModule["loadGame"];
  listGameSaves: GameServiceModule["listGameSaves"];
  saveGame: GameServiceModule["saveGame"];
  exportSave: GameServiceModule["exportSave"];
  importSave: GameServiceModule["importSave"];
  orderBuild: ConstructionOrdersModule["orderBuild"];
  orderColony: ConstructionOrdersModule["orderColony"];
  orderLaneUpgrade: ConstructionOrdersModule["orderLaneUpgrade"];
  claimSystem: ClaimsModule["claimSystem"];
  cancelOrder: ConstructionOrdersModule["cancelOrder"];
  setAutomation: ConstructionOrdersModule["setAutomation"];
  updateTreasuryPolicy: TreasuryModule["updateTreasuryPolicy"];
  setSystemPin: PlayerPinsModule["setSystemPin"];
  setAlertCategory: PlayerSettingsModule["setAlertCategory"];
  setTrackerSection: PlayerSettingsModule["setTrackerSection"];
  schemas: {
    newGameSchema: GameSetupSchemas["newGameSchema"];
    loadGameSchema: GameSetupSchemas["loadGameSchema"];
    saveGameSchema: GameSetupSchemas["saveGameSchema"];
    speedSchema: GameSetupSchemas["speedSchema"];
    exportSaveSchema: GameSetupSchemas["exportSaveSchema"];
    importSaveSchema: GameSetupSchemas["importSaveSchema"];
    orderBuildSchema: ConstructionOrderSchemas["orderBuildSchema"];
    orderLaneUpgradeSchema: ConstructionOrderSchemas["orderLaneUpgradeSchema"];
    automationSchema: ConstructionOrderSchemas["automationSchema"];
    claimSystemSchema: ClaimsSchemas["claimSystemSchema"];
    treasuryPolicySchema: TreasurySchemas["treasuryPolicySchema"];
    pinSchema: PlayerPinsSchemas["pinSchema"];
    alertCategorySchema: PlayerSettingsSchemas["alertCategorySchema"];
    trackerSectionSchema: PlayerSettingsSchemas["trackerSectionSchema"];
  };
  /** Populated only in a dev build (`import.meta.env.DEV`) — see `dev-commands.ts`'s header
   *  docstring for why the guard lives here as a literal rather than through `isDevBuild()`. */
  dev: DevHandlers | null;
}

async function loadEngine(config: BootConfig): Promise<Engine> {
  await bootHost(config);
  const [tickLoopMod, storeMod, snapshotMod, gameMod, ordersMod, claimsMod, treasuryMod, pinsMod, settingsMod,
    gameSetupSchemas, orderSchemas, claimsSchemas, treasurySchemas, pinsSchemas, settingsSchemas] = await Promise.all([
    import("@/lib/world/tick-loop"),
    import("@/lib/world/store"),
    import("@/lib/runtime/snapshot"),
    import("@/lib/services/game"),
    import("@/lib/services/construction-orders"),
    import("@/lib/services/claims"),
    import("@/lib/services/treasury"),
    import("@/lib/services/player-pins"),
    import("@/lib/services/player-settings"),
    import("@/lib/schemas/game-setup"),
    import("@/lib/schemas/construction-orders"),
    import("@/lib/schemas/claims"),
    import("@/lib/schemas/treasury"),
    import("@/lib/schemas/player-pins"),
    import("@/lib/schemas/player-settings"),
  ]);
  // Literal `import.meta.env.DEV` guard (not `isDevBuild()`) — see `dev-commands.ts`'s header
  // docstring: Rollup needs this exact expression to dead-code-eliminate the branch, dropping
  // `loadDevHandlers`'s target (`lib/services/dev-tools.ts`) from a production bundle entirely.
  const dev = import.meta.env.DEV ? await (await import("./dev-commands")).loadDevHandlers() : null;
  return {
    tickLoop: tickLoopMod.tickLoop,
    hasWorld: storeMod.hasWorld,
    getWorld: storeMod.getWorld,
    getWorldVersion: storeMod.getWorldVersion,
    buildStateFrame: snapshotMod.buildStateFrame,
    newGame: gameMod.newGame,
    setGameSpeed: gameMod.setGameSpeed,
    loadGame: gameMod.loadGame,
    listGameSaves: gameMod.listGameSaves,
    saveGame: gameMod.saveGame,
    exportSave: gameMod.exportSave,
    importSave: gameMod.importSave,
    orderBuild: ordersMod.orderBuild,
    orderColony: ordersMod.orderColony,
    orderLaneUpgrade: ordersMod.orderLaneUpgrade,
    claimSystem: claimsMod.claimSystem,
    cancelOrder: ordersMod.cancelOrder,
    setAutomation: ordersMod.setAutomation,
    updateTreasuryPolicy: treasuryMod.updateTreasuryPolicy,
    setSystemPin: pinsMod.setSystemPin,
    setAlertCategory: settingsMod.setAlertCategory,
    setTrackerSection: settingsMod.setTrackerSection,
    schemas: {
      newGameSchema: gameSetupSchemas.newGameSchema,
      loadGameSchema: gameSetupSchemas.loadGameSchema,
      saveGameSchema: gameSetupSchemas.saveGameSchema,
      speedSchema: gameSetupSchemas.speedSchema,
      exportSaveSchema: gameSetupSchemas.exportSaveSchema,
      importSaveSchema: gameSetupSchemas.importSaveSchema,
      orderBuildSchema: orderSchemas.orderBuildSchema,
      orderLaneUpgradeSchema: orderSchemas.orderLaneUpgradeSchema,
      automationSchema: orderSchemas.automationSchema,
      claimSystemSchema: claimsSchemas.claimSystemSchema,
      treasuryPolicySchema: treasurySchemas.treasuryPolicySchema,
      pinSchema: pinsSchemas.pinSchema,
      alertCategorySchema: settingsSchemas.alertCategorySchema,
      trackerSectionSchema: settingsSchemas.trackerSectionSchema,
    },
    dev,
  };
}

function zodIssueMessage(error: { issues: { message: string }[] }): string {
  return error.issues.map((issue) => issue.message).join(", ");
}

/**
 * Runs a world-mutating command against the ambient singleton, safely whether or not a world
 * exists yet. **No world:** `TickLoop.tickOnce` bails whenever `!hasWorld()`
 * (`lib/world/tick-loop.ts:199`), so no tick can possibly be in flight — `fn` runs immediately,
 * and its own internal `setWorld` (every mutation service commits itself) is the only commit.
 * **A world exists:** a tick COULD be mid-`await` (`lib/world/tick-loop.ts:140-141`), so `fn` is
 * queued via `TickLoop.enqueueCommand`, which only ever invokes it between ticks. The mutation
 * services are not written in `enqueueCommand`'s pure "world in, world out" shape — they read and
 * write the singleton themselves — so `run` below hands them back `{ world: getWorld(), result }`
 * (the world `fn` just committed), which `enqueueCommand` then re-commits via its own `setWorld`.
 * That second commit is a genuine no-op on content (same reference) but still bumps
 * `getWorldVersion()` a second time — a documented, accepted wart (judgment call, see the PR
 * description): the version counter skips one integer per in-game command, which affects nothing
 * that reads it for monotonicity rather than for its literal value, and avoiding it would mean
 * either reworking every mutation service's calling convention (out of this task's scope) or
 * adding a second, service-aware code path to `TickLoop` (the very `TickLoop.emit` hook the
 * architecture decision for this task rules out).
 */
function runWorldMutatingCommand<T>(engine: Engine, fn: () => T): Promise<{ result: T; worldVersion: number }> {
  if (!engine.hasWorld()) {
    const result = fn();
    return Promise.resolve({ result, worldVersion: engine.getWorldVersion() });
  }
  return engine.tickLoop.enqueueCommand((world) => {
    void world;
    const result = fn();
    return { world: engine.getWorld(), result };
  });
}

/** Dev commands are unavailable in this build (`Engine.dev` is `null`) — a production worker never
 *  hits this because the case bodies below are unreachable without a dev registry, but a dev
 *  build's own worker answers it the same discriminated-error way every other command failure does,
 *  never a thrown exception. */
const DEV_COMMANDS_UNAVAILABLE = "Dev commands unavailable in this build.";

async function runCommand(
  engine: Engine,
  envelope: GameCommandEnvelope | DevCommandEnvelope,
): Promise<GameCommandResultMessage | DevCommandResultMessage> {
  const { id } = envelope;
  try {
    switch (envelope.type) {
      case "orderBuild": {
        const parsed = engine.schemas.orderBuildSchema.safeParse(envelope.payload);
        if (!parsed.success) {
          return { type: "commandResult", id, result: { ok: false, error: zodIssueMessage(parsed.error) } };
        }
        const { result } = await runWorldMutatingCommand(engine, () =>
          engine.orderBuild({ systemId: envelope.payload.systemId, ...parsed.data }));
        return { type: "commandResult", id, result };
      }
      case "orderColony": {
        const { result } = await runWorldMutatingCommand(engine, () => engine.orderColony(envelope.payload));
        return { type: "commandResult", id, result };
      }
      case "orderLaneUpgrade": {
        const parsed = engine.schemas.orderLaneUpgradeSchema.safeParse(envelope.payload);
        if (!parsed.success) {
          return { type: "commandResult", id, result: { ok: false, error: zodIssueMessage(parsed.error) } };
        }
        const { result } = await runWorldMutatingCommand(engine, () => engine.orderLaneUpgrade(parsed.data));
        return { type: "commandResult", id, result };
      }
      case "claimSystem": {
        const parsed = engine.schemas.claimSystemSchema.safeParse(envelope.payload);
        if (!parsed.success) {
          return { type: "commandResult", id, result: { ok: false, error: zodIssueMessage(parsed.error) } };
        }
        const { result } = await runWorldMutatingCommand(engine, () => engine.claimSystem(parsed.data));
        return { type: "commandResult", id, result };
      }
      case "cancelOrder": {
        const { result } = await runWorldMutatingCommand(engine, () => engine.cancelOrder(envelope.payload));
        return { type: "commandResult", id, result };
      }
      case "setAutomation": {
        const parsed = engine.schemas.automationSchema.safeParse(envelope.payload);
        if (!parsed.success) {
          return { type: "commandResult", id, result: { ok: false, error: zodIssueMessage(parsed.error) } };
        }
        const { result } = await runWorldMutatingCommand(engine, () => engine.setAutomation(parsed.data));
        return { type: "commandResult", id, result };
      }
      case "updateTreasuryPolicy": {
        const { factionId, ...policy } = envelope.payload;
        const parsed = engine.schemas.treasuryPolicySchema.safeParse(policy);
        if (!parsed.success) {
          return { type: "commandResult", id, result: { ok: false, error: zodIssueMessage(parsed.error) } };
        }
        const { result } = await runWorldMutatingCommand(engine, () =>
          engine.updateTreasuryPolicy(factionId, parsed.data));
        return { type: "commandResult", id, result };
      }
      case "setSystemPin": {
        const parsed = engine.schemas.pinSchema.safeParse(envelope.payload);
        if (!parsed.success) {
          return { type: "commandResult", id, result: { ok: false, error: zodIssueMessage(parsed.error) } };
        }
        const { result } = await runWorldMutatingCommand(engine, () => engine.setSystemPin(parsed.data));
        return { type: "commandResult", id, result };
      }
      case "setAlertCategory": {
        const parsed = engine.schemas.alertCategorySchema.safeParse(envelope.payload);
        if (!parsed.success) {
          return { type: "commandResult", id, result: { ok: false, error: zodIssueMessage(parsed.error) } };
        }
        const { result } = await runWorldMutatingCommand(engine, () => engine.setAlertCategory(parsed.data));
        return { type: "commandResult", id, result };
      }
      case "setTrackerSection": {
        const parsed = engine.schemas.trackerSectionSchema.safeParse(envelope.payload);
        if (!parsed.success) {
          return { type: "commandResult", id, result: { ok: false, error: zodIssueMessage(parsed.error) } };
        }
        const { result } = await runWorldMutatingCommand(engine, () => engine.setTrackerSection(parsed.data));
        return { type: "commandResult", id, result };
      }
      case "setSpeed": {
        const parsed = engine.schemas.speedSchema.safeParse(envelope.payload);
        if (!parsed.success) {
          return { type: "commandResult", id, result: { ok: false, error: zodIssueMessage(parsed.error) } };
        }
        // Not a world write (no `setWorld` involved) — the loop's own pacing state, safe to apply
        // directly regardless of whether a tick is in flight.
        const data = engine.setGameSpeed(parsed.data.speed);
        return { type: "commandResult", id, result: { ok: true, data } };
      }
      case "listSaves": {
        const data = await engine.listGameSaves();
        return { type: "commandResult", id, result: { ok: true, data } };
      }
      case "newGame": {
        const parsed = engine.schemas.newGameSchema.safeParse(envelope.payload);
        if (!parsed.success) {
          return { type: "commandResult", id, result: { ok: false, error: zodIssueMessage(parsed.error) } };
        }
        const { result } = await runWorldMutatingCommand(engine, () => engine.newGame(parsed.data));
        return { type: "commandResult", id, result: { ok: true, data: result } };
      }
      case "loadGame": {
        const parsed = engine.schemas.loadGameSchema.safeParse(envelope.payload);
        if (!parsed.success) {
          return { type: "commandResult", id, result: { ok: false, error: zodIssueMessage(parsed.error) } };
        }
        // Not routed through `runWorldMutatingCommand`: `loadGame` reads the save file (async)
        // before its synchronous store swap, and `TickLoop.enqueueCommand`'s `run` must return
        // synchronously (`lib/world/tick-loop.ts:144-146`) — it cannot await mid-callback. This
        // leaves the same narrow race `saveGame` below accepts (a load landing while a tick is
        // mid-`await` could be overwritten by that tick's own post-await commit); it is not a
        // regression — today's `POST /api/game/load` route has the identical hazard, unmitigated,
        // calling this exact service the same way. Closing it needs either an async-`run` queue
        // variant (a `TickLoop` change, out of this task's scope) or splitting `loadGame` into a
        // pre-read async phase and a synchronous commit phase (a service-shape change, likewise
        // out of scope) — noted for the reviewer rather than silently narrowed.
        const result = await engine.loadGame(parsed.data.name);
        return { type: "commandResult", id, result };
      }
      case "saveGame": {
        const parsed = engine.schemas.saveGameSchema.safeParse(envelope.payload);
        if (!parsed.success) {
          return { type: "commandResult", id, result: { ok: false, error: zodIssueMessage(parsed.error) } };
        }
        const result = await engine.saveGame(parsed.data.name);
        return { type: "commandResult", id, result };
      }
      case "exportSave": {
        const parsed = engine.schemas.exportSaveSchema.safeParse(envelope.payload);
        if (!parsed.success) {
          return { type: "commandResult", id, result: { ok: false, error: zodIssueMessage(parsed.error) } };
        }
        const result = await engine.exportSave(parsed.data.name);
        return { type: "commandResult", id, result };
      }
      case "importSave": {
        const parsed = engine.schemas.importSaveSchema.safeParse(envelope.payload);
        if (!parsed.success) {
          return { type: "commandResult", id, result: { ok: false, error: zodIssueMessage(parsed.error) } };
        }
        const result = await engine.importSave(parsed.data.name, parsed.data.json);
        return { type: "commandResult", id, result };
      }
      case "advanceTicks": {
        const dev = engine.dev;
        if (!dev) return { type: "commandResult", id, result: { ok: false, error: DEV_COMMANDS_UNAVAILABLE } };
        const result = await dev.advanceTicks(envelope.payload);
        return { type: "commandResult", id, result };
      }
      case "resetEconomy": {
        const dev = engine.dev;
        if (!dev) return { type: "commandResult", id, result: { ok: false, error: DEV_COMMANDS_UNAVAILABLE } };
        const { result } = await runWorldMutatingCommand(engine, () => dev.resetEconomy());
        return { type: "commandResult", id, result };
      }
      case "economySnapshot": {
        const dev = engine.dev;
        if (!dev) return { type: "commandResult", id, result: { ok: false, error: DEV_COMMANDS_UNAVAILABLE } };
        // A pure read (no `setWorld`) — never queued, same as `listSaves` above.
        return { type: "commandResult", id, result: dev.economySnapshot() };
      }
      case "inspectWorld": {
        const dev = engine.dev;
        if (!dev) return { type: "commandResult", id, result: { ok: false, error: DEV_COMMANDS_UNAVAILABLE } };
        return { type: "commandResult", id, result: dev.inspectWorld() };
      }
      default: {
        // Exhaustiveness: every `GameCommandType` is a case above, so `envelope` (and therefore
        // this branch) is unreachable — TS narrows it to `never` here, which is also why nothing
        // above reads a `.type` off it. Kept as a defensive fallback (not relied on for the
        // exhaustiveness check itself, which TS already enforces via the switch's own coverage)
        // in case a future command type is added to the map without a case here.
        return { type: "commandResult", id, result: { ok: false, error: "Unknown command" } };
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { type: "commandResult", id, result: { ok: false, error: message } };
  }
}

// ── Worker orchestration ─────────────────────────────────────────────────────

/**
 * Wires a `RawWorkerScope` (a real worker's `self` via `host.ts`, or a fake host in tests) up to
 * the game worker's message protocol. `boot` resolves the boot config and dynamically imports the
 * engine graph (spec §6); `subscribe` replies immediately with the current pacing + state frame
 * (coarse slices complete, detail scoped to the held interest set), world-less included (spec §1,
 * §9); `interest` replaces the held interest set and answers a grow with an immediate state frame;
 * `command` runs the matching handler and pushes a fresh state frame once it commits (no
 * `TickLoop.emit` hook). A failing tick (`lib/world/tick-loop.ts`'s hard-pause path, which now
 * carries the error on the broadcast — see that file's `TickBroadcast.error` field) is surfaced as
 * a `tickFailed` message alongside the pause pacing frame, never a silent stop (spec §4).
 *
 * Does NOT wire itself to a real `self` — that binding (constructing the actual dedicated worker
 * and calling this with it) is the Vite worker entry's job, not this module's; this file is kept
 * import-only/test-driven, matching "static imports limited to types + boot.ts".
 */
export function createGameWorker(scope: RawWorkerScope<InboundMessage, OutboundMessage>): void {
  const host: WorkerHost<InboundMessage, OutboundMessage> = createWorkerHost(scope);
  let engine: Engine | null = null;
  /**
   * Set the instant a `boot` message is processed (synchronously, before `loadEngine`'s dynamic
   * `import()`s have a chance to settle) — `null` means no `boot` message has EVER arrived, the
   * only case `handleCommand` rejects with "Worker not booted." A non-null value means boot is
   * either still in flight or already settled; either way a command awaits this promise rather
   * than rejecting. This is the fix for a real vite-dev bug (Gate B smoke, 2026-08-19): under
   * webpack/vitest the dynamic-import chain settles fast enough that a command issued right after
   * `subscribe` never raced it, but under vite dev it's slow enough that `main.tsx`'s boot →
   * subscribe → (on the world-less frame) newGame sequence posted `newGame` while `handleBoot`'s
   * `await loadEngine(config)` was still pending — and the worker rejected it outright, because
   * "booted" was tracked only by `engine`'s nullness, which flips only once loading finishes.
   * Message order already guarantees `boot` was received before any command that depends on it
   * (the UI never commands before it has seen a subscribe reply, and it never subscribes before
   * posting boot); what was missing was honouring that order on the worker side too.
   */
  let bootPromise: Promise<void> | null = null;

  /** The pacing frame for a world-less worker — `TickLoop.getSnapshot()`'s own no-world shape
   *  (`currentTick: 0, speed: "paused", achievedTps: 0, events: {}`, `lib/world/tick-loop.ts:88-95`)
   *  before an engine has even been loaded. */
  const NO_ENGINE_PACING_FRAME: PacingFrame = { currentTick: 0, speed: "paused", achievedTps: 0, events: {} };

  /** The worker's send counter (frame-architecture spec, "Interest protocol") — starts at 0 here so
   *  the first `pushStateFrame()` call stamps 1; bumped on EVERY state post, regardless of trigger
   *  (subscribe reply, tick broadcast, command follow-up, interest reply), since frame freshness is
   *  judged on this counter rather than `worldVersion` once interest can vary a frame's content
   *  independently of the world (`lib/runtime/snapshot.ts`'s `StateFrame` docstring). */
  let frameSeq = 0;

  /** The panels currently declared open (frame-architecture spec, "Interest protocol") —
   *  replace-whole-set, no ref-counting at this layer. Starts empty (coarse-only frames) and is
   *  reset to `EMPTY_INTEREST` when a `newGame`/`loadGame` command commits (the set is
   *  world-scoped; a live worker outlives exit-to-menu → new game, so a stale held id must not
   *  survive the world it named). */
  let currentInterest: InterestSet = EMPTY_INTEREST;

  /**
   * The world-less state frame: `worldVersion: 0` (the store's own pre-any-commit value,
   * `lib/world/store.ts`'s `version` starts at 0 and every `setWorld`/`clearWorld` bumps it to at
   * least 1) paired with empty slices. This is the "defined no-world frame" the subscribe handshake
   * proves is never silence, and the resolution to this task's world-less-shape decision: a later
   * consumer (the UI store) reads `worldVersion === 0` as `liveness: "no-world"`.
   */
  function noWorldStateFrame(seq: number): StateFrame {
    return { worldVersion: 0, slices: {}, frameSeq: seq };
  }

  function currentStateFrame(seq: number): StateFrame {
    if (!engine || !engine.hasWorld()) return noWorldStateFrame(seq);
    // Per `lib/runtime/snapshot.ts`'s contract: pass the exact reference `getWorld()` returns,
    // never a separately-held one — see this module's header docstring.
    return { ...engine.buildStateFrame(engine.getWorld(), currentInterest), frameSeq: seq };
  }

  function pushStateFrame(): void {
    frameSeq += 1;
    host.post({ type: "state", frame: currentStateFrame(frameSeq) });
  }

  /** True when `next` names a system or good id `previous` did not — the grow/shrink distinction
   *  an interest reply's immediate-push decision is made on (spec: "an interest message that grows
   *  the set… triggers one immediate state push; shrink-only does not"). `factions` is excluded
   *  deliberately: it is accepted on the type for forward-compatibility and unused by
   *  `buildStateFrame` (every faction slice is pushed-coarse), so a faction-only change can never
   *  affect a frame's content and must not trigger a push. */
  function interestGrew(previous: InterestSet, next: InterestSet): boolean {
    return (
      next.systems.some((id) => !previous.systems.includes(id)) ||
      next.goods.some((id) => !previous.goods.includes(id))
    );
  }

  /** Replaces the held interest set wholesale and, only on growth, pushes one immediate state frame
   *  — same "answer at once, no throttle wait" pattern `subscribe` already gets (spec: "opening a
   *  panel costs one postMessage round trip, not a wait for the next throttle window"). Works
   *  world-less too: `pushStateFrame`/`currentStateFrame` already handle no engine/no world. */
  function handleInterest(interest: InterestSet): void {
    const grew = interestGrew(currentInterest, interest);
    currentInterest = interest;
    if (grew) pushStateFrame();
  }

  function pushPacingFrame(frame: PacingFrame): void {
    host.post({ type: "pacing", frame });
    if (frame.error) {
      host.post({ type: "tickFailed", msg: { error: frame.error } });
    }
  }

  /**
   * A `boot` message never blocks the message loop: `bootPromise` is assigned SYNCHRONOUSLY here
   * (calling `loadEngine` returns its promise immediately; only its own body awaits the dynamic
   * imports), so any message processed after this one — even in the same synchronous batch, before
   * any microtask runs — already sees `bootPromise` as non-null. `subscribe` deliberately does not
   * await it (see `handleSubscribe`'s docstring); `command` does (see `handleCommand`'s).
   */
  function handleBoot(config: BootConfig): void {
    bootPromise = loadEngine(config).then((loaded) => {
      engine = loaded;
      engine.tickLoop.subscribe((broadcast) => {
        pushPacingFrame(broadcast);
        pushStateFrame();
      });
      engine.tickLoop.subscribeAutosave((error) => {
        host.post({ type: "autosaveResult", error });
      });
    });
  }

  /**
   * Replies immediately in every state, boot-in-flight included — this is the one handler that
   * must NEVER await `bootPromise`, so a subscriber attaching mid-boot still gets a defined frame
   * on the frame it asked (spec: "subscribing to a world-less worker returns a defined no-world
   * frame, not silence").
   *
   * A subscribe that lands WHILE boot is still pending gets nothing further pushed when boot then
   * completes (no re-push here, no subscriber-list to replay to) — this is safe only because the
   * pre-boot and post-boot-but-still-world-less frames are byte-identical: `TickLoop`'s own
   * defaults (`speed: "paused"` at construction, `hasWorld()` false pre-`newGame`/`loadGame`) are
   * exactly `NO_ENGINE_PACING_FRAME`/`noWorldStateFrame()`'s values, so nothing observable changes
   * at the moment boot finishes. The instant something WOULD differ — a world lands — is exactly
   * `newGame`/`loadGame` committing, and THAT already pushes its own full frame (`handleCommand`
   * below). If a future change makes the pre/post-boot world-less frame diverge (e.g. pacing
   * gaining a boot-progress field), this invariant breaks silently — push a frame from inside
   * `handleBoot`'s `.then` at that point rather than re-deriving this reasoning.
   */
  function handleSubscribe(): void {
    host.post({ type: "pacing", frame: engine ? engine.tickLoop.getSnapshot() : NO_ENGINE_PACING_FRAME });
    pushStateFrame();
  }

  async function handleCommand(envelope: GameCommandEnvelope | DevCommandEnvelope): Promise<void> {
    if (!bootPromise) {
      host.post({ type: "commandResult", id: envelope.id, result: { ok: false, error: "Worker not booted." } });
      return;
    }
    // Boot received but maybe still in flight: wait for it rather than rejecting. Awaiting the
    // SAME promise from every concurrently-queued command preserves arrival order — each `await`
    // attaches a microtask in the order `handleCommand` was called (message order), and a promise
    // runs its attached continuations in attachment order whether it was already settled or not —
    // so this needs no explicit queue on top.
    try {
      await bootPromise;
    } catch {
      host.post({ type: "commandResult", id: envelope.id, result: { ok: false, error: "Worker failed to boot." } });
      return;
    }
    if (!engine) {
      // Defensive: `loadEngine` rejected, so `bootPromise` settled but `engine` was never assigned
      // (the `.then` that assigns it never ran). Caught above via the `catch`, but kept here too in
      // case a future change makes `bootPromise` resolve without `engine` being set.
      host.post({ type: "commandResult", id: envelope.id, result: { ok: false, error: "Worker not booted." } });
      return;
    }
    const message = await runCommand(engine, envelope);
    // A committed newGame/loadGame replaces the world out from under any held interest — reset
    // BEFORE the follow-up frame is built (spec: "the worker clears its held interest set when a
    // newGame/loadGame command commits"), so that frame's detail slices are empty for the fresh
    // world rather than keyed by ids from the world just replaced. A failed command (`ok: false`)
    // leaves the held set alone — nothing committed, so nothing to clear.
    if ((envelope.type === "newGame" || envelope.type === "loadGame") && message.result.ok) {
      currentInterest = EMPTY_INTEREST;
    }
    // No await between these two posts: lib/store/command-overlay.ts clears its in-flight
    // overlays on the store's next notification and relies on a command's own state frame
    // being the very next message after its result — an interleaved pacing/tick frame here
    // would reopen the snap-back flicker the overlay exists to prevent.
    host.post(message);
    pushStateFrame();
  }

  host.onMessage((message) => {
    switch (message.type) {
      case "boot":
        handleBoot(message.config);
        return;
      case "subscribe":
        handleSubscribe();
        return;
      case "interest":
        handleInterest(message.interest);
        return;
      case "command":
        void handleCommand(message.envelope);
        return;
    }
  });
}
