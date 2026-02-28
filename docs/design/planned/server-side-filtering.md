# Server-Side Filtering & Pagination

## Problem

Several entity collections will grow beyond what's practical to fetch in a single API response:

| Collection | Current size | Future size | Current approach |
|-----------|-------------|-------------|-----------------|
| Star systems | ~600 | 5,000–10,000 | Fetch all (universe endpoint) |
| Notifications | Unbounded (pruned at 500 ticks) | Same | Cursor-paginated (already done) |
| Events | ~10–30 active | ~50–100 | Fetch all |
| Ships | 1–5 per player | 50–100+ | Fetch all (fleet endpoint) |
| Battles | 0–3 active | 10–20+ | Fetch all |
| Trade missions | ~5–20 per system | Same but more systems | Fetch per-system |
| Player facilities | 0 (not built) | 20–50+ | N/A |

The FilterBar component (from Workstream C) provides the right UI — chips, search, sort, result count. But it currently drives client-side `useMemo` filtering against fully-loaded datasets. As collections grow, this needs to move server-side.

## Goals

1. Establish a **shared pagination/filtering API contract** that all paginated endpoints follow
2. Create a **reusable hook pattern** that connects FilterBar to server-side queries
3. **Migrate existing endpoints** incrementally (notifications already done, others as needed)
4. Build the **Systems screen** as the first "born paginated" entity list
5. Maintain **real-time feel** — SSE invalidation still works with partial data

## Non-Goals

- Virtual scroll / windowed rendering (separate concern, can layer on later)
- Full-text search engine (Prisma + SQLite LIKE is sufficient for our scale)
- URL-persisted filter state (keep it simple, local state is fine)

---

## API Contract

### Query Parameters

All paginated endpoints accept the same parameter shape:

```
GET /api/game/{entity}?cursor={id}&limit={n}&search={term}&sort={field}&order={asc|desc}&filters={json}
```

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `cursor` | string | (none) | ID of last item from previous page |
| `limit` | number | 30 | Page size (max 100) |
| `search` | string | (none) | Free-text search against name/message fields |
| `sort` | string | varies | Sort field (entity-specific) |
| `order` | "asc" \| "desc" | "desc" | Sort direction |
| `filters` | string | (none) | JSON-encoded filter object (entity-specific) |

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

The `total` field enables FilterBar's result count display without a separate count query — SQLite can compute `COUNT(*) OVER()` in the same query via a window function, or we run a parallel count.

### Existing Alignment

The notifications API (`GET /api/game/notifications`) already follows this pattern with `cursor`, `limit`, and `types` params. The response shape uses `{ notifications, nextCursor }` — this would align to `{ items, nextCursor, total }`.

---

## Client-Side Architecture

### usePaginatedQuery Hook

A generic hook that wraps `useInfiniteQuery` and connects to FilterBar state:

```typescript
interface UsePaginatedQueryOptions<TItem, TFilters> {
  queryKey: readonly unknown[];
  endpoint: string;
  filters?: TFilters;
  search?: string;
  sort?: string;
  order?: "asc" | "desc";
  limit?: number;
}

function usePaginatedQuery<TItem, TFilters>(
  opts: UsePaginatedQueryOptions<TItem, TFilters>
) => {
  items: TItem[];
  total: number;
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isLoading: boolean;
}
```

This replaces entity-specific hooks like `useLog` with a generic pattern. FilterBar state drives the query params; changing a filter resets pagination.

### FilterBar Integration

FilterBar remains a pure UI component. The connection point is the page component:

```typescript
// Page component wires FilterBar state → query params
const { activeChips, searchValue, activeSort } = useFilterState();
const { items, total, fetchNextPage, hasNextPage } = usePaginatedQuery({
  queryKey: ["systems", activeChips, searchValue, activeSort],
  endpoint: "/api/game/systems",
  search: searchValue,
  sort: activeSort,
  filters: { economyType: activeChips },
});
```

### SSE Invalidation with Partial Data

When SSE signals a change (e.g., `shipArrived`), the current page of data is invalidated. TanStack Query refetches the visible pages. This means:

- The user sees updates to items currently on screen
- New items that would appear on a different page aren't visible until the user scrolls/paginates
- This is acceptable UX — the bell notification tells them something happened, they can refresh or navigate

For the fleet specifically, we may want to keep fetching all ships for the dashboard summary (ship count, total cargo) via a lightweight `/api/game/fleet/summary` endpoint, while the fleet panel uses the paginated list.

---

## Migration Plan

### Phase 1: Shared Infrastructure

- `PaginatedResponse<T>` type in `lib/types/api.ts`
- `buildPaginatedQuery` helper in `lib/services/` (Prisma cursor + where + orderBy builder)
- `usePaginatedQuery` hook in `lib/hooks/`
- Align notifications API response shape to new contract

### Phase 2: Systems Screen (New)

The first entity list built on the new pattern:

- `GET /api/game/systems` — paginated, searchable by name, filterable by economy type / region / government
- `app/(game)/@panel/systems/page.tsx` — FilterBar + paginated list
- Sidebar nav item added
- Sort by: name, economy type, region
- Search: system name (LIKE query)

### Phase 3: Captain's Log Migration

- Align `GET /api/game/notifications` response to `PaginatedResponse`
- Replace `useLog` with `usePaginatedQuery`
- Add server-side type filtering (already supported) and search

### Phase 4: Fleet Pagination

- New `GET /api/game/fleet/ships` — paginated ship list with search/filter/sort
- Keep existing `GET /api/game/fleet` for summary data (credits, ship count)
- Replace fleet panel's client-side filtering with server-side
- Dashboard uses summary endpoint

### Phase 5: Events & Battles

- `GET /api/game/events` gains pagination + filter params
- `GET /api/game/battles` gains pagination
- Panel pages migrate from `useSuspenseQuery` → `usePaginatedQuery`

---

## Entity-Specific Filter Schemas

### Systems
- `economyType`: EconomyType[] — chip filter
- `region`: string[] — region name filter
- `government`: GovernmentType[] — government filter
- `search`: string — system name search
- Sort: name, economyType, region

### Ships (Fleet)
- `status`: ("docked" | "in_transit" | "disabled")[] — chip filter
- `search`: string — ship name search
- Sort: name, shipType, location (system name)

### Events
- `category`: string[] — mapped from event type to category
- Sort: severity, ticksRemaining, systemName

### Notifications (Captain's Log)
- `types`: NotificationType[] — chip filter
- `search`: string — message text search
- Sort: createdAt (always desc)

---

## SQLite Considerations

- **LIKE queries**: SQLite LIKE is case-insensitive for ASCII by default. For system/ship name search, `WHERE name LIKE '%term%'` is sufficient. No need for full-text search at our scale.
- **Cursor pagination**: Use `createdAt` + `id` for stable cursor ordering (avoids issues with non-unique sort fields). For systems, use `name` + `id` since systems don't have timestamps.
- **COUNT with pagination**: Run `COUNT(*)` as a separate query rather than window functions — SQLite's query planner handles this better for our use case.
- **Indexes**: Existing indexes cover most filter patterns. May need to add:
  - `StarSystem(name)` for name search
  - `Ship(playerId, status)` for fleet filtering
  - `PlayerNotification(playerId, type)` for type filtering

---

## Open Questions

1. **Universe endpoint**: Currently returns all systems + connections + regions for the map renderer. The map needs all data. Should the systems *screen* use a separate paginated endpoint, or should the screen reuse the universe cache and filter client-side (since the data is already loaded for the map)?
   - **Leaning toward**: Reuse universe cache for now (data is already on client for map). Add server-side pagination only when system count exceeds what the map loads (>5K).

2. **Fleet summary vs full list**: When fleet is paginated, the dashboard still needs total credits and ship count. Separate summary endpoint, or include summary in paginated response metadata?
   - **Leaning toward**: Separate lightweight `/api/game/fleet/summary` endpoint.

3. **Debounce search**: Should `usePaginatedQuery` debounce the search param to avoid hammering the API on every keystroke?
   - **Leaning toward**: Yes, 300ms debounce in the hook.
