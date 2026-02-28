"use client";

import { useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiMutate } from "@/lib/query/fetcher";
import { queryKeys } from "@/lib/query/keys";
import type { PaginatedData } from "@/lib/types/api";
import type { PlayerNotificationInfo } from "@/lib/types/game";

export function useNotifications() {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.notifications,
    queryFn: () => apiFetch<PaginatedData<PlayerNotificationInfo>>("/api/game/notifications?limit=20"),
  });

  return { notifications: data.items, nextCursor: data.nextCursor };
}

export function useUnreadCount() {
  const { data } = useSuspenseQuery({
    queryKey: queryKeys.unreadCount,
    queryFn: () => apiFetch<{ count: number }>("/api/game/notifications/unread"),
  });

  return data.count;
}

export function useMarkAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (beforeId?: string) =>
      apiMutate<{ marked: number }>("/api/game/notifications/read", beforeId ? { beforeId } : {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.unreadCount });
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications });
    },
  });
}
