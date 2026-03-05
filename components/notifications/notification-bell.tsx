"use client";

import Link from "next/link";
import * as Popover from "@radix-ui/react-popover";
import { Bell } from "lucide-react";
import { useNotifications, useUnreadCount, useMarkAsRead } from "@/lib/hooks/use-notifications";
import { LogEntry } from "@/components/notifications/log-entry";
import { QueryBoundary } from "@/components/ui/query-boundary";

function UnreadBadge() {
  const count = useUnreadCount();
  if (count === 0) return null;

  return (
    <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold leading-none text-white bg-red-500 rounded-full">
      {count > 99 ? "99+" : count}
    </span>
  );
}

function NotificationList({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const { notifications } = useNotifications();
  const markAsRead = useMarkAsRead();

  const handleMarkAllRead = () => {
    if (notifications.length > 0) {
      markAsRead.mutate(notifications[0].id);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <h3 className="text-xs font-display font-semibold uppercase tracking-widest text-text-muted">
          Notifications
        </h3>
        {notifications.length > 0 && (
          <button
            onClick={handleMarkAllRead}
            className="text-[11px] text-accent hover:text-accent/80 transition-colors"
          >
            Mark all read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-text-muted">
          No notifications yet.
        </div>
      ) : (
        <div className="max-h-80 overflow-y-auto divide-y divide-border">
          {notifications.map((n) => (
            <LogEntry key={n.id} notification={n} compact />
          ))}
        </div>
      )}

      <div className="border-t border-border px-3 py-2">
        <Link
          href="/log"
          onClick={() => onOpenChange(false)}
          className="text-[11px] text-accent hover:text-accent/80 transition-colors"
        >
          View Captain&apos;s Log
        </Link>
      </div>
    </div>
  );
}

interface NotificationBellProps {
  collapsed: boolean;
}

export function NotificationBell({ collapsed }: NotificationBellProps) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          className={`flex items-center w-full px-3 py-2 text-text-secondary hover:text-text-primary transition-colors ${collapsed ? "justify-center" : "gap-3"}`}
          aria-label="Notifications"
        >
          <span className="relative">
            <Bell className="w-4.5 h-4.5 shrink-0" />
            <QueryBoundary loadingFallback={null} errorFallback={() => null}>
              <UnreadBadge />
            </QueryBoundary>
          </span>
          {!collapsed && (
            <span className="text-sm">Notifications</span>
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={8}
          alignOffset={4}
          className="w-80 bg-surface border border-border rounded-lg shadow-lg z-50 overflow-hidden"
        >
          <QueryBoundary
            loadingFallback={
              <div className="px-3 py-6 text-center text-xs text-text-muted">Loading...</div>
            }
          >
            <NotificationList onOpenChange={() => {}} />
          </QueryBoundary>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
