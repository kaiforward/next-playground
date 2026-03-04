"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { NpcArchetype } from "@/lib/engine/mini-games/voids-gambit";
import { NPC_FLAVOR } from "@/lib/engine/mini-games/voids-gambit";
import type { PatronRumor } from "@/lib/engine/cantina/rumors";
import type { BadgeColor } from "@/components/ui/badge";

const ARCHETYPE_DISPLAY: Record<
  NpcArchetype,
  { label: string; icon: string; badgeColor: BadgeColor }
> = {
  cautious_trader: { label: "Cautious Trader", icon: "\uD83E\uDDD1\u200D\uD83D\uDCBC", badgeColor: "green" },
  frontier_gambler: { label: "Frontier Gambler", icon: "\uD83C\uDFB2", badgeColor: "amber" },
  sharp_smuggler: { label: "Sharp Smuggler", icon: "\uD83D\uDD75\uFE0F", badgeColor: "purple" },
  station_regular: { label: "Station Regular", icon: "\uD83C\uDF7A", badgeColor: "red" },
};

interface PatronCardProps {
  archetype: NpcArchetype;
  greeting: string;
  rumor: PatronRumor | null;
  onChallenge: () => void;
}

export function PatronCard({
  archetype,
  greeting,
  rumor,
  onChallenge,
}: PatronCardProps) {
  const display = ARCHETYPE_DISPLAY[archetype];

  return (
    <Card variant="bordered" padding="sm">
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none mt-0.5" aria-hidden>
          {display.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-text-primary text-sm">
              {display.label}
            </span>
            <Badge color={display.badgeColor}>Patron</Badge>
          </div>

          {/* Greeting */}
          <p className="text-xs text-text-muted italic mt-1">
            &ldquo;{greeting}&rdquo;
          </p>

          {/* Rumor */}
          {rumor && rumor.eventId && (
            <p className="text-xs text-text-tertiary mt-2 pl-3 border-l-2 border-purple-500/30">
              {rumor.text}
            </p>
          )}

          {/* Flavor */}
          <p className="text-[11px] text-text-faint mt-2">
            {NPC_FLAVOR[archetype]}
          </p>
        </div>

        <Button
          variant="action"
          color="cyan"
          size="xs"
          onClick={onChallenge}
          className="shrink-0 self-center"
        >
          Challenge
        </Button>
      </div>
    </Card>
  );
}
