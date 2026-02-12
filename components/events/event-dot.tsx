"use client";

import { tv } from "tailwind-variants";
import { EVENT_TYPE_BADGE_COLOR } from "@/lib/constants/ui";

const dot = tv({
  base: "w-2.5 h-2.5 rounded-full ring-1 ring-gray-900",
  variants: {
    color: {
      red: "bg-red-500",
      amber: "bg-amber-500",
      purple: "bg-purple-500",
    },
  },
});

interface EventDotProps {
  eventType: string;
}

type DotColor = "red" | "amber" | "purple";

const DOT_COLOR_MAP: Record<string, DotColor> = {
  red: "red",
  amber: "amber",
};

function toDotColor(badgeColor: string): DotColor {
  return DOT_COLOR_MAP[badgeColor] ?? "purple";
}

export function EventDot({ eventType }: EventDotProps) {
  const color = toDotColor(EVENT_TYPE_BADGE_COLOR[eventType]);
  return <div className={dot({ color })} title={eventType} />;
}
