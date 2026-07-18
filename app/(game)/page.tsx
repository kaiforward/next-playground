"use client";

import { useSearchParams } from "next/navigation";
import { StarMap } from "@/components/map/star-map";
import { useAtlas } from "@/lib/hooks/use-atlas";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { LoadingFallback } from "@/components/ui/loading-fallback";

function MapContent({ initialSystemId }: { initialSystemId?: string }) {
  const { atlas } = useAtlas();

  return (
    <div className="h-[calc(100vh-var(--topbar-height))] w-full relative">
      <StarMap
        atlas={atlas}
        initialSelectedSystemId={initialSystemId ?? atlas.player?.homeworldSystemId}
      />
    </div>
  );
}

export default function MapPage() {
  const searchParams = useSearchParams();
  const initialSystemId = searchParams.get("systemId") ?? undefined;

  return (
    <QueryBoundary
      loadingFallback={
        <LoadingFallback
          message="Loading star map..."
          className="h-[calc(100vh-var(--topbar-height))]"
        />
      }
    >
      <MapContent initialSystemId={initialSystemId} />
    </QueryBoundary>
  );
}
