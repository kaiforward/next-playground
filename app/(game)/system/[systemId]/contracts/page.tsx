"use client";

import { use } from "react";
import { useSystemMissions } from "@/lib/hooks/use-system-missions";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useTickContext } from "@/lib/hooks/use-tick-context";
import { ContractsPanel } from "@/components/missions/contracts-panel";
import { QueryBoundary } from "@/components/ui/query-boundary";

function ContractsContent({ systemId }: { systemId: string }) {
  const { available, active } = useSystemMissions(systemId);
  const { fleet } = useFleet();
  const { currentTick } = useTickContext();

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

export default function ContractsPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);

  return (
    <QueryBoundary>
      <ContractsContent systemId={systemId} />
    </QueryBoundary>
  );
}
