"use client";

import Link from "next/link";
import * as Popover from "@radix-ui/react-popover";
import { useNotifications, useUnreadCount, useMarkAsRead } from "@/lib/hooks/use-notifications";
import { LogEntry } from "@/components/notifications/log-entry";
import { QueryBoundary } from "@/components/ui/query-boundary";

function BellIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4.5 h-4.5 shrink-0">
      <path fillRule="evenodd" d="M10 2a6 6 0 0 0-6 6c0 1.887-.454 3.665-1.257 5.234a.75.75 0 0 0 .67 1.085h3.652a2.75 2.75 0 0 0 5.47 0h3.652a.75.75 0 0 0 .67-1.085A11.95 11.95 0 0 1 16 8a6 6 0 0 0-6-6Zm1.493 12.319a1.25 1.25 0 0 1-2.986 0h2.986Z" clipRule="evenodd" />
    </svg>
  );
}

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
      <div className={`flex items-center px-3 py-2 ${collapsed ? "justify-center" : "gap-3"}`}>
        <Popover.Trigger asChild>
          <button
            className="relative text-text-secondary hover:text-text-primary transition-colors"
            aria-label="Notifications"
          >
            <BellIcon />
            <QueryBoundary loadingFallback={null} errorFallback={() => null}>
              <UnreadBadge />
            </QueryBoundary>
          </button>
        </Popover.Trigger>
        {!collapsed && (
          <Popover.Trigger asChild>
            <button className="text-sm text-text-secondary hover:text-text-primary transition-colors">
              Notifications
            </button>
          </Popover.Trigger>
        )}
      </div>

      <Popover.Portal>
        <Popover.Content
          side="right"
          align="start"
          sideOffset={8}
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
