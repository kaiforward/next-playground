# Backlog

Actionable work items. When something ships, delete it — git history is the audit trail. For detailed designs, see linked docs in `docs/active/` and `docs/planned/`.

Sizes: **S** (hours), **M** (1-2 sessions), **L** (multi-session), **XL** (multi-week).

## Ready

Well-defined, can start now.

- **[S] Responsive navigation** — `GameNav` has no mobile breakpoints. Add hamburger menu or collapse below ~640px.
- **[S] Curated universe names** — Current procedural names are generic ("Forge-7"). Add curated name pools or hybrid naming for more flavour.
- **[S] Improve UI for dev cheat panel** — Other floating elements including the sidebar on the map get in the way of the dev cheat panel button. Move it to the header.
- **[S] Improve UI** — Standardize main content panel size, system detail smaller than command center.
- **[L] Mini-game fullscreen host + wager escrow** — Move in-cantina mini-games out of the dismissable system detail panel into a top-layer fullscreen modal (can only be left deliberately; confirm-and-forfeit on exit), and escrow wagers at game start so a hard refresh can't dodge a loss. Full design (approach, escrow model, file changes, build order) in `docs/planned/mini-game-fullscreen-host.md`. Ships in two phases — escrow first (behind the existing UI), then the host. Unblocks the rest of the planned mini-games (Drift, Alignment, Cargo Roulette).
- **[M] Hazard chain reactions** — When a `high` hazard good has an incident, it can trigger `low` hazard goods in the same hold (fuel + weapons = cascading disaster). Makes carrying multiple hazardous goods exponentially risky rather than linearly. Depends on hazard incidents shipping first.
- **[S] Smuggler suspicion / escalating heat** — Track per-player per-region suspicion level. Each successful smuggle raises it, getting caught resets but raises the base inspection rate permanently. Creates emergent "smuggler reputation" without a formal system. Decay over time.
- **[S] Bribe system for inspections** — When caught with contraband, option to pay a bribe (2× the fine) to avoid confiscation. Corrupt governments (corporate, frontier) accept more often. Federation almost never. Money sink that rewards cash reserves.
- **[S] Simulator hot-loop cost (deferred from PR81 review)** — `findOpportunities` (`lib/engine/simulator/strategies/helpers.ts`) does an O(totalMarkets) `world.markets.find()` inside a `reachable × localGoods` double loop, and `getPrice` rebuilds a `MarketCurve` via `curveForGood` on every call. Offline calibration harness only (not user-facing), but a real algorithmic blow-up at universe scale. Fix: build a `Map<systemId|goodId, entry>` once per tick; cache the curve on `SimMarketEntry`. Same `curveForGood`-per-call allocation also affects `snapshot.ts`/`market-analysis.ts`/`trade-flow.ts`. Natural fit for PR 3 (calibration).

## Needs Design

Direction is clear, approach needs a design doc before implementation.

- **[M] Decouple reputation reward from market price** — Favourable rep multipliers act as a negative spread; to avoid reopening the instant-resell exploit they're capped at ±2% (almost cosmetic). Move the real reputation reward off the price spread entirely: reduced taxes/tariffs/docking fees, access to restricted goods or higher quantity caps, better mission rewards. Then rep can be impactful without threatening the no-instant-resell-profit invariant. See `lib/constants/reputation.ts` and the anti-arbitrage test in its `__tests__`.
- **[M] Reversion rate tuning** — Current 5% base reversion may be too aggressive. Slower reversion means player trades leave a bigger, longer-lasting mark. Per-good rates now in place — see simulator metrics for balance data.

## Future

Blocked on prerequisites or very large scope.

- **[XL] PostgreSQL migration** — Swap Prisma adapter from better-sqlite3 to pg. Enables parallel transactions, per-processor idempotency tracking, batch writes, and region-level parallelism. See `docs/archive/tick-engine-redesign.md` Step 5.
- **[M] Switchable faction relation model** — `FactionRelation` currently stores one shared `score` per faction pair (symmetric). If the War sub-project or later play-testing reveals asymmetric opinions matter (one-sided grudges, vassal arrangements, "I trust you more than you trust me"), switch to per-direction scores. Two shapes available: (a) add `aOpinionOfB` / `bOpinionOfA` columns keeping the canonical-ordering convention; (b) drop ordering, store two rows per pair. Reevaluate post-PR-4 once the relations adapter exists and War's needs are clearer.
- **[L] NPC agents (Tier 2)** — Distinct gameplay NPCs with decision trees, rivals. Separate from Tier 1 statistical pressure. Trade missions now exist as auto-generated contracts — NPC agents could accept/complete missions too. Design doc needed.
- **[M] Events processor query optimization** — Re-fetches all events 3x per tick; fine on SQLite, problematic on PostgreSQL. Options: in-memory event store, sub-processors, or in-memory bookkeeping. Blocked on PostgreSQL migration.
- **[M] Batch writes** — Economy processor uses individual Prisma updates inside a transaction. Batch SQL deferred to PostgreSQL migration.
