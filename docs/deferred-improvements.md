# Deferred Improvements

Items identified during the `feat/fleet-management` code review that are deferred to future PRs.

## Missing Test Coverage

### `simulateEconomyTick` (lib/engine/tick.ts)

The economy simulation function has zero test coverage. It uses `Math.random()` internally, so tests need either RNG injection or `Math.random` mocking.

**Test scenarios needed:**
- Good produced by its economy type (supply increases, demand decreases)
- Good consumed by its economy type (supply decreases, demand increases)
- Good that is both produced and consumed simultaneously
- Good that is neither produced nor consumed (drift only)
- Supply clamping at lower bound (5)
- Supply clamping at upper bound (200)
- Demand clamping at lower bound (5)
- Demand clamping at upper bound (200)
- Immutability: input array is not mutated

**Suggested approach:** Accept an optional RNG function parameter (default `Math.random`) so tests can pass a deterministic seed.

### `npc.ts` (lib/engine/npc.ts)

No test file exists. Both `simulateNpcTrade` and `pickNpcDestination` need coverage.

**`simulateNpcTrade` scenarios:**
- Empty market (no goods available) — returns no trades
- Good below buy threshold (price < 0.8x base) with sufficient supply — NPC buys
- Good below buy threshold but supply <= 5 — NPC does not buy
- Good above sell threshold (price > 1.5x base) with sufficient demand — NPC sells
- Good above sell threshold but demand <= 10 — NPC does not sell
- NPC credits exhaustion mid-loop — stops buying, can still sell
- Multiple goods meeting buy criteria — processes all within credit budget
- Both buy and sell conditions met for different goods in same call

**`pickNpcDestination` scenarios:**
- No outgoing connections — returns null
- Single outgoing connection — returns that system (deterministic)
- Multiple outgoing connections — returns one of them (mock Math.random)

## Outdated Documentation

Docs have concrete errors and gaps from the services/TanStack Query migration. Not blocking — CLAUDE.md covers patterns for development. Fix when next onboarding or doing a major feature.

**Errors to fix:**
- `trading-ui.md`: references non-existent `usePlayer()` hook (should be `useFleet()`)
- `trading-ui.md`: wrong endpoint `/api/game/trade` (should be `/api/game/ship/[shipId]/trade`)
- `SPEC.md` line 75: describes polling tick system (actually SSE via `tick-stream`)
- `auth.md`: only mentions `getSessionPlayer()`, not the lightweight `getSessionPlayerId()` variant routes actually use

**Gaps:**
- No doc covers services layer (`lib/services/`) or TanStack Query hooks — only CLAUDE.md
- SPEC.md "Technical Stack" section duplicates CLAUDE.md — trim or cross-reference
- `data-model.md` should document the convention of adding `@@index` for foreign keys used in frequent queries (e.g., `Ship.playerId`, `TradeHistory.stationId`)

## Infrastructure

### Loading & Error State Strategy
Now that all data fetching uses TanStack Query, revisit loading/error handling holistically. Currently pages check `isLoading` individually but don't display query errors. Consider:
- Consistent error display per page (use `isError` / `error` from query hooks)
- Suspense boundaries for page-level loading (replace manual `if (loading)` checks)
- Error boundaries wrapping game pages to catch unexpected failures
- Query boundaries for deferred fetches (e.g., modal popups, slide-over panels that fetch on open)

### Rate Limiting on Registration
`POST /api/register` has no rate limiting. An attacker could create thousands of accounts, each receiving a starter ship and 1000 credits. Add per-IP rate limiting middleware.

### Toast/Notification System
Error display currently uses `alert()` (blocking, unstyled) in the map and trade pages. Replace with a toast notification component for non-blocking, styled error/success messages. Consider `sonner` or a lightweight custom implementation.

### Responsive Navigation
`GameNav` uses a flat flex layout with no mobile breakpoints. On narrow viewports, items overflow. Add a hamburger menu or responsive collapse for screens below ~640px.

### Focus Trap on Slide-Over Panels
`SystemDetailPanel` and `RoutePreviewPanel` overlay content but have no focus trap. Tab key can reach elements behind the panel. Add a focus trap (e.g., `focus-trap-react`) for full accessibility compliance.

### Eager Loading Optimization in `getSessionPlayer`
`getSessionPlayer()` loads the full player with all ships, cargo, systems, and destinations. For per-ship routes (`navigate`, `trade`), only one ship is needed. Consider a targeted query for single-ship operations as the fleet grows.
