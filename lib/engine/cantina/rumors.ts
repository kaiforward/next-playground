import type { ActiveEvent } from "@/lib/types/game";
import { RUMOR_TEMPLATES, NO_RUMORS_LINES } from "@/lib/constants/cantina-npcs";

export interface PatronRumor {
  text: string;
  eventId: string;
  eventType: string;
  systemName: string | null;
}

/**
 * Generate thematic rumors from active events.
 * Returns up to 3 rumors, one per event, using event-type-specific templates.
 * Pure function — no DB.
 */
export function generateRumors(events: ActiveEvent[]): PatronRumor[] {
  if (events.length === 0) {
    return [
      {
        text: NO_RUMORS_LINES[
          Math.floor(Math.random() * NO_RUMORS_LINES.length)
        ],
        eventId: "",
        eventType: "",
        systemName: null,
      },
    ];
  }

  // Take up to 3 events, preferring the most severe
  const sorted = [...events].sort((a, b) => b.severity - a.severity);
  const selected = sorted.slice(0, 3);

  return selected.map((event) => {
    const templates = RUMOR_TEMPLATES[event.type] ?? [
      "Something's going on at {system}. Can't get the details.",
    ];
    const template = templates[Math.floor(Math.random() * templates.length)];
    const systemLabel = event.systemName ?? "an unknown system";

    return {
      text: template.replace("{system}", systemLabel),
      eventId: event.id,
      eventType: event.type,
      systemName: event.systemName,
    };
  });
}
