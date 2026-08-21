"use client";

import { LogisticsPanel } from "@/components/system/logistics-panel";

/** Moved from `app/(game)/@panel/system/[systemId]/logistics/page.tsx`. */
export function SystemLogistics({ systemId }: { systemId: string }) {
  return <LogisticsPanel systemId={systemId} />;
}
