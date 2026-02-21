"use client";

import { PageContainer } from "@/components/ui/page-container";
import { useVoidsGambit } from "@/lib/hooks/use-voids-gambit";
import { CantinaLobby } from "@/components/cantina/cantina-lobby";
import { GameTable } from "@/components/cantina/game-table";

export default function CantinaPage() {
  return (
    <PageContainer size="lg">
      <CantinaContent />
    </PageContainer>
  );
}

function CantinaContent() {
  const {
    game,
    npcDialogue,
    npcIdentity,
    isProcessing,
    startNewGame,
    declareCard,
    callOpponentAction,
    passCallAction,
    playAgain,
    returnToLobby,
  } = useVoidsGambit();

  if (!game || !npcIdentity) {
    return <CantinaLobby onStart={startNewGame} />;
  }

  return (
    <GameTable
      game={game}
      npcIdentity={npcIdentity}
      npcDialogue={npcDialogue}
      isProcessing={isProcessing}
      onDeclare={declareCard}
      onCall={callOpponentAction}
      onPass={passCallAction}
      onPlayAgain={playAgain}
      onReturnToLobby={returnToLobby}
    />
  );
}
