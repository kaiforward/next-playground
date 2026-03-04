"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { BartenderData } from "@/lib/types/cantina";

interface BartenderPanelProps {
  data: BartenderData;
}

export function BartenderPanel({ data }: BartenderPanelProps) {
  const { greeting, tips } = data;

  return (
    <Card variant="bordered" padding="md">
      <div className="flex items-start gap-3 mb-4">
        <span className="text-3xl leading-none" aria-hidden>
          &#x1F943;
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-text-primary">Bartender</span>
            <Badge color="green">Tips</Badge>
          </div>
          <p className="text-sm text-text-muted italic mt-1">
            &ldquo;{greeting}&rdquo;
          </p>
        </div>
      </div>

      {tips.length > 0 && (
        <ul className="space-y-2">
          {tips.map((tip, i) => (
            <li
              key={`${tip.goodId}-${i}`}
              className="text-sm text-text-secondary pl-4 border-l-2 border-amber-500/30"
            >
              {tip.text}
              {tip.type === "neighbor" && tip.systemName && (
                <Badge color="blue" className="ml-2">
                  {tip.systemName}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
