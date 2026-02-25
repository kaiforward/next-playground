"use client";

import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/ui/section-header";
import { EVENT_TYPE_BADGE_COLOR } from "@/lib/constants/ui";
import type { ActiveEvent } from "@/lib/types/game";

interface ActiveEventsSectionProps {
  events: ActiveEvent[];
  compact?: boolean;
}

export function ActiveEventsSection({ events, compact }: ActiveEventsSectionProps) {
  if (events.length === 0) return null;

  return (
    <div>
      <SectionHeader className="mb-2">Active Events</SectionHeader>
      <ul className="space-y-2" aria-live="polite">
        {events.map((event) => (
          <li
            key={event.id}
            className="flex items-center justify-between py-2 px-3 rounded-lg bg-white/5"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Badge color={EVENT_TYPE_BADGE_COLOR[event.type] ?? "slate"}>
                {event.name}
              </Badge>
              {!compact && (
                <span className="text-xs text-white/50 truncate">
                  {event.phaseDisplayName}
                </span>
              )}
            </div>
            <span className="text-xs text-white/40 whitespace-nowrap ml-2">
              {compact ? event.phaseDisplayName : `${event.ticksRemaining} ticks`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
