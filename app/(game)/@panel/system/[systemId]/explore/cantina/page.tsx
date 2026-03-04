"use client";

import { use, useState, useCallback, useRef, useEffect } from "react";
import Link from "next/link";
import type { NpcArchetype } from "@/lib/engine/mini-games/voids-gambit";
import type { GameResult } from "@/lib/engine/mini-games/voids-gambit";
import { NPC_ARCHETYPES } from "@/lib/constants/cantina-npcs";
import { useVoidsGambit } from "@/lib/hooks/use-voids-gambit";
import { useFleet } from "@/lib/hooks/use-fleet";
import {
  useBartenderTips,
  usePatronRumors,
  useNpcVisitCounts,
  useNpcVisitMutation,
  useSettleWagerMutation,
} from "@/lib/hooks/use-cantina";
import { getGreeting } from "@/lib/engine/cantina/greetings";
import { BartenderPanel } from "@/components/cantina/bartender-panel";
import { PatronCard } from "@/components/cantina/patron-card";
import { CantinaLobby } from "@/components/cantina/cantina-lobby";
import { GameTable } from "@/components/cantina/game-table";
import { SectionHeader } from "@/components/ui/section-header";
import { QueryBoundary } from "@/components/ui/query-boundary";

// ── Back nav button (shared style for in-page view changes) ─────

function BackNav({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="text-xs text-text-faint hover:text-text-secondary transition-colors"
    >
      {children}
    </button>
  );
}

// ── View states ─────────────────────────────────────────────────

type CantinaView = "npcs" | "lobby" | "game";

// ── Content component ───────────────────────────────────────────

function CantinaContent({ systemId }: { systemId: string }) {
  const [view, setView] = useState<CantinaView>("npcs");
  const [challengedArchetype, setChallengedArchetype] =
    useState<NpcArchetype | null>(null);
  const [creditsChange, setCreditsChange] = useState<number | null>(null);

  const { fleet } = useFleet();
  const bartender = useBartenderTips(systemId);
  const { rumors } = usePatronRumors(systemId);
  const npcVisits = useNpcVisitCounts(systemId);
  const visitMutation = useNpcVisitMutation(systemId);
  const settleWager = useSettleWagerMutation();

  // Record bartender visit once on mount
  const bartenderVisitedRef = useRef(false);
  useEffect(() => {
    if (!bartenderVisitedRef.current) {
      bartenderVisitedRef.current = true;
      visitMutation.mutate("bartender");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Track wager for settlement
  const currentWagerRef = useRef(0);

  // Game complete handler — settle credits on server
  const handleGameComplete = useCallback(
    (result: GameResult) => {
      const wager = currentWagerRef.current;
      const outcome =
        result.winner === "player"
          ? "win"
          : result.winner === "npc"
            ? "loss"
            : ("tie" as const);

      settleWager.mutate(
        { wager, outcome },
        {
          onSuccess: (data) => {
            setCreditsChange(data.creditsChange);
          },
        },
      );
    },
    [settleWager],
  );

  const vg = useVoidsGambit({ onGameComplete: handleGameComplete });

  // Challenge a patron → record visit, go to lobby
  const handleChallenge = useCallback(
    (archetype: NpcArchetype) => {
      visitMutation.mutate(archetype);
      setChallengedArchetype(archetype);
      setView("lobby");
    },
    [visitMutation],
  );

  // Start game from lobby → track wager, switch to game view
  const handleStartGame = useCallback(
    (archetype: NpcArchetype, wager: number) => {
      currentWagerRef.current = wager;
      setCreditsChange(null);
      vg.startNewGame(archetype, wager);
      setView("game");
    },
    [vg],
  );

  // Return to NPC view
  const handleReturnToLobby = useCallback(() => {
    vg.returnToLobby();
    setView("npcs");
    setChallengedArchetype(null);
    setCreditsChange(null);
  }, [vg]);

  // Play again from game view
  const handlePlayAgain = useCallback(() => {
    setCreditsChange(null);
    vg.playAgain();
  }, [vg]);

  // ── Render views ──────────────────────────────────────────────

  if (view === "game" && vg.game && vg.npcIdentity) {
    return (
      <div className="space-y-4">
        <BackNav onClick={handleReturnToLobby}>
          &larr; Back to Cantina
        </BackNav>
        <GameTable
          game={vg.game}
          npcIdentity={vg.npcIdentity}
          npcDialogue={vg.npcDialogue}
          isProcessing={vg.isProcessing}
          onDeclare={vg.declareCard}
          onCall={vg.callOpponentAction}
          onPass={vg.passCallAction}
          onPlayAgain={handlePlayAgain}
          onReturnToLobby={handleReturnToLobby}
          creditsChange={creditsChange}
        />
      </div>
    );
  }

  if (view === "lobby") {
    return (
      <div className="space-y-4">
        <BackNav
          onClick={() => {
            setView("npcs");
            setChallengedArchetype(null);
          }}
        >
          &larr; Back to Cantina
        </BackNav>
        <CantinaLobby
          onStart={handleStartGame}
          playerCredits={fleet.credits}
          initialArchetype={challengedArchetype}
        />
      </div>
    );
  }

  // ── NPC view (default) ────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href={`/system/${systemId}/explore`}
          className="text-xs text-text-faint hover:text-text-secondary transition-colors"
        >
          &larr; Back to Locations
        </Link>
        <h2 className="text-2xl font-bold font-display text-text-primary mt-2">
          Station Cantina
        </h2>
        <p className="text-sm text-text-tertiary mt-1">
          Low lighting, the clink of glasses, and the murmur of a dozen
          conversations in as many languages. The air smells of recycled
          atmosphere and strong spirits.
        </p>
      </div>

      {/* Bartender */}
      <section>
        <SectionHeader className="mb-3">Bartender</SectionHeader>
        <BartenderPanel data={bartender} />
      </section>

      {/* Patrons */}
      <section>
        <SectionHeader className="mb-3">Patrons</SectionHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {NPC_ARCHETYPES.map((archetype, i) => {
            const visitCount = npcVisits[archetype] ?? 0;
            const greeting = getGreeting(archetype, visitCount);
            const rumor = rumors[i] ?? null;

            return (
              <PatronCard
                key={archetype}
                archetype={archetype}
                greeting={greeting}
                rumor={rumor}
                onChallenge={() => handleChallenge(archetype)}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}

// ── Page wrapper ────────────────────────────────────────────────

export default function CantinaPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);
  return (
    <QueryBoundary>
      <CantinaContent systemId={systemId} />
    </QueryBoundary>
  );
}
