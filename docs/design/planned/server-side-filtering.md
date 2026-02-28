# Server-Side Filtering & Pagination

## Problem

Several entity collections will grow beyond what's practical to fetch in a single API response:

| Collection | Current size | Future size | Current approach |
|-----------|-------------|-------------|-----------------|
| Notifications | Unbounded (pruned at 500 ticks) | Same | Cursor-paginated (already done) |
| Events | ~10–30 active | 100+ (with 10K systems) | Fetch all |
| Ships | 1–5 per player | 50–100+ | Fetch all (fleet endpoint) |
| Trade missions | ~5–20 per system | Same but more systems | Fetch per-system |
| Player facilities | 0 (not built) | 20–50+ | N/A |

**Out of scope**: Star systems (5K–10K) are already loaded client-side for the map renderer. The systems screen will reuse that universe cache and filter client-side. Map scalability (culling, chunking) is a separate PR.

**Out of scope**: Battles. Even at scale, active battles per player rarely exceed 10–20. Client-side filtering is sufficient.

The FilterBar component provides the right UI — chips, search, sort, result count. It currently drives client-side `useMemo` filtering against fully-loaded datasets. As collections grow, some screens need to move filtering server-side while others stay client-only.

## Scope

**Phase 1–2 (this PR)**: Infrastructure (`PaginatedData<T>`, `usePaginatedQuery`, pagination service helpers) + Captain's Log migration (the only panel with data NOT loaded by the map).

**Deferred**: Events panel pagination, fleet panel pagination, fleet summary endpoint. Events and fleet data is loaded by the map (`useEvents()`, `useFleet()`); the panels reuse the TanStack Query cache. Adding server-side pagination to panels while the map still loads everything yields zero savings. These become useful when the map switches to viewport-based loading (a separate, larger architectural change).

## Goals

1. Establish a **shared pagination/filtering API contract** that all paginated endpoints follow
2. Create a **reusable hook pattern** (`usePaginatedQuery`) that connects FilterBar to server-side queries
3. **Migrate Captain's Log** — notifications first (already partially done)
4. **FilterBar works both ways** — same component drives client-side `useMemo` or server-side queries depending on page wiring
5. Maintain **real-time feel** — SSE invalidation still works with partial data

## Non-Goals

- Page-number navigation or prev/next controls — "pagination" in this doc means cursor-based "load more" (30 items initial, append next batch on demand)
- Virtual scroll / windowed rendering (separate concern, can layer on top later without changing data fetching)
- Full-text search engine (Prisma + SQLite LIKE is sufficient for our scale)
- URL-persisted filter state (keep it simple, local state is fine)
- Systems screen server-side filtering (reuses universe cache)
- Battles server-side filtering (stays client-side)
- Events/fleet server-side pagination (deferred — see Scope)

---

## API Contract

### Query Parameters

All paginated endpoints accept flat query parameters (no JSON-encoded filter objects):

```
GET /api/game/{entity}?cursor={id}&limit={n}&search={term}&sort={field}&order={asc|desc}&status=docked&status=in_transit
```

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `cursor` | string | (none) | ID of last item from previous page |
| `limit` | number | 30 | Page size (max 100) |
| `search` | string | (none) | Free-text search against name/message fields |
| `sort` | string | varies | Sort field (entity-specific) |
| `order` | "asc" \| "desc" | "desc" | Sort direction |
| *(entity-specific)* | string/string[] | (none) | Flat filter params (e.g., `status`, `type`, `category`) |

Entity-specific filters use repeated query params (e.g., `?status=docked&status=in_transit`) rather than JSON encoding. This is simpler to construct, debug, and cache.

### Response Shape

```typescript
interface PaginatedResponse<T> {
  data?: {
    items: T[];
    nextCursor: string | null;
    total: number;  // Total matching count (for "X of Y" display)
  };
  error?: string;
}
```

The `total` field enables FilterBar's result count display. Run `COUNT(*)` as a separate query alongside the paginated fetch — SQLite handles this well and it avoids window function complexity.

### Existing Alignment

The notifications API (`GET /api/game/notifications`) already follows this pattern with `cursor`, `limit`, and `types` params. The response shape uses `{ notifications, nextCursor }` — this aligns to `{ items, nextCursor, total }` with minor reshaping.

---

## Client-Side Architecture

### FilterBar: Dual-Mode Design

FilterBar is already a pure UI component — it renders chips, search, sort, and result count based on props. The **page component** decides the data source:

**Client-side mode** (current — used by systems, battles, convoys, events, fleet):
```typescript
const { activeChips, searchValue, activeSort } = useFilterState();
const allItems = useEvents(); // or universe cache, fleet, etc.
const filtered = useMemo(() => filterAndSort(allItems, activeChips, searchValue, activeSort), [...]);
// Pass filtered to FilterBar's resultCount and render list
```

**Server-side mode** (new — used by notifications / Captain's Log):
```typescript
const { activeChips, searchValue, activeSort } = useFilterState();
const { items, total, fetchNextPage, hasNextPage } = usePaginatedQuery({
  queryKey: queryKeys.notifications,
  endpoint: "/api/game/notifications",
  search: searchValue,
  filters: { types: activeChips },
});
// Pass items to render list, total to FilterBar's resultCount
```

No FilterBar changes needed. The hook (`useFilterState`) stays the same. Only the data plumbing differs.

### usePaginatedQuery Hook

A generic hook that wraps `useInfiniteQuery` with 300ms search debounce:

```typescript
interface UsePaginatedQueryOptions<TFilters> {
  queryKey: readonly unknown[];
  endpoint: string;
  filters?: TFilters;
  search?: string;
  sort?: string;
  order?: "asc" | "desc";
  limit?: number;
}

function usePaginatedQuery<TItem, TFilters>(
  opts: UsePaginatedQueryOptions<TFilters>
) => {
  items: TItem[];        // Flattened from all loaded pages
  total: number;         // From first page's response
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isLoading: boolean;
}
```

Behavior:
- Search input is debounced 300ms before triggering a query
- Changing any filter/search/sort resets pagination (clears cursor)
- Uses `useInfiniteQuery` (non-Suspense) with its own loading/error states
- Query key includes all filter params so TanStack Query deduplicates correctly

### SSE Invalidation with Partial Data

When SSE signals a change, the current page of data is invalidated. TanStack Query refetches the visible pages. This means:

- The user sees updates to items currently on screen
- New items that would appear on a different page aren't visible until the user scrolls/paginates
- This is acceptable UX — the bell notification tells them something happened, they can refresh or navigate

---

## Migration Plan

### Phase 1: Shared Infrastructure

- `PaginatedData<T>` / `PaginatedResponse<T>` types in `lib/types/api.ts`
- `buildPaginatedArgs` + `paginateResults` helpers in `lib/services/pagination.ts`
- `usePaginatedQuery` hook in `lib/hooks/use-paginated-query.ts` (wraps `useInfiniteQuery`, 300ms search debounce)
- Notification API aligned to `PaginatedResponse` shape
- Unit tests for pagination helpers

### Phase 2: Captain's Log Migration

First migration — notifications already have cursor pagination, this aligns the response shape and replaces the bespoke `useLog` hook:

- Align `GET /api/game/notifications` response to `PaginatedResponse` shape (`items` + `total`)
- Add `search` param (message text LIKE query)
- Replace `useLog` with `usePaginatedQuery` in Captain's Log panel
- Log panel uses FilterBar + search input + LoadMoreFooter

---

## Deferred: Events & Fleet Pagination

Events and fleet data is currently loaded by the map renderer (`useEvents()`, `useFleet()`). The panels simply reuse the TanStack Query cache — they don't make separate API calls. Adding server-side pagination to panels while the map still loads everything yields zero network savings.

These migrations become valuable when the map switches to viewport-based loading (loading only visible systems/events). That's a separate architectural change that involves:
- Map tile/viewport-based data loading
- Separating "map data" from "panel data" queries
- Then: events panel and fleet panel can independently paginate

### When to revisit
- When map viewport-based loading is designed and planned
- When event count consistently exceeds 100+ (10K systems milestone)
- When fleet size exceeds 50+ ships per player

---

## Entity-Specific Filter Schemas

### Notifications (Captain's Log) — Implemented
- `types`: NotificationType[] — chip filter (repeated query param: `?types=ship_arrived&types=battle_won`)
- `search`: string — message text search (LIKE)
- Sort: createdAt (always desc)

### Events — Deferred
- `category`: string[] — mapped from event type to category
- `search`: string — event name or system name
- Sort: severity (default), ticksRemaining, systemName

### Ships (Fleet) — Deferred
- `status`: ("docked" | "in_transit" | "disabled")[] — chip filter
- `search`: string — ship name search
- Sort: name (default), shipType, location

---

## SQLite Considerations

- **LIKE queries**: SQLite LIKE is case-insensitive for ASCII by default. For message search, `WHERE message LIKE '%term%'` is sufficient. No need for full-text search at our scale.
- **Cursor pagination**: Use Prisma native cursor (`cursor: { id }, skip: 1`) for stable ordering.
- **COUNT with pagination**: Run `COUNT(*)` as a separate query alongside the paginated fetch. SQLite handles simple counts efficiently.

---

## Decisions (Resolved)

1. **Systems screen**: Reuses universe cache (already loaded for map), filters client-side. Map scalability is a separate PR.

2. **Battles**: Stay client-side filtered. Active battles per player are capped low even at scale.

3. **Search debounce**: 300ms debounce in `usePaginatedQuery` hook.

4. **Query params**: Flat params with repeated keys for arrays (e.g., `?types=a&types=b`), not JSON-encoded filter objects.

5. **Total count**: Separate `COUNT(*)` query, not window functions.

6. **Events/fleet deferred**: Server-side pagination for these panels blocked on map viewport loading. Infrastructure built now, migration later.
