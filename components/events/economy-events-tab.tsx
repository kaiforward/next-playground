"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EventIcon } from "@/components/events/event-icon";
import { useEvents } from "@/lib/hooks/use-events";
import { EVENT_TYPE_BADGE_COLOR, EVENT_TYPE_DANGER_PRIORITY } from "@/lib/constants/ui";

export function EconomyEventsTab() {
  const { events, loading } = useEvents();

  const sorted = [...events].sort((a, b) => {
    const pa = EVENT_TYPE_DANGER_PRIORITY[a.type] ?? 0;
    const pb = EVENT_TYPE_DANGER_PRIORITY[b.type] ?? 0;
    return pb - pa;
  });

  if (loading) {
    return (
      <div className="px-4 py-8 text-center text-sm text-white/40">
        Loading events...
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-white/40">
        No active events
      </div>
    );
  }

  return (
    <ul className="divide-y divide-white/5">
      {sorted.map((event) => {
        const color = EVENT_TYPE_BADGE_COLOR[event.type] ?? "slate";
        return (
          <li key={event.id} className="px-4 py-3 flex items-start gap-3">
            {/* Icon container */}
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${ICON_BG[color]}`}>
              <EventIcon eventType={event.type} className="w-4.5 h-4.5 text-white" />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-white truncate">{event.name}</span>
                <Badge color={color}>{event.phaseDisplayName}</Badge>
              </div>

              {event.systemName && event.systemId && (
                <Link
                  href={`/system/${event.systemId}`}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  {event.systemName}
                </Link>
              )}

              <div className="flex items-center gap-3 mt-0.5 text-[11px] text-white/40">
                <span>{event.ticksRemaining} ticks remaining</span>
                <span>Severity {event.severity.toFixed(1)}</span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const ICON_BG: Record<string, string> = {
  red: "bg-red-600/30",
  amber: "bg-amber-600/30",
  purple: "bg-purple-600/30",
  green: "bg-green-600/30",
  blue: "bg-blue-600/30",
  slate: "bg-slate-600/30",
};
