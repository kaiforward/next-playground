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
            className="flex items-center justify-between py-2 px-3 bg-surface border-l-2 border-l-accent"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Badge color={EVENT_TYPE_BADGE_COLOR[event.type] ?? "slate"}>
                  {event.name}
                </Badge>
                {!compact && (
                  <span className="text-xs text-text-tertiary truncate">
                    {event.phaseDisplayName}
                  </span>
                )}
              </div>
              {!compact && event.effects && (
                <p className="text-xs text-text-secondary mt-1 truncate">
                  {event.effects}
                </p>
              )}
            </div>
            <span className="text-xs text-text-secondary whitespace-nowrap ml-2">
              {compact ? event.phaseDisplayName : `${event.ticksRemaining} ticks`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
