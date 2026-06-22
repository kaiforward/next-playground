# Plan — Re-seed auth redirect + map-debug dev-tools toggle

**Status:** approved design, pre-implementation. Transient build plan — delete once shipped.
**Branch:** `fix/reseed-auth-redirect-and-map-debug-toggle`
**Scope:** two small, independent dev/quality fixes bundled into one PR. The larger UX/UI
"gamification" pass on the system tabs is a *separate* design cycle and explicitly out of scope here.

---

## Fix 1 — Auth redirect after a universe re-seed

### Root cause
A DB re-seed wipes and recreates users/players with fresh IDs, but the player's JWT session
cookie survives. The cookie still decodes, so `auth()` returns a **truthy** session — meaning the
game layout's `if (!session) redirect("/login")` never fires. Every `/api/game/*` route, however,
gates on `getSessionPlayerId()`, whose `prisma.player.findUnique` now returns `null` → the routes
401. Net effect: the player is stranded on a broken game screen instead of being bounced to login.
(Logout already works because `signOut()` actively clears the cookie — a different path.)

The gate is checking **session presence** when it should check **player existence**.

### Server-side change — `app/(game)/layout.tsx`
Validate the player, not just the session. `getSessionPlayerId()` (in `lib/auth/get-player.ts`)
already returns `null` for a deleted player, so reuse it:

```ts
const session = await auth();
const playerId = await getSessionPlayerId();

if (!session || !playerId) {
  redirect("/login");
}
```

`redirect()` returns `never`, so `session` narrows to non-null for the existing
`session.user?.email` usage below. The extra `auth()` call inside `getSessionPlayerId()` is a
cookie decode (no DB round-trip when the session is absent) — negligible. Catches the case on the
next hard load after a reseed.

### Client-side change — self-heal while the app is open
The reseed-while-playing case never triggers a hard load, so the server gate alone leaves
soft-navigated queries silently 401-ing. Fix the fetch + query layer to recognise auth failure and
redirect.

**1. Preserve the HTTP status in the fetcher — `lib/query/fetcher.ts`.**
Today all three wrappers throw a generic `Error(json.error)`, discarding the status. Introduce a
small typed error that carries it:

```ts
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}
```

In `apiFetch` / `apiMutate` / `apiDelete`, throw `new ApiError(json.error ?? "Unknown API error", res.status)`
on the existing `json.error || !json.data` branch. (Behaviour is otherwise unchanged — `ApiError`
extends `Error`, so existing `error.message` consumers keep working.)

**2. Global auth-error handler — `lib/query/client.ts`.**
Attach a `QueryCache` and `MutationCache` with an `onError` that redirects on a 401. Use a tiny
shared predicate + a module-level guard so the storm of simultaneous 401s after a reseed triggers a
single sign-out:

```ts
import { QueryCache, MutationCache, QueryClient } from "@tanstack/react-query";
import { signOut } from "next-auth/react";

function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

let redirecting = false;
function handleAuthError(error: unknown) {
  if (typeof window === "undefined" || redirecting || !isAuthError(error)) return;
  redirecting = true;
  void signOut({ redirectTo: "/login" }); // clears the stale cookie, then redirects
}
```

Wire `handleAuthError` into both caches' `onError`. `signOut` clears the dead cookie (so no lingering
broken session) and navigates to `/login` — matching the working manual-logout path. `ApiError` lives
in `lib/query/fetcher.ts`; import it here.

> Note: `isAuthError(error: unknown)` is the one sanctioned `unknown` — it's a boundary type guard,
> exactly the permitted pattern (narrow, don't store). The cache `onError` signature hands us `unknown`.

### Tests
- **Unit (`lib/query/fetcher.test.ts`)** — mock `fetch` to return a 401 with `{ error: "..." }`;
  assert `apiFetch` rejects with an `ApiError` whose `.status === 401`. Add a 200-with-data happy
  path and a 500 case (`.status === 500`) to lock the contract.
- **Unit** — `isAuthError`: true for `new ApiError("x", 401)`, false for a 500 `ApiError`, a plain
  `Error`, and non-error values. (Export it for the test.)
- The server layout redirect and the `signOut` side-effect are verified by manual smoke (below) —
  they sit on the Next/NextAuth boundary that the `unit` project can't load (`DATABASE_URL` unset;
  see CLAUDE.md unit-test gotcha — keep prisma-tainted imports out of the unit graph).

---

## Fix 2 — Map zoom/LOD debug overlay → dev-tools toggle (off by default)

Today `MapZoomDebug` is always on in dev (`star-map.tsx:334`, gated only on `NODE_ENV`), cluttering
the map. Move it behind an on/off toggle in the existing Dev Tools panel. Only a **boolean** needs to
cross components — `zoom` stays local in `StarMap`.

### New shared state — `components/dev-tools/dev-overlay-context.tsx`
A minimal context mirroring the existing `useSidebarContext` idiom (throws if used outside its
provider):

```ts
interface DevOverlayState {
  showMapDebug: boolean;
  setShowMapDebug: (v: boolean) => void;
}
// DevOverlayProvider holds useState(false); useDevOverlay() reads context or throws.
```

Wrap it in `GameShellInner` (`components/game-shell.tsx`) so both the panel and the map (rendered as
`children`) consume it. Provided unconditionally — harmless in prod, where the only writer (the
dev-only panel) never mounts, so `showMapDebug` stays `false` and the overlay never renders.

### Dev tools panel — `components/dev-tools/dev-tools-panel.tsx`
- Add `"Map"` to `TABS`.
- Render `{tab === "Map" && <MapDebugSection />}`.

### New section — `components/dev-tools/map-debug-section.tsx`
A single toggle reading/writing `useDevOverlay()`, styled to match the existing sections (mirror the
`Button variant="ghost"` toggle idiom from `EconomyOverviewSection`, or `CheckboxInput` if it reads
cleaner): "Show zoom/LOD overlay" / "Hide zoom/LOD overlay".

### Star map — `components/map/star-map.tsx`
Replace the `NODE_ENV` gate with the toggle:

```tsx
{showMapDebug && <MapZoomDebug zoom={zoom} />}   // showMapDebug from useDevOverlay()
```

The toggle only exists in the dev-only panel, so `showMapDebug` can only be true in dev — the
`NODE_ENV` check becomes redundant and is dropped. Update the comment at the call site and the file
header doc in `map-zoom-debug.tsx` (currently says "gated at the StarMap call site") to read
"toggled via Dev Tools → Map".

### Tests
Pure wiring/UI — verified by manual smoke. (Optionally a trivial `useDevOverlay` throws-outside-provider
test, matching nothing else in the codebase, so skip unless cheap.)

---

## File-by-file summary

| File | Change |
|---|---|
| `app/(game)/layout.tsx` | Gate on player existence, not just session |
| `lib/query/fetcher.ts` | Add `ApiError` (carries `status`); throw it from all three wrappers |
| `lib/query/client.ts` | `QueryCache`/`MutationCache` `onError` → `signOut` on 401; `isAuthError` guard |
| `lib/query/fetcher.test.ts` | New — status preservation + `isAuthError` |
| `components/dev-tools/dev-overlay-context.tsx` | New — `DevOverlayProvider` + `useDevOverlay` |
| `components/game-shell.tsx` | Wrap `GameShellInner` in `DevOverlayProvider` |
| `components/dev-tools/dev-tools-panel.tsx` | Add `"Map"` tab |
| `components/dev-tools/map-debug-section.tsx` | New — overlay on/off toggle |
| `components/map/star-map.tsx` | Render overlay on `showMapDebug` instead of `NODE_ENV` |
| `components/map/map-zoom-debug.tsx` | Update header-doc comment |

## Verification
- `npx tsc --noEmit` clean · `npx vitest run` green (incl. new fetcher tests).
- Manual smoke (dev): (a) reseed **with the app open** → next query bounces to `/login`; (b) reseed
  then hard-reload a game URL → redirected to `/login`; (c) normal logout still redirects;
  (d) Dev Tools → Map toggles the zoom/LOD overlay on/off; default is off.

## Out of scope
UX/UI gamification of the system tabs (Industry-first) — separate brainstorm → spec → plan cycle.
