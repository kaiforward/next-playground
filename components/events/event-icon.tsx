import { TriangleAlert } from "lucide-react";
import { EVENT_TYPE_ICON } from "@/lib/constants/ui";
import { isEventTypeId } from "@/lib/types/guards";

interface EventIconProps {
  eventType: string;
  className?: string;
}

/** Lucide icon for a given event type. Falls back to warning triangle. */
export function EventIcon({ eventType, className = "w-4 h-4" }: EventIconProps) {
  const Icon = isEventTypeId(eventType) ? EVENT_TYPE_ICON[eventType] : TriangleAlert;
  return <Icon className={className} />;
}
