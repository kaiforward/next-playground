import { tickLoop, type TickBroadcast } from "@/lib/world/tick-loop";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (broadcast: TickBroadcast) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(broadcast)}\n\n`));
        } catch {
          // Stream closed — cleaned up by the abort handler
        }
      };

      // Current state immediately on connect
      send(tickLoop.getSnapshot());

      const unsubscribe = tickLoop.subscribe(send);

      request.signal.addEventListener("abort", () => {
        unsubscribe();
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
