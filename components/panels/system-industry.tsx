"use client";

import { IndustryPanel } from "@/components/system/industry-panel";

/** Moved from `app/(game)/@panel/system/[systemId]/industry/page.tsx` — a thin pass-through, the
 *  actual body is `IndustryPanel` (unchanged, per this task's reuse contract). */
export function SystemIndustry({ systemId }: { systemId: string }) {
  return <IndustryPanel systemId={systemId} />;
}
