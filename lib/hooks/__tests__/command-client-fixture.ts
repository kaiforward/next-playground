/**
 * The fake `CommandTransport` a command-mutation hook test wires in place of the real worker
 * connection (`lib/runtime/command-client.ts`'s own seam contract: "a test initialises it with a
 * fake"). `posted` accumulates every envelope in dispatch order so a test can grab its `id` and
 * answer it via `deliverCommandResult`; `configureCommandTransport(null)` in `afterEach` (each
 * test file's own responsibility) prevents one test's fake transport leaking into the next, since
 * the module holds one process-wide singleton.
 */
import { configureCommandTransport } from "@/lib/runtime/command-client";
import type { GameCommandEnvelope } from "@/client/worker/game-worker";

export function installFakeCommandTransport(): { posted: GameCommandEnvelope[] } {
  const posted: GameCommandEnvelope[] = [];
  configureCommandTransport({ postCommand: (envelope) => posted.push(envelope) });
  return { posted };
}
