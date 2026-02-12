# Rate Limiting

In-memory sliding window rate limiter. No external dependencies.

## Architecture

- **`lib/constants/rate-limit.ts`** — Tier definitions (limits, windows)
- **`lib/api/rate-limit.ts`** — `SlidingWindowStore`, `getClientIp()`, `rateLimit()` helper
- **`proxy.ts`** — Global IP-based rate limit applied to all matched API routes
- Route handlers call `rateLimit()` only for tiers that need request-specific context (player ID, route type)

## Tiers

| Tier | Key | Limit | Window | Where applied |
|------|-----|-------|--------|---------------|
| `global` | `ip:{clientIp}` | 100 req | 60s | **Middleware** — all API routes automatically |
| `mutation` | `mutation:{playerId}` | 20 req | 60s | **Route-level** — trade, navigate (after auth resolves player ID) |
| `auth` | `auth:{clientIp}` | 5 req | 60s | **Route-level** — register, login POST |

## Why Hybrid (Middleware + Route-Level)

The **global** tier is identical for every route and keys by IP alone — middleware handles this automatically so individual routes don't need any rate-limit code.

The **mutation** and **auth** tiers stay at the route level because they need context that middleware doesn't have:
- **Mutation** keys by `playerId`, which is resolved from the session inside the route handler. Two players behind the same IP (shared network, VPN) should each get their own mutation budget.
- **Auth** uses a stricter limit than global and keys by `auth:{ip}` to protect login/register specifically.

## When to Add Route-Level Rate Limiting

Add a `rateLimit()` call in a route handler when:
- The route needs a **stricter limit** than the global tier (e.g. auth endpoints)
- The route needs to limit by a **non-IP key** like player ID (e.g. mutations)

Do **not** add route-level checks for the global tier — middleware already covers it.

## How It Works

`SlidingWindowStore` maintains a `Map<string, number[]>` of request timestamps per key. On each `check()`:

1. Filter out timestamps older than the window
2. If count >= limit, return `{ allowed: false, retryAfterMs }`
3. Otherwise, record the timestamp and return `{ allowed: true }`

A lazy sweep runs every 60s to clean up fully-expired keys.

## Response Format

Rate-limited requests receive:
- HTTP 429 status
- `Retry-After` header (seconds)
- Body: `{ error: "Too many requests. Please try again later." }`

## Scaling

The in-memory store is correct for single-server deployments. For multi-instance scaling, replace `SlidingWindowStore` with a Redis-backed implementation — the `rateLimit()` interface and all route/proxy code stays identical.

## Not Rate-Limited

- `GET /api/game/tick-stream` — SSE long-lived connection, excluded from proxy matcher
