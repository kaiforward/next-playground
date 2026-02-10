import { getSessionPlayerId } from "@/lib/auth/get-player";
import { tickEngine } from "@/lib/tick/engine";
import type { TickEvent } from "@/lib/types/api";
import type { TickEventRaw } from "@/lib/tick/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Resolve Player ID (not User ID) — processors key events by player ID
  const playerId = await getSessionPlayerId();
  if (!playerId) {
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
        events: {},
        playerEvents: {},
      };
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify(initial)}\n\n`),
      );

      // Subscribe to tick events — filter playerEvents for this client
      const onTick = (raw: TickEventRaw) => {
        try {
          const clientEvent: TickEvent = {
            currentTick: raw.currentTick,
            tickRate: raw.tickRate,
            events: raw.events,
            playerEvents: raw.playerEvents.get(playerId) ?? {},
            processors: raw.processors,
          };
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(clientEvent)}\n\n`),
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
