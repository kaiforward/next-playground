"use client";

import { NotificationEntityLinks } from "@/components/events/notification-entity-links";
import { NOTIFICATION_BADGE_COLOR } from "@/lib/constants/ui";
import { formatRelativeTime } from "@/lib/utils/format";
import type { PlayerNotificationInfo } from "@/lib/types/game";

const COLOR_CLASSES: Record<string, string> = {
  red: "bg-red-500",
  amber: "bg-amber-500",
  purple: "bg-purple-500",
  green: "bg-green-500",
  blue: "bg-blue-500",
  slate: "bg-slate-500",
  cyan: "bg-cyan-500",
};

interface LogEntryProps {
  notification: PlayerNotificationInfo;
  compact?: boolean;
}

export function LogEntry({ notification, compact }: LogEntryProps) {
  const color = NOTIFICATION_BADGE_COLOR[notification.type] ?? "slate";
  const dotClass = COLOR_CLASSES[color] ?? COLOR_CLASSES.slate;

  return (
    <div className={`flex gap-2.5 px-3 ${compact ? "py-2" : "py-2.5"} ${!notification.read ? "bg-surface-hover/40" : ""}`}>
      <div className="pt-1.5 shrink-0">
        <div className={`h-2 w-2 rounded-full ${dotClass}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-text-primary leading-snug ${compact ? "text-xs" : "text-sm"}`}>
          {notification.message}
        </p>
        <NotificationEntityLinks refs={notification.refs} />
        <div className={`flex items-center gap-2 mt-1 text-text-muted ${compact ? "text-[10px]" : "text-xs"}`}>
          <span>Tick {notification.tick}</span>
          <span>&middot;</span>
          <span>{formatRelativeTime(new Date(notification.createdAt).getTime())}</span>
        </div>
      </div>
    </div>
  );
}
