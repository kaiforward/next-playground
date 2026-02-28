"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { NotificationsData } from "@/lib/types/api";

const PAGE_SIZE = 30;

interface UseLogOptions {
  types?: string[];
}

export function useLog(opts: UseLogOptions = {}) {
  const typesParam = opts.types && opts.types.length > 0 ? `&types=${opts.types.join(",")}` : "";

  return useInfiniteQuery({
    queryKey: [...queryKeys.notifications, "log", opts.types ?? "all"],
    queryFn: ({ pageParam }) => {
      const cursorParam = pageParam ? `&cursor=${pageParam}` : "";
      return apiFetch<NotificationsData>(
        `/api/game/notifications?limit=${PAGE_SIZE}${typesParam}${cursorParam}`,
      );
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}
