"use client";

import { use } from "react";
import { useSystemMissions } from "@/lib/hooks/use-system-missions";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useTickContext } from "@/lib/hooks/use-tick-context";
import { ContractsPanel } from "@/components/missions/contracts-panel";

export default function ContractsPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);
  const { available, active, loading } = useSystemMissions(systemId);
  const { fleet } = useFleet();
  const { currentTick } = useTickContext();

  if (loading) {
    return <p className="text-white/60">Loading contracts...</p>;
  }

  return (
    <ContractsPanel
      available={available}
      active={active}
      systemId={systemId}
      fleet={fleet}
      currentTick={currentTick}
    />
  );
}
