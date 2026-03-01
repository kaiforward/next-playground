"use client";

import { use } from "react";
import { HubCard } from "@/components/ui/hub-card";
import { ShipIcon, WrenchIcon } from "@/components/ui/icons";

export default function ShipyardPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = use(params);
  const basePath = `/system/${systemId}/shipyard`;

  return (
    <div className="space-y-4">
      <HubCard
        href={`${basePath}/purchase`}
        title="Ship Dealer"
        description="Browse and purchase new vessels"
        icon={<ShipIcon />}
        accentClass="hover:border-blue-500/50"
      />
      <HubCard
        href={`${basePath}/upgrades`}
        title="Upgrade Bay"
        description="Install and manage ship modules"
        icon={<WrenchIcon />}
        accentClass="hover:border-purple-500/50"
      />
    </div>
  );
}
