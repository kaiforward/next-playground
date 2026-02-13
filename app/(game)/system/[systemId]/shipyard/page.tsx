"use client";

import { use } from "react";
import { useFleet } from "@/lib/hooks/use-fleet";
import { ShipyardPanel } from "@/components/shipyard/shipyard-panel";

export default function ShipyardPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);
  const { fleet, loading } = useFleet();

  if (loading) {
    return <p className="text-white/50">Loading...</p>;
  }

  return (
    <ShipyardPanel
      systemId={systemId}
      playerCredits={fleet?.credits ?? 0}
    />
  );
}
