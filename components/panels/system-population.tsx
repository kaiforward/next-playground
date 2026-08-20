"use client";

import { PopulationPanel } from "@/components/system/population-panel";

/** Moved from `app/(game)/@panel/system/[systemId]/population/page.tsx`. */
export function SystemPopulation({ systemId }: { systemId: string }) {
  return <PopulationPanel systemId={systemId} />;
}
