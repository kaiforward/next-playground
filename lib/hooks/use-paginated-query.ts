"use client";

import { useMemo, useState, useEffect } from "react";
import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import type { PaginatedData } from "@/lib/types/api";

const DEBOUNCE_MS = 300;
const DEFAULT_LIMIT = 30;

/** Values that can be serialized to URL query params. */
type FilterValue = string | number | boolean | null | undefined | string[];

interface UsePaginatedQueryOptions<TFilters extends Record<string, FilterValue>> {
  queryKey: readonly unknown[];
  endpoint: string;
  filters?: TFilters;
  search?: string;
  sort?: string;
  order?: "asc" | "desc";
  limit?: number;
  enabled?: boolean;
}

interface UsePaginatedQueryResult<TItem> {
  items: TItem[];
  total: number;
  fetchNextPage: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
}

/**
 * Generic paginated query hook wrapping `useInfiniteQuery`.
 *
 * - Debounces search input by 300ms before triggering a query
 * - Serializes filters as repeated query params (?types=a&types=b)
 * - Changing any filter/search/sort resets pagination automatically
 * - Returns flattened items from all loaded pages
 */
export function usePaginatedQuery<
  TItem,
  TFilters extends Record<string, FilterValue> = Record<string, never>,
>(opts: UsePaginatedQueryOptions<TFilters>): UsePaginatedQueryResult<TItem> {
  const limit = opts.limit ?? DEFAULT_LIMIT;

  // ── Search debounce ──────────────────────────────────────────
  const [debouncedSearch, setDebouncedSearch] = useState(opts.search ?? "");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(opts.search ?? "");
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [opts.search]);

  // ── Query key includes all filter state ──────────────────────
  const queryKey = useMemo(
    () => [...opts.queryKey, "paginated", debouncedSearch, opts.sort, opts.order, opts.filters],
    [opts.queryKey, debouncedSearch, opts.sort, opts.order, opts.filters],
  );

  // ── Build URL with query params ──────────────────────────────
  const buildUrl = (cursor?: string) => {
    const params = new URLSearchParams();
    params.set("limit", String(limit));

    if (debouncedSearch) params.set("search", debouncedSearch);
    if (opts.sort) params.set("sort", opts.sort);
    if (opts.order) params.set("order", opts.order);
    if (cursor) params.set("cursor", cursor);

    // Serialize filters as repeated params
    if (opts.filters) {
      for (const [key, value] of Object.entries(opts.filters)) {
        if (Array.isArray(value)) {
          for (const v of value) {
            if (v != null) params.append(key, String(v));
          }
        } else if (value != null) {
          params.set(key, String(value));
        }
      }
    }

    return `${opts.endpoint}?${params.toString()}`;
  };

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
  } = useInfiniteQuery<
    PaginatedData<TItem>,
    Error,
    InfiniteData<PaginatedData<TItem>, string | undefined>,
    readonly unknown[],
    string | undefined
  >({
    queryKey,
    queryFn: ({ pageParam }) =>
      apiFetch<PaginatedData<TItem>>(buildUrl(pageParam)),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: opts.enabled,
  });

  // ── Flatten pages into a single list ─────────────────────────
  const items = useMemo(
    () => data?.pages.flatMap((p) => p.items) ?? [],
    [data],
  );

  const total = data?.pages[0]?.total ?? 0;

  return {
    items,
    total,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error: error instanceof Error ? error : error ? new Error(String(error)) : null,
  };
}
