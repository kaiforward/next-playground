"use client";

import { useState } from "react";
import { tv } from "tailwind-variants";
import type { NpcArchetype } from "@/lib/engine/mini-games/voids-gambit";
import {
  NPC_FLAVOR,
  NPC_DIFFICULTY,
  NPC_WAGER_LIMITS,
} from "@/lib/engine/mini-games/voids-gambit";
import { NPC_ARCHETYPES, ARCHETYPE_DISPLAY } from "@/lib/constants/cantina-npcs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NumberInput } from "@/components/form/number-input";
import { DifficultyDots } from "@/components/ui/difficulty-dots";

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

// ── Component ────────────────────────────────────────────────────

interface CantinaLobbyProps {
  onStart: (archetype: NpcArchetype, wager: number) => void;
  /** Player credit balance. When provided, shows balance and disables when insufficient. */
  playerCredits?: number;
  /** Pre-select an archetype (e.g. from patron challenge). */
  initialArchetype?: NpcArchetype | null;
}

export function CantinaLobby({
  onStart,
  playerCredits,
  initialArchetype,
}: CantinaLobbyProps) {
  const [selected, setSelected] = useState<NpcArchetype | null>(
    initialArchetype ?? null,
  );
  const [wager, setWager] = useState(
    initialArchetype ? NPC_WAGER_LIMITS[initialArchetype].default : 50,
  );

  const limits = selected ? NPC_WAGER_LIMITS[selected] : null;

  const handleSelect = (key: NpcArchetype) => {
    setSelected(key);
    // Reset wager to the new opponent's default
    setWager(NPC_WAGER_LIMITS[key].default);
  };

  const handleStart = () => {
    if (!selected || !limits) return;
    onStart(selected, Math.max(limits.min, Math.min(limits.max, wager)));
  };

  const insufficientFunds =
    playerCredits !== undefined && playerCredits < (limits?.min ?? 10);

  return (
    <div className="space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-text-primary">
          Void&apos;s Gambit
        </h1>
        <p className="text-base text-text-tertiary">
          Choose an opponent
        </p>
        {playerCredits !== undefined && (
          <p className="text-sm text-text-secondary">
            Your balance:{" "}
            <span className={insufficientFunds ? "text-red-400" : "text-amber-300"}>
              {Math.floor(playerCredits)} CR
            </span>
          </p>
        )}
      </div>

      {/* Opponent grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {NPC_ARCHETYPES.map((key) => {
          const display = ARCHETYPE_DISPLAY[key];
          const isSelected = selected === key;
          const difficulty = NPC_DIFFICULTY[key];
          const wagerLimits = NPC_WAGER_LIMITS[key];

          return (
            <button
              key={key}
              onClick={() => handleSelect(key)}
              className="text-left"
              aria-pressed={isSelected}
            >
              <Card
                variant="bordered"
                padding="lg"
                className={opponentCardVariants({ selected: isSelected })}
              >
                <div className="flex items-start justify-between mb-3">
                  <h3 className="text-lg font-semibold text-text-primary">
                    {display.label}
                  </h3>
                  <Badge color={display.badgeColor}>
                    {display.label.split(" ")[0]}
                  </Badge>
                </div>
                <DifficultyDots level={difficulty} showLabel />
                <p className="text-sm text-text-muted mt-3">
                  {NPC_FLAVOR[key]}
                </p>
                <p className="text-xs text-text-faint mt-1">
                  Wager: {wagerLimits.min}–{wagerLimits.max} CR
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
            id="cantina-wager"
            label="Wager (CR)"
            size="md"
            value={wager}
            onChange={(e) => setWager(Number(e.target.value))}
            min={limits?.min ?? 10}
            max={limits?.max ?? 500}
            step={limits?.step ?? 10}
            disabled={!selected}
          />
        </div>
        <Button
          variant="action"
          color="green"
          size="lg"
          disabled={!selected || insufficientFunds}
          onClick={handleStart}
        >
          Sit Down
        </Button>
      </div>
    </div>
  );
}
