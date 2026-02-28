# Server-Side Filtering & Pagination — Implementation Plan

Design doc: `docs/design/planned/server-side-filtering.md`

## Scope

Infrastructure + Captain's Log only. Events/fleet pagination deferred until map viewport loading is designed.

---

## Phase 1: Shared Infrastructure

**Goal**: Reusable types, service helper, and hook that all paginated endpoints share.

### 1a. PaginatedResponse type

File: `lib/types/api.ts`

```typescript
/** Shared paginated response shape — all paginated endpoints return this. */
export interface PaginatedData<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
}
export type PaginatedResponse<T> = ApiResponse<PaginatedData<T>>;
```

Remove `NotificationsData` interface — replaced by `PaginatedData<PlayerNotificationInfo>`.
Update `NotificationsResponse` to `PaginatedResponse<PlayerNotificationInfo>`.

### 1b. Pagination service helper

New file: `lib/services/pagination.ts`

- `buildPaginatedArgs(params, baseWhere, defaultSort, defaultOrder)` — returns Prisma `findMany` args. Uses Prisma native cursor: `cursor: { id }, skip: 1`.
- `paginateResults<T>(rows, total, limit)` — slices `limit+1` rows, computes `nextCursor`, returns `PaginatedResult<T>`.

### 1c. usePaginatedQuery hook

New file: `lib/hooks/use-paginated-query.ts`

- Wraps `useInfiniteQuery` with 300ms search debounce
- Builds URL with `URLSearchParams`, serializes filters as repeated params
- Query key includes all filter params for correct deduplication

### 1d. LoadMoreFooter component

New file: `components/ui/load-more-footer.tsx`

Reusable "Load more" button + loading state for paginated panels.

### 1e. Notification API alignment

Refactor `getNotifications()` to use `buildPaginatedArgs`, return `PaginatedResult`, add `search` param and `total` count.

Update API route response from `{ notifications, nextCursor }` → `{ items, nextCursor, total }`.

Update `useNotifications()` to read `.items` instead of `.notifications`.

### 1f. Tests

New file: `lib/services/__tests__/pagination.test.ts`

Test `buildPaginatedArgs` and `paginateResults`.

### Files touched
- **New**: `lib/services/pagination.ts`, `lib/hooks/use-paginated-query.ts`, `lib/services/__tests__/pagination.test.ts`, `components/ui/load-more-footer.tsx`
- **Modified**: `lib/types/api.ts`, `lib/services/notifications.ts`, `app/api/game/notifications/route.ts`, `lib/hooks/use-notifications.ts`

---

## Phase 2: Captain's Log Migration

**Goal**: Replace the bespoke `useLog` hook with `usePaginatedQuery`, add search support.

### 2a. Delete useLog

File: `lib/hooks/use-log.ts` — Delete this file.

### 2b. Update Log Panel

File: `app/(game)/@panel/log/page.tsx`

- Replace `useLog` with `usePaginatedQuery<PlayerNotificationInfo>`
- Use `useFilterState` + `FilterBar` (with search input) + `LoadMoreFooter`
- `resultCount` wired to `{ shown: items.length, total }`

### Files touched
- **Deleted**: `lib/hooks/use-log.ts`
- **Modified**: `app/(game)/@panel/log/page.tsx`

---

## Verification

1. `npx vitest run` — pagination helper tests pass, existing tests unbroken
2. `npm run dev` — bell feed shows notifications (new response shape), Captain's Log has search + FilterBar + "Load more"
3. `npm run build` — no type errors
