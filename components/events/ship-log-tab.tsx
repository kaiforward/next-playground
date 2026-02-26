"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { NotificationEntityLinks } from "@/components/events/notification-entity-links";
import { useEventHistory } from "@/components/providers/event-history-provider";
import { NOTIFICATION_BADGE_COLOR } from "@/lib/constants/ui";
import { formatRelativeTime } from "@/lib/utils/format";

const SHIP_EVENT_TYPES = new Set([
  "ship_arrived",
  "cargo_lost",
  "hazard_incident",
  "import_duty",
  "contraband_seized",
]);

export function ShipLogTab() {
  const { notifications } = useEventHistory();

  const shipNotifications = useMemo(
    () => notifications.filter((n) => SHIP_EVENT_TYPES.has(n.type)),
    [notifications],
  );

  if (shipNotifications.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-text-muted">
        No ship events this session
      </div>
    );
  }

  return (
    <ul className="divide-y divide-white/5">
      {shipNotifications.map((n) => (
        <li key={n.id} className="px-4 py-2.5 flex items-start gap-3">
          {/* Timestamp */}
          <span className="text-[10px] text-text-faint mt-0.5 w-12 shrink-0 text-right tabular-nums">
            {formatRelativeTime(n.receivedAt)}
          </span>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Badge color={NOTIFICATION_BADGE_COLOR[n.type] ?? "slate"}>
                {n.type.replace(/_/g, " ")}
              </Badge>
            </div>
            <p className="text-xs text-gray-300 mt-0.5 leading-relaxed">{n.message}</p>
            <NotificationEntityLinks refs={n.refs} />
          </div>
        </li>
      ))}
    </ul>
  );
}
