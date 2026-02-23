"use client";

import { use, useMemo } from "react";
import { useFleet } from "@/lib/hooks/use-fleet";
import { useConvoys } from "@/lib/hooks/use-convoy";
import { ConvoyDetailCard } from "@/components/fleet/convoy-detail-card";
import { CreateConvoySection } from "@/components/fleet/convoy-panel";
import { QueryBoundary } from "@/components/ui/query-boundary";

function ConvoysContent({ systemId }: { systemId: string }) {
  const { fleet } = useFleet();
  const { convoys } = useConvoys();

  const convoysHere = useMemo(
    () => convoys.filter((c) => c.systemId === systemId),
    [convoys, systemId],
  );

  return (
    <div className="space-y-6">
      {convoysHere.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-white/40 text-sm">No convoys at this system.</p>
          <p className="text-white/20 text-xs mt-1">Form a convoy below using 2+ docked ships.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {convoysHere.map((convoy) => (
            <ConvoyDetailCard
              key={convoy.id}
              convoy={convoy}
              playerCredits={fleet.credits}
            />
          ))}
        </div>
      )}

      <CreateConvoySection
        ships={fleet.ships}
        systemId={systemId}
      />
    </div>
  );
}

export default function SystemConvoysPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);

  return (
    <QueryBoundary>
      <ConvoysContent systemId={systemId} />
    </QueryBoundary>
  );
}
