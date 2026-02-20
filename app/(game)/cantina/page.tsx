"use client";

import { PageContainer } from "@/components/ui/page-container";
import { useVoidsGambit } from "@/lib/hooks/use-voids-gambit";
import { CantinaLobby } from "@/components/cantina/cantina-lobby";
import { GameTable } from "@/components/cantina/game-table";

export default function CantinaPage() {
  const vg = useVoidsGambit();

  return (
    <PageContainer size="lg">
      {vg.game === null ? (
        <CantinaLobby onStart={vg.startNewGame} />
      ) : (
        <GameTable vg={vg} />
      )}
    </PageContainer>
  );
}
