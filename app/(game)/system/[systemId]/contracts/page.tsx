"use client";

import { use, useState } from "react";
import { useSystemMissions } from "@/lib/hooks/use-system-missions";
import { useSystemAllMissions } from "@/lib/hooks/use-op-missions";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useTickContext } from "@/lib/hooks/use-tick-context";
import { ContractsPanel } from "@/components/missions/contracts-panel";
import { OperationsPanel } from "@/components/missions/operations-panel";
import { QueryBoundary } from "@/components/ui/query-boundary";

type SubTab = "delivery" | "operations";

function subTabClass(active: boolean) {
  return `pb-1.5 text-sm font-medium border-b-2 transition-colors ${
    active
      ? "border-indigo-400 text-white"
      : "border-transparent text-white/50 hover:text-white/70"
  }`;
}

function ContractsContent({ systemId }: { systemId: string }) {
  const [subTab, setSubTab] = useState<SubTab>("delivery");
  const { available, active } = useSystemMissions(systemId);
  const allMissions = useSystemAllMissions(systemId);
  const { fleet } = useFleet();
  const { currentTick } = useTickContext();

  return (
    <div>
      {/* Sub-tabs */}
      <div className="flex gap-4 mb-6">
        <button
          className={subTabClass(subTab === "delivery")}
          onClick={() => setSubTab("delivery")}
        >
          Delivery
          {available.length > 0 && (
            <span className="ml-1.5 text-xs text-white/30">({available.length})</span>
          )}
        </button>
        <button
          className={subTabClass(subTab === "operations")}
          onClick={() => setSubTab("operations")}
        >
          Operations
          {allMissions.opMissions.available.length > 0 && (
            <span className="ml-1.5 text-xs text-white/30">({allMissions.opMissions.available.length})</span>
          )}
        </button>
      </div>

      {subTab === "delivery" && (
        <ContractsPanel
          available={available}
          active={active}
          systemId={systemId}
          fleet={fleet}
          currentTick={currentTick}
        />
      )}

      {subTab === "operations" && (
        <OperationsPanel
          available={allMissions.opMissions.available}
          active={allMissions.opMissions.active}
          systemId={systemId}
          fleet={fleet}
          currentTick={currentTick}
        />
      )}
    </div>
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
