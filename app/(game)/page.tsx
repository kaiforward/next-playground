"use client";

import { useSearchParams } from "next/navigation";
import { ErrorBoundary } from "react-error-boundary";
import { StarMap } from "@/components/map/star-map";
import { useAtlas } from "@/lib/hooks/use-atlas";
import { renderErrorFallback } from "@/components/ui/error-fallback";

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
    <ErrorBoundary fallbackRender={renderErrorFallback}>
      <MapContent initialSystemId={initialSystemId} />
    </ErrorBoundary>
  );
}
