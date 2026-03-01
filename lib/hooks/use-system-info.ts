import { useUniverse } from "./use-universe";
import type { StarSystemInfo, RegionInfo } from "@/lib/types/game";

interface SystemInfoResult {
  systemInfo: StarSystemInfo | null;
  regionInfo: RegionInfo | null;
}

/** Look up a system and its region from the universe data. */
export function useSystemInfo(systemId: string): SystemInfoResult {
  const { data: universeData } = useUniverse();
  const systemInfo = universeData?.systems.find((s) => s.id === systemId) ?? null;
  const regionInfo = systemInfo
    ? universeData?.regions.find((r) => r.id === systemInfo.regionId) ?? null
    : null;
  return { systemInfo, regionInfo };
}
