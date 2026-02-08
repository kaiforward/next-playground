# Stream 2: Auth System

## Architecture

NextAuth v5 with JWT sessions and a Credentials provider. Players are auto-created on registration.

### Session Strategy

- **JWT** (not database sessions) — appropriate for Credentials provider
- Token contains `sub` (user ID), passed to `session.user.id` via callbacks
- `PrismaAdapter` is included for future OAuth provider support but is inactive for session management

### Files

| File | Purpose |
|---|---|
| `lib/auth/auth.ts` | NextAuth initialization, exports `handlers`, `auth`, `signIn`, `signOut` |
| `lib/auth/auth.config.ts` | Config: custom pages, JWT/session callbacks, session strategy |
| `lib/auth/credentials.ts` | `hashPassword` / `verifyPassword` using bcryptjs (12 rounds) |
| `lib/auth/get-player.ts` | Helper: gets the authenticated player from session for API routes |
| `lib/schemas/auth.ts` | Zod schemas for login/register validation |
| `app/api/auth/[...nextauth]/route.ts` | NextAuth route handler |
| `app/api/register/route.ts` | Registration endpoint |
| `components/providers/session-provider.tsx` | Client-side SessionProvider wrapper |
| `components/game-nav.tsx` | Nav bar with sign-out button |
| `types/next-auth.d.ts` | Module augmentation for `session.user.id` typing |

### Registration Flow

1. POST `/api/register` with `{ name, email, password }`
2. Validate with `registerSchema` (Zod)
3. Check for existing email (409 if taken)
4. Hash password with bcryptjs
5. Create User + Player (1000 credits, Sol system) + Ship atomically via Prisma nested create
6. Return `{ id, email, name }`
7. Client auto-signs in via `signIn("credentials", ...)` and redirects to `/dashboard`

### Route Protection

The `app/(game)/layout.tsx` is an async server component that:
1. Calls `auth()` to get the session
2. Redirects to `/login` if no session
3. Wraps children in `SessionProvider`

### API Route Auth

Game API routes use `getSessionPlayer()` from `lib/auth/get-player.ts` which:
1. Calls `auth()` to get the session
2. Looks up the Player by `userId` from the session
3. Returns the full player with ship, cargo, and system

### Environment Variables

```
AUTH_SECRET="dev-secret-change-in-production"
AUTH_URL="http://localhost:3000"
```
