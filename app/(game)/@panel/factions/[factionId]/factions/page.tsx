"use client";

import { use } from "react";
import { FactionPanel } from "@/components/panels/faction-panel";

export default function FactionFactionsTabPage({
  params,
}: {
  params: Promise<{ factionId: string }>;
}) {
  const { factionId } = use(params);
  return <FactionPanel factionId={factionId} tab="factions" />;
}
