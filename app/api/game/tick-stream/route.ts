import { auth } from "@/lib/auth/auth";
import { tickEngine } from "@/lib/tick-engine";
import type { TickEvent } from "@/lib/types/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Ensure the tick engine is running
  tickEngine.ensureStarted();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Send current state immediately on connect
      const state = await tickEngine.getState();
      const initial: TickEvent = {
        currentTick: state.currentTick,
        tickRate: state.tickRate,
        arrivedShipIds: [],
      };
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(initial)}\n\n`),
      );

      // Subscribe to tick events
      const onTick = (event: TickEvent) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          // Stream closed — will be cleaned up by abort handler
        }
      };

      tickEngine.subscribe(onTick);

      // Clean up when client disconnects
      request.signal.addEventListener("abort", () => {
        tickEngine.unsubscribe(onTick);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
