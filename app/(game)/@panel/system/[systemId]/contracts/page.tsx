"use client";

import { use, useState } from "react";
import { useSystemMissions } from "@/lib/hooks/use-system-missions";
import { useSystemAllMissions } from "@/lib/hooks/use-op-missions";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useTickContext } from "@/lib/hooks/use-tick-context";
import { ContractsPanel } from "@/components/missions/contracts-panel";
import { OperationsPanel } from "@/components/missions/operations-panel";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { TabList, Tab } from "@/components/ui/tabs";

type SubTab = "delivery" | "operations";

function ContractsContent({ systemId }: { systemId: string }) {
  const [subTab, setSubTab] = useState<SubTab>("delivery");
  const { available, active } = useSystemMissions(systemId);
  const allMissions = useSystemAllMissions(systemId);
  const { fleet } = useFleet();
  const { currentTick } = useTickContext();

  return (
    <div>
      {/* Sub-tabs */}
      <TabList className="mb-6">
        <Tab
          active={subTab === "delivery"}
          onClick={() => setSubTab("delivery")}
          count={available.length}
        >
          Delivery
        </Tab>
        <Tab
          active={subTab === "operations"}
          onClick={() => setSubTab("operations")}
          count={allMissions.opMissions.available.length}
        >
          Operations
        </Tab>
      </TabList>

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
