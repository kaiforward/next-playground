"use client";

import { useState } from "react";
import { tv } from "tailwind-variants";
import type { NpcArchetype } from "@/lib/engine/mini-games/voids-gambit";
import {
  NPC_FLAVOR,
  NPC_DIFFICULTY,
} from "@/lib/engine/mini-games/voids-gambit";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/form/number-input";
import { DifficultyDots } from "./difficulty-dots";

// ── Variants ──────────────────────────────────────────────────────

const opponentCardVariants = tv({
  base: "transition-all cursor-pointer hover:bg-white/8",
  variants: {
    selected: {
      true: "ring-2 ring-cyan-400 bg-white/8",
      false: "",
    },
  },
  defaultVariants: { selected: false },
});

// ── Archetype display config ─────────────────────────────────────

interface ArchetypeInfo {
  key: NpcArchetype;
  label: string;
  badgeColor: "green" | "amber" | "purple" | "red";
}

const ARCHETYPES: ArchetypeInfo[] = [
  { key: "cautious_trader", label: "Cautious Trader", badgeColor: "green" },
  { key: "frontier_gambler", label: "Frontier Gambler", badgeColor: "amber" },
  { key: "sharp_smuggler", label: "Sharp Smuggler", badgeColor: "purple" },
  { key: "station_regular", label: "Station Regular", badgeColor: "red" },
];

// ── Component ────────────────────────────────────────────────────

interface CantinaLobbyProps {
  onStart: (archetype: NpcArchetype, wager: number) => void;
}

export function CantinaLobby({ onStart }: CantinaLobbyProps) {
  const [selected, setSelected] = useState<NpcArchetype | null>(null);
  const [wager, setWager] = useState(50);

  const handleStart = () => {
    if (!selected) return;
    onStart(selected, Math.max(10, Math.min(500, wager)));
  };

  return (
    <div className="space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-white">Cantina</h1>
        <p className="text-base text-white/50">
          Choose an opponent for Void&apos;s Gambit
        </p>
      </div>

      {/* Opponent grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {ARCHETYPES.map(({ key, label, badgeColor }) => {
          const isSelected = selected === key;
          const difficulty = NPC_DIFFICULTY[key];

          return (
            <button
              key={key}
              onClick={() => setSelected(key)}
              className="text-left"
            >
              <Card
                variant="bordered"
                padding="lg"
                className={opponentCardVariants({ selected: isSelected })}
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-lg font-semibold text-white">
                    {label}
                  </h3>
                  <Badge color={badgeColor}>
                    {label.split(" ")[0]}
                  </Badge>
                </div>
                <DifficultyDots level={difficulty} showLabel />
                <p className="text-sm text-white/40 mt-3">
                  {NPC_FLAVOR[key]}
                </p>
              </Card>
            </button>
          );
        })}
      </div>

      {/* Wager + start */}
      <div className="flex items-end justify-center gap-5">
        <div className="w-40">
          <NumberInput
            label="Wager (CR)"
            size="md"
            value={wager}
            onChange={(e) => setWager(Number(e.target.value))}
            min={10}
            max={500}
            step={10}
          />
        </div>
        <Button
          variant="action"
          color="green"
          size="lg"
          disabled={!selected}
          onClick={handleStart}
        >
          Sit Down
        </Button>
      </div>
    </div>
  );
}
