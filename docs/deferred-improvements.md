# Deferred Improvements

Tracked items deferred to future PRs. Grouped by area.

## Economy & Gameplay

These features build on the **tick processor pipeline** (`lib/tick/`) and **regional universe** (8 regions, ~200 systems, gateway-based inter-region travel) delivered in `feat/tick-engine-pipeline`.

### Economy Redesign

The current mean-reverting drift model keeps prices stable but predictable — once a player learns the economy types, optimal routes are static. A proper economy design pass should address:

- **Disruption sources** — Random events (supply shocks, demand surges, station incidents) that push prices away from equilibrium unpredictably. Candidates for a `random-events` processor.
- **Supply chain dependencies** — Production chains where goods are inputs to other goods (e.g., ore + fuel → ship_parts). Disruptions cascade through the chain, creating emergent price volatility.
- **Cyclical demand** — Shifting demand patterns over long timescales so "best routes" rotate rather than being permanently solved.
- **Reversion rate tuning** — Current 5% reversion may be too aggressive. Slower reversion means player trades leave a bigger, longer-lasting mark.
- **NPC trade pressure (Tier 1)** — Statistical trade flows (not individual agents) that create intra-region arbitrage and inter-region flows through gateways. See `docs/tick-engine-redesign.md` Step 3 for the initial sketch. Deferred because the current model needs disruption mechanics first — NPC trade would accelerate price flattening, making the predictability problem worse.
- **Inter-region trade flows** — Goods flowing between regions via gateway stations based on regional surplus/deficit. Creates visible trade volume at gateways and regional price gradients. Depends on the economy redesign to determine flow mechanics.

Design docs to create/expand: `docs/economy-sim.md` (NPC pressure, inter-region flows, disruption model).

### New Tick Processors

The pipeline supports adding processors as one file + one registry line. Planned processors:

- **Random events** — Supply shocks, demand surges, trade disruptions. No dependencies. Frequency TBD.
- **Production** — Supply chain simulation. `dependsOn: ["economy"]`, staggered via `offset`. Requires supply chain design.
- **NPC agents (Tier 2)** — Distinct gameplay NPCs with decision trees, missions, rivals. Separate from Tier 1 statistical pressure. Low frequency, only simulates NPCs relevant to active players. Design doc needed: `docs/npc-agents.md`.

### Batch Writes (PostgreSQL)

Economy processor currently uses individual Prisma `update` calls inside a shared transaction — fast enough on SQLite at ~150 rows per region tick. True batch SQL (`UPDATE...FROM VALUES` with parameterized queries) deferred to the PostgreSQL migration. See `docs/tick-engine-redesign.md` Step 5.

### PostgreSQL Migration

Swap Prisma adapter from better-sqlite3 to pg. Enables:
- Independent parallel transactions per processor (processor code unchanged)
- Per-processor completion tracking via `tick_processor_log` table (idempotency)
- Region processors running fully parallel across workers
- Parameterized batch writes

See `docs/tick-engine-redesign.md` Step 5.

## Missing Test Coverage

### `npc.ts` (lib/engine/npc.ts)

No test file exists. This NPC code predates the tick pipeline and may be superseded by the economy redesign (Tier 1/Tier 2 NPC architecture in `docs/tick-engine-redesign.md`). Add tests if the code is retained; otherwise remove the module when it's replaced.

## UI & Frontend

### Map Layout Polish

The two-level star map (region overview + system detail) is functional but systems within regions are visually cramped. Needs layout tuning:
- System scatter radius and minimum distance adjustments (`lib/constants/universe-gen.ts`)
- React Flow layout options (force-directed or manual spacing)
- Region node sizing and padding

### Loading & Error State Strategy

All data fetching uses TanStack Query. Revisit loading/error handling:
- Consistent error display per page (use `isError` / `error` from query hooks)
- Suspense boundaries for page-level loading (replace manual `if (loading)` checks)
- Error boundaries wrapping game pages
- Query boundaries for deferred fetches (modals, slide-over panels)

### Toast/Notification System

Error display currently uses `alert()` (blocking, unstyled). Replace with toast notifications (`sonner` or lightweight custom). Non-blocking, styled error/success messages.

### Responsive Navigation

`GameNav` has no mobile breakpoints. Add hamburger menu or responsive collapse below ~640px.

### Focus Trap on Slide-Over Panels ✅

Implemented via reusable `Dialog` component (`components/ui/dialog.tsx`) wrapping native `<dialog>`. Supports modal (`showModal()`, browser-native focus trap) and non-modal (`.show()`, manual Escape + focus management) modes. Both map panels (`SystemDetailPanel`, `RoutePreviewPanel`) use non-modal. Includes `useDialog` convenience hook for open/close state.

## Infrastructure

### Rate Limiting on Registration

`POST /api/register` has no rate limiting. Add per-IP rate limiting middleware.

### Eager Loading Optimization

`getSessionPlayer()` loads full player with all ships/cargo. For single-ship routes (`navigate`, `trade`), only one ship is needed. Add targeted query as fleet grows.

### Curated Universe Names

Current universe generation uses generic procedural names ("Forge-7"). Add curated name pools or hybrid naming (procedural placement + curated identity) for more flavour. See `docs/economy-sim.md` Universe Generation section.
