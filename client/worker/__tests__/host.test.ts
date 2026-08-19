import { describe, it, expect, vi } from "vitest";
import { createWorkerHost, createFakeWorkerScope } from "@/client/worker/host";

interface Inbound { type: "ping" }
interface Outbound { type: "pong"; n: number }

describe("host — createWorkerHost over a fake scope", () => {
  it("post() forwards to the scope's postMessage verbatim", () => {
    const scope = createFakeWorkerScope<Inbound, Outbound>();
    const host = createWorkerHost(scope);

    host.post({ type: "pong", n: 1 });

    expect(scope.sent).toEqual([{ type: "pong", n: 1 }]);
  });

  it("onMessage() installs a handler the scope's onmessage invokes on receive()", () => {
    const scope = createFakeWorkerScope<Inbound, Outbound>();
    const host = createWorkerHost(scope);
    const handler = vi.fn();

    host.onMessage(handler);
    scope.receive({ type: "ping" });

    expect(handler).toHaveBeenCalledExactlyOnceWith({ type: "ping" });
  });

  it("receive() before onMessage() is installed is a silent no-op, not a throw", () => {
    const scope = createFakeWorkerScope<Inbound, Outbound>();
    expect(() => scope.receive({ type: "ping" })).not.toThrow();
  });
});
