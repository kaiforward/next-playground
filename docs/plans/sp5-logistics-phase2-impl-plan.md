# SP5 Directed Logistics — Phase 2 Implementation Plan (Contract layer)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Expose a tunable top-K slice of each faction's matched surplus→deficit transfers as player
**Contracts** (instead of moving them silently), have the faction **haul any unfilled Contract itself**
when it times out, and **retire the old price-ratio trade-mission generator** so that demand-driven
logistics hauls (plus orthogonal event missions) are the *only* trade missions — all driven by real
substrate-v2 demand figures.

**Architecture:** The pure directed-logistics body (`lib/tick/processors/directed-logistics.ts`) already
matches surplus→deficit and moves volume silently. Phase 2 adds, inside that same pure body: (1) a
**timeout-resolve** pass that hauls this faction-shard's expired unclaimed Contracts, (2) a **top-K split**
(`splitContractTransfers`, pure engine helper) that diverts the most valuable transfers into Contract
creation instead of silent moves. Contract creation/resolution is new `DirectedLogisticsWorld` I/O
(Prisma + in-memory adapters). A Contract is a `TradeMission` row tagged `origin = "logistics"`; the
existing player accept/deliver lifecycle (which already adds delivered goods to destination stock) is
reused unchanged. The `trade-missions` processor's price-ratio generator (`selectEconomyCandidates`) is
**deleted**; its generic player lifecycle + event generation stay.

**Tech Stack:** TypeScript 5 (strict), Prisma 7 + `@prisma/adapter-pg` (PostgreSQL), Vitest 4. Source of
truth design: `docs/plans/sp5-autonomic-logistics.md` (§"The two-layer split", §"Processor architecture").

## Global Constraints

- **No `as` casts** except `as const` and inside `lib/types/guards.ts`. Fix types at the source.
- **No `unknown` / `Record<string, unknown>`** anywhere. Use typed maps/unions.
- **No postfix `!`** (except `find(...)!` in tests, the project idiom). Strip null with a real check.
- **Discriminated unions** for result types: `{ ok: true; … } | { ok: false; … }`.
- **Engine is pure** — `lib/engine/**` has zero DB imports; never statically import `@/lib/prisma`
  (directly or transitively) into a unit-tested module graph (the `unit` Vitest project sets no
  `DATABASE_URL` and `lib/prisma.ts` throws at load). Prisma-tainted deps go in adapters / function
  bodies only. Verify with `unset DATABASE_URL; npx vitest run --project unit <path>`.
- **Prisma 7:** `$transaction` already wraps the tick; batch writes (`createMany` / `unnest` UPDATE),
  never per-iteration writes. Guard `NaN`/`Infinity` before any raw SQL.
- **Cadence (unchanged from Phase 1):** `DIRECTED_LOGISTICS.INTERVAL = 2 × ECONOMY_UPDATE_INTERVAL = 48`.
  `catchUpFactor(48) = 2`. The directed-logistics shard is **per-faction**, deterministic, so a faction is
  due exactly once per `INTERVAL` ticks.
- **`origin` is internal only.** It is NOT surfaced in `TradeMissionInfo` or any UI. To the player every
  contract is one undifferentiated transport contract. The only functional consumer is the tick layer
  (timeout-resolve checks `origin === "logistics"`).

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `prisma/schema.prisma` | Modify | Add `TradeMission.origin String @default("economy")`. |
| `lib/constants/directed-logistics.ts` | Modify | Add `CONTRACTS_PER_CYCLE`, `CONTRACT_DEADLINE_TICKS`. |
| `lib/engine/directed-logistics.ts` | Modify | Add pure `splitContractTransfers`. |
| `lib/engine/__tests__/directed-logistics.test.ts` | Modify | Tests for `splitContractTransfers`. |
| `lib/tick/world/directed-logistics-world.ts` | Modify | `LogisticsContractCreate`, `ExpiredLogisticsContract` types + 3 world methods. |
| `lib/tick/adapters/memory/directed-logistics.ts` | Modify | Implement the 3 methods (capture creates/closes; return seeded expired). |
| `lib/tick/adapters/prisma/directed-logistics.ts` | Modify | Implement the 3 methods (insert `origin="logistics"`, read expired, delete). |
| `lib/tick/processors/directed-logistics.ts` | Modify | Body: timeout-resolve + top-K split + Contract create; params; live wiring. |
| `lib/tick/processors/__tests__/directed-logistics.test.ts` | Modify | Update existing body-call sites; add Contract/resolve tests. |
| `lib/engine/simulator/economy.ts` | Modify | Sim passes `contractCount: 0` + null `contractTerms`. |
| `lib/engine/missions.ts` | Modify | Delete `selectEconomyCandidates` + `MarketSnapshot`. |
| `lib/engine/__tests__/missions.test.ts` | Modify | Delete the `selectEconomyCandidates` describe block. |
| `lib/tick/processors/trade-missions.ts` | Modify | Drop economy generation; event + lifecycle only. |
| `lib/tick/world/trade-missions-world.ts` | Modify | Remove dead `getSystemIds` / `getMarketPricesForSystems` / `MarketPriceView`. |
| `lib/tick/adapters/prisma/trade-missions.ts` | Modify | Remove dead methods; `createMissions` sets `origin="event"`; expiry excludes logistics. |
| `lib/tick/processors/__tests__/trade-missions.test.ts` | Modify | Drop economy-shard tests; keep event + expiry. |
| `lib/tick/processors/__tests__/integration/directed-logistics.integration.test.ts` | Create | Adapter round-trip: create → expire → resolve. |

**Scope: one PR** ("the Contract layer"). Map overlay (Phase 3) + Logistics tab (Phase 4) are separate.

---

## Task 1: Schema — `TradeMission.origin` discriminator

**Files:**
- Modify: `prisma/schema.prisma` (the `TradeMission` model, ~line 469)

**Interfaces:**
- Produces: `TradeMission.origin` column (`"economy"` legacy default · `"event"` · `"logistics"`).

- [ ] **Step 1: Add the field**

In `model TradeMission`, add after `eventId String?` (line ~477):

```prisma
  origin         String  @default("economy") // internal: "economy" (legacy) | "event" | "logistics"; drives timeout-resolve, NOT shown to players
```

- [ ] **Step 2: Push the schema + regenerate client**

Run: `npx prisma db push`
Expected: "Your database is now in sync with your Prisma schema." and the client regenerates.

- [ ] **Step 3: Verify the client typed the field**

Run: `npx tsc --noEmit`
Expected: no errors (existing `TradeMission` inserts still compile — the field has a default).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma app/generated/prisma
git commit -m "feat(logistics): add TradeMission.origin discriminator (internal)"
```

---

## Task 2: Constants — Contract skim + deadline

**Files:**
- Modify: `lib/constants/directed-logistics.ts`

**Interfaces:**
- Produces: `DIRECTED_LOGISTICS.CONTRACTS_PER_CYCLE`, `DIRECTED_LOGISTICS.CONTRACT_DEADLINE_TICKS`.

- [ ] **Step 1: Add the two constants**

In the `DIRECTED_LOGISTICS` object (after `FUEL_WEIGHT: 0.1,`), add:

```ts
  /**
   * Top-K most-valuable matched transfers per faction per cycle exposed as player
   * Contracts (the rest move silently). The agency dial: constant in v1; scaling by
   * player count/activity is an SP5+ hook. First-draft — calibrate against the simulator.
   */
  CONTRACTS_PER_CYCLE: 5,
  /**
   * Ticks a logistics Contract stays open before the faction hauls it itself. One
   * INTERVAL, so a Contract created on a faction's shard run is due for timeout-resolve
   * on that same faction's NEXT shard run (sharding is per-faction + deterministic).
   */
  CONTRACT_DEADLINE_TICKS: 2 * ECONOMY_UPDATE_INTERVAL,
```

(`ECONOMY_UPDATE_INTERVAL` is already imported at the top of the file.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/constants/directed-logistics.ts
git commit -m "feat(logistics): Contract skim count + deadline constants"
```

---

## Task 3: Engine — pure `splitContractTransfers`

**Files:**
- Modify: `lib/engine/directed-logistics.ts`
- Test: `lib/engine/__tests__/directed-logistics.test.ts`

**Interfaces:**
- Consumes: `PlannedTransfer` (already defined in this file — `{ goodId, fromSystemId, toSystemId, quantity, cost }`).
- Produces: `splitContractTransfers(transfers: PlannedTransfer[], count: number): { contracts: PlannedTransfer[]; silent: PlannedTransfer[] }`.

- [ ] **Step 1: Write the failing tests**

Append to `lib/engine/__tests__/directed-logistics.test.ts`. First add `splitContractTransfers` to the
existing import from `@/lib/engine/directed-logistics` at the top of the file (it already imports
`matchFactionTransfers`, types, etc. — add the name to that import list). Then append:

```ts
describe("splitContractTransfers", () => {
  const t = (id: string, cost: number): PlannedTransfer => ({
    goodId: "food", fromSystemId: "A", toSystemId: id, quantity: 10, cost,
  });

  it("takes the top-`count` by descending cost as contracts, rest silent", () => {
    const transfers = [t("B", 5), t("C", 20), t("D", 12)];
    const { contracts, silent } = splitContractTransfers(transfers, 2);
    expect(contracts.map((x) => x.toSystemId)).toEqual(["C", "D"]); // 20, 12
    expect(silent.map((x) => x.toSystemId)).toEqual(["B"]);         // 5
  });

  it("count >= length → everything is a contract", () => {
    const transfers = [t("B", 5), t("C", 20)];
    const { contracts, silent } = splitContractTransfers(transfers, 9);
    expect(contracts).toHaveLength(2);
    expect(silent).toHaveLength(0);
  });

  it("count <= 0 → everything is silent (the simulator path)", () => {
    const transfers = [t("B", 5), t("C", 20)];
    const { contracts, silent } = splitContractTransfers(transfers, 0);
    expect(contracts).toHaveLength(0);
    expect(silent).toEqual(transfers);
  });

  it("breaks cost ties by original order (deterministic)", () => {
    const transfers = [t("B", 7), t("C", 7), t("D", 7)];
    const { contracts } = splitContractTransfers(transfers, 2);
    expect(contracts.map((x) => x.toSystemId)).toEqual(["B", "C"]);
  });
});
```

`PlannedTransfer` must also be in that top import — add it if absent.

- [ ] **Step 2: Run, verify fail**

Run: `unset DATABASE_URL; npx vitest run --project unit lib/engine/__tests__/directed-logistics.test.ts`
Expected: FAIL — `splitContractTransfers` not exported.

- [ ] **Step 3: Implement the helper**

Append to `lib/engine/directed-logistics.ts`:

```ts
/**
 * Split matched transfers into the top-`count` most valuable — `cost` ≈ quantity ×
 * route distance ≈ player payout — exposed as player Contracts, and the cheaper
 * remainder, which move silently. Tie-broken by original order so the split is
 * deterministic. `count <= 0` (the simulator) → everything silent.
 */
export function splitContractTransfers(
  transfers: PlannedTransfer[],
  count: number,
): { contracts: PlannedTransfer[]; silent: PlannedTransfer[] } {
  if (count <= 0 || transfers.length === 0) {
    return { contracts: [], silent: [...transfers] };
  }
  const ranked = transfers
    .map((t, i) => ({ t, i }))
    .sort((a, b) => b.t.cost - a.t.cost || a.i - b.i);
  const contractIdx = new Set(ranked.slice(0, count).map((r) => r.i));
  const contracts: PlannedTransfer[] = [];
  const silent: PlannedTransfer[] = [];
  transfers.forEach((t, i) => {
    if (contractIdx.has(i)) contracts.push(t);
    else silent.push(t);
  });
  return { contracts, silent };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `unset DATABASE_URL; npx vitest run --project unit lib/engine/__tests__/directed-logistics.test.ts`
Expected: PASS (all cases, including pre-existing).

- [ ] **Step 5: Commit**

```bash
git add lib/engine/directed-logistics.ts lib/engine/__tests__/directed-logistics.test.ts
git commit -m "feat(logistics): top-K-by-value Contract split helper"
```

---

## Task 4: Contract I/O — world interface + both adapters

> Interface and BOTH implementors change together so the repo stays type-clean at the task boundary
> (only `MemoryDirectedLogisticsWorld` and `PrismaDirectedLogisticsWorld` implement
> `DirectedLogisticsWorld`).

**Files:**
- Modify: `lib/tick/world/directed-logistics-world.ts`
- Modify: `lib/tick/adapters/memory/directed-logistics.ts`
- Modify: `lib/tick/adapters/prisma/directed-logistics.ts`
- Test: `lib/tick/processors/__tests__/directed-logistics.test.ts`

**Interfaces:**
- Produces:
  - `LogisticsContractCreate = { fromSystemId: string; toSystemId: string; goodId: string; quantity: number; reward: number; deadlineTick: number; factionId: string | null; createdAtTick: number }` (`goodId` = canonical good KEY)
  - `ExpiredLogisticsContract = { id: string; fromSystemId: string; toSystemId: string; goodId: string; quantity: number }` (`goodId` = canonical good KEY)
  - `DirectedLogisticsWorld.createLogisticsContracts(rows): Promise<void>`
  - `DirectedLogisticsWorld.takeExpiredLogisticsContracts(tick, factionKeys): Promise<ExpiredLogisticsContract[]>`
  - `DirectedLogisticsWorld.closeLogisticsContracts(ids): Promise<void>`
  - `MemoryDirectedLogisticsWorld` second constructor arg `expiredContracts` + captured `createdContracts` / `closedContractIds`.

- [ ] **Step 1: Add types + methods to the world interface**

In `lib/tick/world/directed-logistics-world.ts`, after the `LogisticsFlowInsert` interface add:

```ts
/**
 * A logistics Contract to create — a TradeMission with origin = "logistics". Board station =
 * surplus system (player picks up); destination = deficit system. Quantities are catch-up-scaled;
 * `goodId` is the canonical good KEY (the adapter resolves it to the DB Good.id FK).
 */
export interface LogisticsContractCreate {
  fromSystemId: string;
  toSystemId: string;
  goodId: string;
  quantity: number;
  reward: number;
  deadlineTick: number;
  factionId: string | null;
  createdAtTick: number;
}

/** An expired, unclaimed logistics Contract the faction will now haul itself. `goodId` = good KEY. */
export interface ExpiredLogisticsContract {
  id: string;
  fromSystemId: string;
  toSystemId: string;
  goodId: string;
  quantity: number;
}
```

Then add three methods to the `DirectedLogisticsWorld` interface (after `appendLogisticsFlows`):

```ts
  /** Insert logistics Contracts (TradeMission rows, origin = "logistics"). No stock moves here. */
  createLogisticsContracts(rows: LogisticsContractCreate[]): Promise<void>;
  /**
   * Expired (deadlineTick ≤ tick) UNCLAIMED logistics Contracts owned by the given faction keys,
   * for the faction to self-haul. Faction-scoped so their endpoints are in the current shard's rows.
   */
  takeExpiredLogisticsContracts(
    tick: number,
    factionKeys: Array<string | null>,
  ): Promise<ExpiredLogisticsContract[]>;
  /** Delete resolved logistics Contracts by id. */
  closeLogisticsContracts(ids: string[]): Promise<void>;
```

- [ ] **Step 2: Write the failing memory-adapter test**

Append to `lib/tick/processors/__tests__/directed-logistics.test.ts` (inside the existing
`describe("MemoryDirectedLogisticsWorld", …)` block, or a new one):

```ts
describe("MemoryDirectedLogisticsWorld — Contract I/O", () => {
  it("captures created + closed Contracts and returns seeded expired ones", async () => {
    const expired = [
      { id: "c1", fromSystemId: "A", toSystemId: "B", goodId: "food", quantity: 12 },
    ];
    const world = new MemoryDirectedLogisticsWorld([], expired);

    expect(await world.takeExpiredLogisticsContracts(99, ["f1"])).toEqual(expired);

    await world.createLogisticsContracts([
      { fromSystemId: "A", toSystemId: "B", goodId: "food", quantity: 8,
        reward: 50, deadlineTick: 100, factionId: "f1", createdAtTick: 52 },
    ]);
    await world.closeLogisticsContracts(["c1"]);

    expect(world.createdContracts).toHaveLength(1);
    expect(world.createdContracts[0]).toMatchObject({ fromSystemId: "A", toSystemId: "B" });
    expect(world.closedContractIds).toEqual(["c1"]);
  });
});
```

- [ ] **Step 3: Run, verify fail**

Run: `unset DATABASE_URL; npx vitest run --project unit lib/tick/processors/__tests__/directed-logistics.test.ts`
Expected: FAIL — `createLogisticsContracts` / second constructor arg not present.

- [ ] **Step 4: Implement the memory adapter methods**

In `lib/tick/adapters/memory/directed-logistics.ts`, update the imports to include the new types and
extend the class:

```ts
import type {
  DirectedLogisticsWorld,
  SystemLogisticsRow,
  LogisticsMarketUpdate,
  LogisticsFlowInsert,
  LogisticsContractCreate,
  ExpiredLogisticsContract,
} from "@/lib/tick/world/directed-logistics-world";

/** In-memory DirectedLogisticsWorld for unit tests + the simulator. Captures writes for assertions. */
export class MemoryDirectedLogisticsWorld implements DirectedLogisticsWorld {
  readonly stockUpdates = new Map<string, number>();
  readonly flows: LogisticsFlowInsert[] = [];
  readonly createdContracts: LogisticsContractCreate[] = [];
  readonly closedContractIds: string[] = [];

  constructor(
    private readonly systems: SystemLogisticsRow[],
    private readonly expiredContracts: ExpiredLogisticsContract[] = [],
  ) {}

  // … keep existing getFactionShardKeys / getSystemsForFactions / applyMarketUpdates /
  //    appendLogisticsFlows unchanged …

  async createLogisticsContracts(rows: LogisticsContractCreate[]): Promise<void> {
    this.createdContracts.push(...rows);
  }

  // The faction/tick filter is the Prisma adapter's job (integration-tested); the memory
  // adapter just returns its seeded list so the body's haul logic can be unit-tested.
  async takeExpiredLogisticsContracts(
    _tick: number,
    _factionKeys: Array<string | null>,
  ): Promise<ExpiredLogisticsContract[]> {
    return this.expiredContracts;
  }

  async closeLogisticsContracts(ids: string[]): Promise<void> {
    this.closedContractIds.push(...ids);
  }
}
```

- [ ] **Step 5: Implement the Prisma adapter methods**

In `lib/tick/adapters/prisma/directed-logistics.ts`, add the new types to the world-types import and add
three methods to `PrismaDirectedLogisticsWorld`:

```ts
import type {
  DirectedLogisticsWorld,
  LogisticsFlowInsert,
  LogisticsMarketUpdate,
  SystemLogisticsRow,
  LogisticsContractCreate,
  ExpiredLogisticsContract,
} from "@/lib/tick/world/directed-logistics-world";
```

```ts
  /** key → DB Good.id (TradeMission.goodId is an FK, unlike TradeFlow.goodId which stores the key). */
  private async goodIdByKey(): Promise<Map<string, string>> {
    const goods = await this.tx.good.findMany({ select: { id: true, name: true } });
    const map = new Map<string, string>();
    for (const g of goods) {
      const key = GOOD_NAME_TO_KEY.get(g.name);
      if (key) map.set(key, g.id);
    }
    return map;
  }

  async createLogisticsContracts(rows: LogisticsContractCreate[]): Promise<void> {
    if (rows.length === 0) return;
    const goodIdByKey = await this.goodIdByKey();
    const data = [];
    for (const r of rows) {
      const dbGoodId = goodIdByKey.get(r.goodId);
      if (!dbGoodId) continue; // unknown good — skip rather than insert a dangling FK
      data.push({
        systemId: r.fromSystemId,      // board = surplus system
        destinationId: r.toSystemId,   // delivery = deficit system
        goodId: dbGoodId,
        quantity: r.quantity,
        reward: r.reward,
        deadlineTick: r.deadlineTick,
        factionId: r.factionId,
        origin: "logistics" as const,
        createdAtTick: r.createdAtTick,
      });
    }
    if (data.length === 0) return;
    await this.tx.tradeMission.createMany({ data });
  }

  async takeExpiredLogisticsContracts(
    tick: number,
    factionKeys: Array<string | null>,
  ): Promise<ExpiredLogisticsContract[]> {
    if (factionKeys.length === 0) return [];
    const ids = factionKeys.filter((k): k is string => k !== null);
    const includeNull = factionKeys.some((k) => k === null);
    const factionWhere: Prisma.TradeMissionWhereInput =
      includeNull && ids.length > 0
        ? { OR: [{ factionId: { in: ids } }, { factionId: null }] }
        : includeNull
          ? { factionId: null }
          : { factionId: { in: ids } };

    const rows = await this.tx.tradeMission.findMany({
      where: {
        origin: "logistics",
        playerId: null,
        deadlineTick: { lte: tick },
        ...factionWhere,
      },
      select: {
        id: true,
        systemId: true,
        destinationId: true,
        quantity: true,
        good: { select: { name: true } },
      },
    });
    return rows.map((m) => ({
      id: m.id,
      fromSystemId: m.systemId,
      toSystemId: m.destinationId,
      goodId: GOOD_NAME_TO_KEY.get(m.good.name) ?? m.good.name,
      quantity: m.quantity,
    }));
  }

  async closeLogisticsContracts(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.tx.tradeMission.deleteMany({ where: { id: { in: ids } } });
  }
```

(`Prisma` is already imported as a type at the top of this file; `GOOD_NAME_TO_KEY` too.)

- [ ] **Step 6: Run unit + typecheck, verify pass**

Run: `unset DATABASE_URL; npx vitest run --project unit lib/tick/processors/__tests__/directed-logistics.test.ts && npx tsc --noEmit`
Expected: PASS (memory tests) + no type errors (both adapters satisfy the extended interface).

- [ ] **Step 7: Commit**

```bash
git add lib/tick/world/directed-logistics-world.ts lib/tick/adapters/memory/directed-logistics.ts lib/tick/adapters/prisma/directed-logistics.ts lib/tick/processors/__tests__/directed-logistics.test.ts
git commit -m "feat(logistics): Contract create/expire/close world I/O"
```

---

## Task 5: Processor body — timeout-resolve + Contract split + wiring

> The body, its live `process()` wiring (same file), and the simulator call-site all change together
> because `contractCount` / `contractTerms` become **required** params (deliberate: a caller can't
> silently ship the feature "off"). The sim and the 3 existing body tests pass `contractCount: 0`.

**Files:**
- Modify: `lib/tick/processors/directed-logistics.ts`
- Modify: `lib/engine/simulator/economy.ts`
- Test: `lib/tick/processors/__tests__/directed-logistics.test.ts`

**Interfaces:**
- Consumes: `splitContractTransfers` (Task 3); `createLogisticsContracts` / `takeExpiredLogisticsContracts`
  / `closeLogisticsContracts` (Task 4); `DIRECTED_LOGISTICS.CONTRACTS_PER_CYCLE` /
  `.CONTRACT_DEADLINE_TICKS` (Task 2); `calculateReward` (`@/lib/engine/missions`, pure);
  `GOOD_TIER_BY_KEY` (`@/lib/constants/goods`).
- Produces: `LogisticsContractTerms` type; extended `DirectedLogisticsProcessorParams`
  (`contractCount: number`, `contractTerms: LogisticsContractTerms`).

- [ ] **Step 1: Write the failing body tests**

Append to `lib/tick/processors/__tests__/directed-logistics.test.ts`. Reuse the existing `market()`
helper and `DUE_TICK` constant already defined in that file. Add:

```ts
describe("runDirectedLogisticsProcessor — Contracts", () => {
  const noTerms = () => null;

  it("diverts the matched transfer into a Contract instead of a silent move", async () => {
    const systems = [
      { systemId: "A", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mA", "food", 95, 20)] },
      { systemId: "B", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mB", "food", 10, 20)] },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, {
      interval: DIRECTED_LOGISTICS.INTERVAL,
      routeCost: () => 1,
      contractCount: 1,
      contractTerms: ({ quantity }) => ({ reward: quantity * 2, deadlineTick: DUE_TICK + 48 }),
    });
    // The one transfer became a Contract: no silent flow, no stock move at creation.
    expect(world.createdContracts).toHaveLength(1);
    expect(world.createdContracts[0]).toMatchObject({ fromSystemId: "A", toSystemId: "B", goodId: "food" });
    expect(world.flows).toHaveLength(0);
    expect(world.stockUpdates.size).toBe(0);
  });

  it("hauls an expired unclaimed Contract itself (timeout-resolve), then closes it", async () => {
    const systems = [
      { systemId: "A", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mA", "food", 95, 20)] },
      { systemId: "B", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mB", "food", 10, 20)] },
    ];
    const expired = [{ id: "c1", fromSystemId: "A", toSystemId: "B", goodId: "food", quantity: 6 }];
    const world = new MemoryDirectedLogisticsWorld(systems, expired);
    await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, {
      interval: DIRECTED_LOGISTICS.INTERVAL,
      routeCost: () => 1,
      contractCount: 0,        // no new Contracts; isolate the resolve path
      contractTerms: noTerms,
    });
    expect(world.closedContractIds).toEqual(["c1"]);
    // The haul produced a logistics flow A→B and moved stock.
    const haul = world.flows.find((f) => f.fromSystemId === "A" && f.toSystemId === "B");
    expect(haul?.quantity).toBe(6);
    expect(world.stockUpdates.has("mA")).toBe(true);
    expect(world.stockUpdates.has("mB")).toBe(true);
  });

  it("contractCount 0 → no Contracts created (pure silent, the sim path)", async () => {
    const systems = [
      { systemId: "A", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mA", "food", 95, 20)] },
      { systemId: "B", factionId: "f1", population: 200, buildings: {},
        yields: emptyResourceVector(), markets: [market("mB", "food", 10, 20)] },
    ];
    const world = new MemoryDirectedLogisticsWorld(systems);
    await runDirectedLogisticsProcessor(world, { tick: DUE_TICK }, {
      interval: DIRECTED_LOGISTICS.INTERVAL,
      routeCost: () => 1,
      contractCount: 0,
      contractTerms: noTerms,
    });
    expect(world.createdContracts).toHaveLength(0);
    expect(world.flows).toHaveLength(1); // still moved silently
  });
});
```

Also update the THREE existing `runDirectedLogisticsProcessor` calls already in this file (in the
`describe("runDirectedLogisticsProcessor (body)", …)` block) to add the two new params, e.g.:

```ts
    { interval: DIRECTED_LOGISTICS.INTERVAL, routeCost: () => 1, contractCount: 0, contractTerms: () => null },
```

- [ ] **Step 2: Run, verify fail**

Run: `unset DATABASE_URL; npx vitest run --project unit lib/tick/processors/__tests__/directed-logistics.test.ts`
Expected: FAIL — params type doesn't accept `contractCount` / the new behaviour isn't implemented.

- [ ] **Step 3: Rewrite the body + params + add the type, then update the live wiring**

Replace the body section of `lib/tick/processors/directed-logistics.ts`. Add the new imports near the
top (alongside the existing ones):

```ts
import { splitContractTransfers } from "@/lib/engine/directed-logistics";
import { calculateReward } from "@/lib/engine/missions";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import type {
  DirectedLogisticsWorld,
  SystemLogisticsRow,
  MarketRowForLogistics,
  LogisticsMarketUpdate,
  LogisticsFlowInsert,
  LogisticsContractCreate,
} from "@/lib/tick/world/directed-logistics-world";
```

(Merge `splitContractTransfers` into the existing `@/lib/engine/directed-logistics` import; merge
`LogisticsContractCreate` into the existing world-types import — don't duplicate import lines.)

Replace `DirectedLogisticsProcessorParams` and add `LogisticsContractTerms`:

```ts
/**
 * Reward + deadline for a candidate Contract; null = skip (e.g. unroutable). Injected so the body
 * stays free of hop-distance / reward specifics — the live wiring builds it from the cached hop map +
 * the pure calculateReward; the simulator and unit tests pass a stub.
 */
export type LogisticsContractTerms = (input: {
  goodId: string;
  quantity: number;
  fromSystemId: string;
  toSystemId: string;
}) => { reward: number; deadlineTick: number } | null;

export interface DirectedLogisticsProcessorParams {
  interval: number;
  /** Per-unit route cost between two systems; null = unreachable / beyond hop budget. */
  routeCost: RouteCost;
  /** Top-K transfers per faction exposed as player Contracts; 0 = all silent (the simulator). */
  contractCount: number;
  /** Reward/deadline for a candidate Contract. */
  contractTerms: LogisticsContractTerms;
}
```

Replace the `runDirectedLogisticsProcessor` body with:

```ts
export async function runDirectedLogisticsProcessor(
  world: DirectedLogisticsWorld,
  ctx: Pick<TickContext, "tick">,
  params: DirectedLogisticsProcessorParams,
): Promise<TickProcessorResult> {
  const factionKeys = await world.getFactionShardKeys();
  if (factionKeys.length === 0) return {};

  const { start, end } = shardRange(factionKeys.length, ctx.tick, params.interval);
  const dueKeys = factionKeys.slice(start, end);
  if (dueKeys.length === 0) return {};

  const rows = await world.getSystemsForFactions(dueKeys);
  if (rows.length === 0) return {};

  const catchUp = catchUpFactor(params.interval);

  // Market lookup by (systemId|goodId): id + band floor/ceiling for clamping.
  type MarketEntry = MarketRowForLogistics & { systemId: string; min: number; max: number };
  const marketByKey = new Map<string, MarketEntry>();
  for (const r of rows) {
    for (const m of r.markets) {
      const band = marketBandForRow(m, m);
      marketByKey.set(`${r.systemId}|${m.goodId}`, {
        ...m, systemId: r.systemId, min: band.minStock, max: band.maxStock,
      });
    }
  }

  const updates = new Map<string, number>();
  const flows: LogisticsFlowInsert[] = [];

  // Move `qty` of `goodId` from→to, clamped against current (post-prior-write) stock and the
  // band floor/ceiling. Composes successive moves via `updates`. Returns the amount actually moved.
  const applyHaul = (
    goodId: string, fromSystemId: string, toSystemId: string, qty: number,
  ): number => {
    if (!Number.isFinite(qty) || qty <= 0) return 0;
    const from = marketByKey.get(`${fromSystemId}|${goodId}`);
    const to = marketByKey.get(`${toSystemId}|${goodId}`);
    if (!from || !to) return 0;
    const fromCur = updates.get(from.id) ?? from.stock;
    const toCur = updates.get(to.id) ?? to.stock;
    const moved = Math.min(qty, Math.max(0, fromCur - from.min), Math.max(0, to.max - toCur));
    if (moved <= 0) return 0;
    updates.set(from.id, fromCur - moved);
    updates.set(to.id, toCur + moved);
    flows.push({ tick: ctx.tick, fromSystemId, toSystemId, goodId, quantity: moved });
    return moved;
  };

  // 1. Resolve this shard's expired UNCLAIMED Contracts — the faction hauls them itself (an unfilled
  //    Contract still does real work). A severed route (routeCost null) drops the haul but still closes.
  const expired = await world.takeExpiredLogisticsContracts(ctx.tick, dueKeys);
  const closeIds: string[] = [];
  for (const ec of expired) {
    if (params.routeCost(ec.fromSystemId, ec.toSystemId) !== null) {
      applyHaul(ec.goodId, ec.fromSystemId, ec.toSystemId, ec.quantity);
    }
    closeIds.push(ec.id);
  }

  // 2. Match per faction on POST-resolve stock (a just-filled deficit is no longer a sink), then split.
  const byFaction = new Map<string | null, SystemLogisticsRow[]>();
  for (const r of rows) {
    const list = byFaction.get(r.factionId) ?? [];
    list.push(r);
    byFaction.set(r.factionId, list);
  }

  const contractCreates: LogisticsContractCreate[] = [];
  for (const [factionKey, group] of byFaction) {
    const adjusted = group.map((r) => ({
      ...r,
      markets: r.markets.map((m) => ({ ...m, stock: updates.get(m.id) ?? m.stock })),
    }));
    const transfers = matchFactionTransfers(adjusted.map(toLogisticsState), params.routeCost);
    const { contracts, silent } = splitContractTransfers(transfers, params.contractCount);

    for (const t of silent) {
      applyHaul(t.goodId, t.fromSystemId, t.toSystemId, Math.floor(t.quantity * catchUp));
    }
    for (const t of contracts) {
      const qty = Math.floor(t.quantity * catchUp);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const terms = params.contractTerms({
        goodId: t.goodId, quantity: qty, fromSystemId: t.fromSystemId, toSystemId: t.toSystemId,
      });
      if (!terms) continue;
      contractCreates.push({
        fromSystemId: t.fromSystemId,
        toSystemId: t.toSystemId,
        goodId: t.goodId,
        quantity: qty,
        reward: terms.reward,
        deadlineTick: terms.deadlineTick,
        factionId: factionKey,
        createdAtTick: ctx.tick,
      });
    }
  }

  // 3. Persist.
  if (updates.size > 0) {
    await world.applyMarketUpdates(
      [...updates.entries()].map(([id, stock]) => ({ id, stock })),
    );
  }
  if (flows.length > 0) await world.appendLogisticsFlows(flows);
  if (contractCreates.length > 0) await world.createLogisticsContracts(contractCreates);
  if (closeIds.length > 0) await world.closeLogisticsContracts(closeIds);

  return {};
}
```

(Keep the existing `toLogisticsState` helper above the body unchanged. `LogisticsMarketUpdate` stays
imported. The unused `qty <= 0` Phase-1 inline block is now inside `applyHaul`.)

Then update the live wiring `directedLogisticsProcessor.process` (bottom of the same file) to build
`contractTerms` and pass the new params:

```ts
  async process(ctx): Promise<TickProcessorResult> {
    const world = new PrismaDirectedLogisticsWorld(ctx.tx);
    const hops = await loadHopDistances();
    const routeCost: RouteCost = (fromId, toId) => {
      const h = hops.get(fromId)?.get(toId);
      if (h === undefined || h > DIRECTED_LOGISTICS.MAX_HOPS) return null;
      return h * DIRECTED_LOGISTICS.HOP_WEIGHT;
    };
    const contractTerms: LogisticsContractTerms = ({ goodId, quantity, fromSystemId, toSystemId }) => {
      const h = hops.get(fromSystemId)?.get(toSystemId);
      if (h === undefined) return null;
      const tier = GOOD_TIER_BY_KEY[goodId] ?? 0;
      return {
        reward: calculateReward(quantity, h, tier, false),
        deadlineTick: ctx.tick + DIRECTED_LOGISTICS.CONTRACT_DEADLINE_TICKS,
      };
    };
    return runDirectedLogisticsProcessor(world, ctx, {
      interval: DIRECTED_LOGISTICS.INTERVAL,
      routeCost,
      contractCount: DIRECTED_LOGISTICS.CONTRACTS_PER_CYCLE,
      contractTerms,
    });
  },
```

- [ ] **Step 4: Update the simulator call-site**

In `lib/engine/simulator/economy.ts`, the `runDirectedLogisticsProcessor` call inside
`processSimDirectedLogistics` (~line 413) currently passes `{ interval, routeCost }`. Add the two params:

```ts
  await runDirectedLogisticsProcessor(dlWorld, { tick: world.tick }, {
    interval: 2 * constants.economy.interval,
    routeCost,
    contractCount: 0,          // sim has no players → all volume moves silently (no Contract churn)
    contractTerms: () => null,
  });
```

- [ ] **Step 5: Run unit + typecheck, verify pass**

Run: `unset DATABASE_URL; npx vitest run --project unit lib/tick/processors/__tests__/directed-logistics.test.ts lib/engine/__tests__/simulator.test.ts && npx tsc --noEmit`
Expected: PASS (all body + Contract tests; sim test unaffected) + no type errors.

- [ ] **Step 6: Commit**

```bash
git add lib/tick/processors/directed-logistics.ts lib/engine/simulator/economy.ts lib/tick/processors/__tests__/directed-logistics.test.ts
git commit -m "feat(logistics): timeout-resolve + top-K Contract creation in the processor body"
```

---

## Task 6: Retire the price-ratio generator + protect logistics from generic expiry

> After this task the only trade-mission generators are the directed-logistics matcher (demand-driven)
> and `selectEventCandidates` (event-themed). `selectEconomyCandidates` and its now-dead world plumbing
> are deleted. `expireUnclaimedMissions` no longer touches logistics Contracts (the directed-logistics
> processor resolves those). Verified earlier: `selectEconomyCandidates` / `MarketSnapshot` are imported
> ONLY by `lib/tick/processors/trade-missions.ts` + the engine test — safe to delete.

**Files:**
- Modify: `lib/engine/missions.ts`
- Modify: `lib/engine/__tests__/missions.test.ts`
- Modify: `lib/tick/processors/trade-missions.ts`
- Modify: `lib/tick/world/trade-missions-world.ts`
- Modify: `lib/tick/adapters/prisma/trade-missions.ts`
- Modify: `lib/tick/processors/__tests__/trade-missions.test.ts`

**Interfaces:**
- Produces: `TradeMissionsProcessorParams = { rng: () => number }` (no `interval`).

- [ ] **Step 1: Delete `selectEconomyCandidates` + `MarketSnapshot` from the engine**

In `lib/engine/missions.ts`, delete the `MarketSnapshot` interface (lines ~10-15) and the entire
`selectEconomyCandidates` function + its `// ── Economy-based candidate generation ──` section
(lines ~67-145). Keep `calculateReward`, `MissionCandidate`, `MissionEventSnapshot`,
`EventMissionGoodsEntry`, `selectEventCandidates`, `validateAccept`, `validateDelivery`.

- [ ] **Step 2: Delete the `selectEconomyCandidates` tests**

In `lib/engine/__tests__/missions.test.ts`, remove `selectEconomyCandidates` and `type MarketSnapshot`
from the top import, and delete the entire `describe("selectEconomyCandidates", …)` block (~lines 91-165).

- [ ] **Step 3: Rewrite the trade-missions processor (event + lifecycle only)**

Replace `lib/tick/processors/trade-missions.ts` with:

```ts
import type {
  TickContext,
  TickProcessor,
  TickProcessorResult,
  PlayerEventMap,
} from "../types";
import { addPlayerNotification } from "../helpers";
import { selectEventCandidates } from "@/lib/engine/missions";
import { MISSION_CONSTANTS } from "@/lib/constants/missions";
import { EVENT_MISSION_GOODS } from "@/lib/constants/events";
import { GOOD_TIER_BY_KEY } from "@/lib/constants/goods";
import { PrismaTradeMissionsWorld } from "@/lib/tick/adapters/prisma/trade-missions";
import type {
  MissionCreate,
  TradeMissionsWorld,
} from "@/lib/tick/world/trade-missions-world";

export interface TradeMissionsProcessorParams {
  rng: () => number;
}

/**
 * Pure processor body. Trade missions are now generated only from active events (the demand-driven
 * supply hauls live in the directed-logistics processor as logistics Contracts). This processor owns
 * the generic player lifecycle: expiring missions + event-themed generation. Logistics Contracts are
 * excluded from unclaimed expiry — directed-logistics resolves (hauls) those itself.
 */
export async function runTradeMissionsProcessor(
  world: TradeMissionsWorld,
  ctx: TickContext,
  params: TradeMissionsProcessorParams,
): Promise<TickProcessorResult> {
  const { rng } = params;

  // 1. Expire missions.
  const expiredUnclaimedCount = await world.expireUnclaimedMissions(ctx.tick);
  const expiredAccepted = await world.getExpiredAcceptedMissions(ctx.tick);

  const playerEvents = new Map<string, Partial<PlayerEventMap>>();
  if (expiredAccepted.length > 0) {
    await world.deleteMissions(expiredAccepted.map((m) => m.id));
    for (const m of expiredAccepted) {
      addPlayerNotification(playerEvents, m.playerId, {
        message: `Mission expired: deliver ${m.quantity} ${m.goodName} to ${m.destinationName}`,
        type: "mission_expired",
        refs: { system: { id: m.destinationId, label: m.destinationName } },
      });
    }
  }

  // 2. Event-themed generation (responsive, every tick).
  const activeEvents = await world.getActiveEvents();
  const candidates = selectEventCandidates(
    activeEvents,
    EVENT_MISSION_GOODS,
    GOOD_TIER_BY_KEY,
    ctx.tick,
    rng,
  );

  if (candidates.length === 0) {
    await world.persistNotifications(playerEvents, ctx.tick);
    return {
      globalEvents: { missionsUpdated: [{ count: 0, expired: expiredUnclaimedCount }] },
      playerEvents: playerEvents.size > 0 ? playerEvents : undefined,
    };
  }

  // 3. Per-station cap + good ID resolution.
  const countByStation = await world.getAvailableMissionCountsByStation();
  const goodKeyToId = await world.resolveGoodIds();

  const toCreate: MissionCreate[] = [];
  const stationAdds = new Map<string, number>();
  for (const c of candidates) {
    const baseCount = countByStation.get(c.systemId) ?? 0;
    const pending = stationAdds.get(c.systemId) ?? 0;
    if (baseCount + pending >= MISSION_CONSTANTS.MAX_AVAILABLE_PER_STATION) continue;

    const dbGoodId = goodKeyToId.get(c.goodId);
    if (!dbGoodId) continue;

    toCreate.push({
      systemId: c.systemId,
      destinationId: c.destinationId,
      goodId: dbGoodId,
      quantity: c.quantity,
      reward: c.reward,
      deadlineTick: c.deadlineTick,
      eventId: c.eventId,
      createdAtTick: ctx.tick,
    });
    stationAdds.set(c.systemId, pending + 1);
  }

  await world.createMissions(toCreate);
  await world.persistNotifications(playerEvents, ctx.tick);

  return {
    globalEvents: { missionsUpdated: [{ count: toCreate.length, expired: expiredUnclaimedCount }] },
    playerEvents: playerEvents.size > 0 ? playerEvents : undefined,
  };
}

// ── Live-game wiring ──────────────────────────────────────────────

export const tradeMissionsProcessor: TickProcessor = {
  name: "trade-missions",
  frequency: 1,
  dependsOn: ["events", "economy"],

  async process(ctx): Promise<TickProcessorResult> {
    const world = new PrismaTradeMissionsWorld(ctx.tx);
    return runTradeMissionsProcessor(world, ctx, { rng: Math.random });
  },
};
```

- [ ] **Step 4: Remove dead methods from the trade-missions world interface**

In `lib/tick/world/trade-missions-world.ts`, delete the `MarketPriceView` interface (~lines 23-30) and
remove `getSystemIds` and `getMarketPricesForSystems` from the `TradeMissionsWorld` interface.

- [ ] **Step 5: Update the Prisma trade-missions adapter**

In `lib/tick/adapters/prisma/trade-missions.ts`:
- Remove the `getSystemIds` and `getMarketPricesForSystems` methods.
- Remove the now-unused imports `spotPrice, curveForGood` (from `@/lib/engine/market-pricing`) and the
  `MarketPriceView` type import.
- Add `origin: { not: "logistics" }` to `expireUnclaimedMissions` so logistics Contracts survive for
  directed-logistics to resolve:

```ts
  async expireUnclaimedMissions(currentTick: number): Promise<number> {
    const result = await this.tx.tradeMission.deleteMany({
      where: { deadlineTick: { lte: currentTick }, playerId: null, origin: { not: "logistics" } },
    });
    return result.count;
  }
```

- Tag generated missions as event-origin (after retiring economy gen, this path only makes event
  missions):

```ts
  async createMissions(rows: MissionCreate[]): Promise<void> {
    if (rows.length === 0) return;
    await this.tx.tradeMission.createMany({
      data: rows.map((r) => ({ ...r, origin: "event" as const })),
    });
  }
```

- [ ] **Step 6: Update the trade-missions processor tests**

In `lib/tick/processors/__tests__/trade-missions.test.ts`:
- Remove the `import { shardRange } …` line.
- Remove `getSystemIds` and `getMarketPricesForSystems` from the stub world in `makeStubWorld` (and the
  `marketSystemIdsByTick` tracking + its return field).
- Delete the entire `describe("runTradeMissionsProcessor — economy shard coverage", …)` block.
- In the remaining `describe` blocks (event-path + expiry), change every processor call from
  `{ rng: () => 0.5, interval }` to `{ rng: () => 0.5 }`, and drop the now-unused `interval` /
  `makeSystemIds` locals where they only fed the removed economy path. Keep the event-responsive +
  expiry-every-tick assertions intact.

- [ ] **Step 7: Run the affected unit tests + typecheck**

Run: `unset DATABASE_URL; npx vitest run --project unit lib/engine/__tests__/missions.test.ts lib/tick/processors/__tests__/trade-missions.test.ts && npx tsc --noEmit`
Expected: PASS + no type errors (no dangling references to deleted symbols).

- [ ] **Step 8: Commit**

```bash
git add lib/engine/missions.ts lib/engine/__tests__/missions.test.ts lib/tick/processors/trade-missions.ts lib/tick/world/trade-missions-world.ts lib/tick/adapters/prisma/trade-missions.ts lib/tick/processors/__tests__/trade-missions.test.ts
git commit -m "feat(logistics): retire price-ratio trade missions; shield logistics Contracts from expiry"
```

---

## Task 7: Integration coverage + full verification

**Files:**
- Create: `lib/tick/processors/__tests__/integration/directed-logistics.integration.test.ts`

**Interfaces:**
- Consumes: `PrismaDirectedLogisticsWorld` (Task 4); the integration harness in `lib/test-utils/integration.ts`.

- [ ] **Step 1: Read the reference harness**

Read `lib/tick/processors/__tests__/integration/economy.integration.test.ts` and
`lib/test-utils/integration.ts` to learn the exact `beforeAll` seed/setup + how to obtain a faction, two
of its systems, their `Station` + `StationMarket` rows, and a `Good`. Mirror that setup.

- [ ] **Step 2: Write the round-trip integration test**

Create `lib/tick/processors/__tests__/integration/directed-logistics.integration.test.ts`. Using the
harness setup, drive the **adapter** directly (the body logic is already unit-covered) to prove the SQL:

```ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { PrismaDirectedLogisticsWorld } from "@/lib/tick/adapters/prisma/directed-logistics";
// + harness imports mirrored from economy.integration.test.ts

describe("directed-logistics Contract I/O (integration)", () => {
  it("creates a logistics Contract, then reads + closes it after its deadline", async () => {
    // Arrange (mirror economy.integration.test.ts harness): get a faction `factionId`,
    // two of its systems `fromId`/`toId`, and a good KEY `goodKey` that exists as a Good row.

    await prisma.$transaction(async (tx) => {
      const world = new PrismaDirectedLogisticsWorld(tx);

      // Create one Contract due at tick 100.
      await world.createLogisticsContracts([{
        fromSystemId: fromId, toSystemId: toId, goodId: goodKey,
        quantity: 7, reward: 50, deadlineTick: 100, factionId, createdAtTick: 52,
      }]);
    }, { timeout: 30_000 });

    // It exists, origin = "logistics", unclaimed, no good FK dangling.
    const created = await prisma.tradeMission.findMany({
      where: { origin: "logistics", systemId: fromId, destinationId: toId },
    });
    expect(created).toHaveLength(1);
    expect(created[0].playerId).toBeNull();

    // Not yet expired at tick 99.
    await prisma.$transaction(async (tx) => {
      const world = new PrismaDirectedLogisticsWorld(tx);
      expect(await world.takeExpiredLogisticsContracts(99, [factionId])).toHaveLength(0);
      // Expired at tick 100 → returned with KEY good + endpoints, then closeable.
      const expired = await world.takeExpiredLogisticsContracts(100, [factionId]);
      expect(expired).toHaveLength(1);
      expect(expired[0]).toMatchObject({ fromSystemId: fromId, toSystemId: toId, goodId: goodKey, quantity: 7 });
      await world.closeLogisticsContracts(expired.map((e) => e.id));
    }, { timeout: 30_000 });

    const after = await prisma.tradeMission.findMany({
      where: { origin: "logistics", systemId: fromId, destinationId: toId },
    });
    expect(after).toHaveLength(0);
  });
});
```

Flesh out the `factionId` / `fromId` / `toId` / `goodKey` arrange block from the harness (do NOT leave
them undefined — bind them from the seeded universe exactly as `economy.integration.test.ts` binds its
fixtures).

- [ ] **Step 3: Run the integration test**

Run: `npx vitest run --project integration directed-logistics`
Expected: PASS (Contract created with `origin="logistics"`, read back after deadline, deleted).

- [ ] **Step 4: Full typecheck + unit sweep (prisma-taint guard)**

Run: `npx tsc --noEmit && unset DATABASE_URL; npx vitest run --project unit`
Expected: no type errors; ALL unit tests green (confirms no module statically imports `@/lib/prisma`
into a unit graph, and nothing references the deleted `selectEconomyCandidates` plumbing).

- [ ] **Step 5: Simulator sanity — curve must be UNCHANGED**

Run: `npm run simulate`
Expected: Because the sim passes `contractCount: 0`, directed logistics is byte-for-byte the Phase-1
silent path — striking-system count / population trend should match the pre-Phase-2 baseline (no NaN /
runaway / pinning). Record before/after in the PR description; any divergence means a contract path
leaked into the silent path and must be fixed before merge.

- [ ] **Step 6: Commit**

```bash
git add lib/tick/processors/__tests__/integration/directed-logistics.integration.test.ts
git commit -m "test(logistics): Contract create/expire/close integration round-trip"
```

---

## Self-Review (done at write time)

- **Spec coverage (Phase 2 scope):** `TradeMission.origin` (Task 1) ✓ · silent/Contract split dial =
  constant top-K (Tasks 2-3, 5) ✓ · logistics-Contract creation = the skim (Task 5) ✓ ·
  timeout-resolve = faction self-haul of unfilled Contracts (Task 5) ✓ · retire
  `selectEconomyCandidates` (Task 6) ✓ · delivery adds to destination stock = **already shipped**
  (`lib/services/missions.ts:365-374`, reused unchanged) ✓ · `origin` kept internal, no player-facing
  badge/filter (per user decision) ✓ · sim unaffected via `contractCount: 0` (Tasks 5, 7) ✓.
- **Out of Phase-2 scope (correctly absent):** map overlay by `flowType` (Phase 3), Logistics tab
  (Phase 4), treasury/cost, player-activity-scaled split, per-station cap for logistics (top-K bounds it).
- **Placeholder scan:** the only deferred specifics are the integration-test arrange bindings, which name
  the exact reference file to mirror (`economy.integration.test.ts`) — a concrete instruction, not a
  logic gap.
- **Type consistency:** `LogisticsContractCreate` / `ExpiredLogisticsContract` defined in Task 4 and
  consumed unchanged in Tasks 5/7; `LogisticsContractTerms` defined + consumed in Task 5;
  `splitContractTransfers` signature identical across Tasks 3 and 5; `createLogisticsContracts` /
  `takeExpiredLogisticsContracts` / `closeLogisticsContracts` names match across world, both adapters,
  and the body; `origin` literal `"logistics"` / `"event"` consistent across Tasks 1/4/6.

---

## Open implementer decisions (surfaced, not blocking)

- **`CONTRACTS_PER_CYCLE = 5` / `CONTRACT_DEADLINE_TICKS = 48`** — first-draft; calibrate against the
  simulator and live observation. (The sim runs `contractCount: 0`, so K is only exercised live — judge
  it by board density during the manual smoke.)
- **Reward reuse** — logistics Contracts reuse `calculateReward(quantity, hops, tier, false)`; revisit
  if the spread (buy-cheap-at-surplus → sell-dear-at-deficit) plus reward feels too rich.
- **Resolve-before-match ordering** — the body resolves expired Contracts, then re-matches on the
  adjusted stock so a just-filled deficit isn't re-served. The reverse overlap (resolve nudging stock
  above target) is clamp-bounded and rare at the 48-tick cadence — acceptable for v1.
