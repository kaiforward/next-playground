# Backlog

Actionable work items. When something ships, delete it — git history is the audit trail. For detailed designs, see linked docs in `docs/design/`.

Sizes: **S** (hours), **M** (1-2 sessions), **L** (multi-session), **XL** (multi-week).

## Ready

Well-defined, can start now.

- **[M] Economy balance pass** — Goods imbalance (ship_parts/electronics = 95-100% of profit), universe underutilization (5-12% of systems visited), luxury stagnation. Proposals 1-3 (price clamps, equilibrium targets, luxury consumers) as one PR. See [economy-balance.md](./economy-balance.md).
- **[S] Responsive navigation** — `GameNav` has no mobile breakpoints. Add hamburger menu or collapse below ~640px.
- **[S] Curated universe names** — Current procedural names are generic ("Forge-7"). Add curated name pools or hybrid naming for more flavour.
- **[S] Impove UI for dev cheat panel**
Other floating elements including the sidebar on the map get in the way of the dev cheat panel button. We should move it to an unused place in the header instead.
- **[S] Impove UI**
Standardize main content panel size, system detail smaller than command center. Command center should be the base width for most page types.
- **[M] Event content expansion** — 4 fully designed event definitions ready to add: Mining Boom, Supply Shortage, Pirate Raid, Solar Storm. See [event-catalog.md](./event-catalog.md) "Ready to Implement" section.
- **[M] Loading & error state strategy** — Consistent error display per page (`isError`/`error` from query hooks), Suspense boundaries for page-level loading, error boundaries wrapping game pages, query boundaries for deferred fetches (modals, panels).

## Needs Design

Direction is clear, approach needs a design doc before implementation.

- **[L] Supply chain dependencies** — Production recipes where goods require inputs (e.g. ore + electronics → ship_parts). Disruptions cascade through chains. See [simulation-enhancements.md](./simulation-enhancements.md) "Supply Chain Dependencies".
- **[M] Cyclical demand / seasonal events** — Deterministic time-based event spawns (harvest festivals, trade summits) that interact with random events. See [simulation-enhancements.md](./simulation-enhancements.md) "Seasonal Cycles".
- **[M] NPC trade pressure (Tier 1)** — Statistical trade flows that smooth price extremes via modifiers. Should only land after event system provides enough disruption. See [simulation-enhancements.md](./simulation-enhancements.md) "NPC Trade Pressure".
- **[M] Inter-region trade flows** — Goods flowing between regions via gateways based on regional surplus/deficit. Creates visible trade volume and regional price gradients. Depends on economy work to determine flow mechanics.
- **[M] Reversion rate tuning** — Current 5% base reversion may be too aggressive. Slower reversion means player trades leave a bigger, longer-lasting mark. Simulator data now available — see [economy-balance.md](./economy-balance.md) Proposal 4 for related production rate changes.

## Future

Blocked on prerequisites or very large scope.

- **[XL] PostgreSQL migration** — Swap Prisma adapter from better-sqlite3 to pg. Enables parallel transactions, per-processor idempotency tracking, batch writes, and region-level parallelism. See `docs/design/archive/tick-engine-redesign.md` Step 5.
- **[L] NPC agents (Tier 2)** — Distinct gameplay NPCs with decision trees, missions, rivals. Separate from Tier 1 statistical pressure. Design doc needed.
- **[M] Events processor query optimization** — Re-fetches all events 3x per tick; fine on SQLite, problematic on PostgreSQL. Options: in-memory event store, sub-processors, or in-memory bookkeeping. Blocked on PostgreSQL migration.
- **[M] Batch writes** — Economy processor uses individual Prisma updates inside a transaction. Batch SQL deferred to PostgreSQL migration.
