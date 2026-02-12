# Backlog

Actionable work items. When something ships, delete it — git history is the audit trail. For detailed designs, see linked docs in `docs/design/`.

Sizes: **S** (hours), **M** (1-2 sessions), **L** (multi-session), **XL** (multi-week).

## Ready

Well-defined, can start now.

- **[S] Responsive navigation** — `GameNav` has no mobile breakpoints. Add hamburger menu or collapse below ~640px.
- **[S] Eager loading optimization** — `getSessionPlayer()` loads full player with all ships/cargo. For single-ship routes (`navigate`, `trade`), only one ship is needed. Add targeted query as fleet grows.
- **[S] Curated universe names** — Current procedural names are generic ("Forge-7"). Add curated name pools or hybrid naming for more flavour.
- **[S] npc.ts — test or remove** — `lib/engine/npc.ts` has no tests. Predates the tick pipeline and may be superseded by the NPC architecture below. Add tests if retained; remove if replaced.
- **[M] Event content expansion** — 4 fully designed event definitions ready to add: Mining Boom, Supply Shortage, Pirate Raid, Solar Storm. See [event-catalog.md](./event-catalog.md) "Ready to Implement" section.
- **[M] Loading & error state strategy** — Consistent error display per page (`isError`/`error` from query hooks), Suspense boundaries for page-level loading, error boundaries wrapping game pages, query boundaries for deferred fetches (modals, panels).

## Needs Design

Direction is clear, approach needs a design doc before implementation.

- **[L] Supply chain dependencies** — Production recipes where goods require inputs (e.g. ore + electronics → ship_parts). Disruptions cascade through chains. See [simulation-enhancements.md](./simulation-enhancements.md) "Supply Chain Dependencies".
- **[M] Cyclical demand / seasonal events** — Deterministic time-based event spawns (harvest festivals, trade summits) that interact with random events. See [simulation-enhancements.md](./simulation-enhancements.md) "Seasonal Cycles".
- **[M] NPC trade pressure (Tier 1)** — Statistical trade flows that smooth price extremes via modifiers. Should only land after event system provides enough disruption. See [simulation-enhancements.md](./simulation-enhancements.md) "NPC Trade Pressure".
- **[M] Inter-region trade flows** — Goods flowing between regions via gateways based on regional surplus/deficit. Creates visible trade volume and regional price gradients. Depends on economy work to determine flow mechanics.
- **[M] Reversion rate tuning** — Current 5% base reversion may be too aggressive. Slower reversion means player trades leave a bigger, longer-lasting mark. Needs playtesting data to inform changes.

## Future

Blocked on prerequisites or very large scope.

- **[XL] PostgreSQL migration** — Swap Prisma adapter from better-sqlite3 to pg. Enables parallel transactions, per-processor idempotency tracking, batch writes, and region-level parallelism. See `docs/design/archive/tick-engine-redesign.md` Step 5.
- **[L] NPC agents (Tier 2)** — Distinct gameplay NPCs with decision trees, missions, rivals. Separate from Tier 1 statistical pressure. Design doc needed.
- **[M] Events processor query optimization** — Re-fetches all events 3x per tick; fine on SQLite, problematic on PostgreSQL. Options: in-memory event store, sub-processors, or in-memory bookkeeping. Blocked on PostgreSQL migration.
- **[M] Batch writes** — Economy processor uses individual Prisma updates inside a transaction. Batch SQL deferred to PostgreSQL migration.
