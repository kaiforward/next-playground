import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { makeQueryClient } from "@/lib/query/client";
import { useSystemValueMap } from "@/lib/hooks/use-system-value-map";
import { useStability } from "@/lib/hooks/use-stability";
import type { StabilityEntry } from "@/lib/types/game";

const pickUnrest = (e: StabilityEntry) => e.unrest;

function jsonResponse(systems: StabilityEntry[]): Response {
  return new Response(JSON.stringify({ data: { systems } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Renders the map's entries as `id=value` pairs so an emptied map is observable as empty text. */
function Probe({ active }: { active: boolean }) {
  const values = useSystemValueMap(
    ["stability"],
    "/api/game/systems/stability",
    pickUnrest,
    active,
  );
  return (
    <div data-testid="values">
      {[...values].map(([id, v]) => `${id}=${v}`).join(",")}
    </div>
  );
}

function StabilityProbe({ active }: { active: boolean }) {
  const values = useStability(active);
  return <div data-testid="values">{[...values].map(([id, v]) => `${id}=${v}`).join(",")}</div>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSystemValueMap", () => {
  it("empties the map when inactive even though the fetched data is still cached", async () => {
    // The teardown contract: an inactive caller must read empty, not the last mode's cached fill.
    // One QueryClient across both renders keeps the resolved data in cache, so a hook that reduced
    // `data` without consulting `active` would still report the entries here.
    const queryClient = makeQueryClient();
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse([{ systemId: "sys-1", unrest: 0.4 }])),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <Probe active />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("values")).toHaveTextContent("sys-1=0.4"));

    rerender(
      <QueryClientProvider client={queryClient}>
        <Probe active={false} />
      </QueryClientProvider>,
    );

    // `toHaveTextContent("")` matches anything — assert the raw text instead.
    expect(screen.getByTestId("values").textContent).toBe("");
  });

  it("does not fetch while inactive", () => {
    const queryClient = makeQueryClient();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <QueryClientProvider client={queryClient}>
        <Probe active={false} />
      </QueryClientProvider>,
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keys the map by systemId and reads the value through the caller's accessor", async () => {
    // useStability picks `unrest`; a hook wired to the wrong field would render `undefined` here.
    const queryClient = makeQueryClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        expect(url).toBe("/api/game/systems/stability");
        return Promise.resolve(
          jsonResponse([
            { systemId: "sys-1", unrest: 0.25 },
            { systemId: "sys-2", unrest: 0.75 },
          ]),
        );
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <StabilityProbe active />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("values")).toHaveTextContent("sys-1=0.25,sys-2=0.75"),
    );
  });
});
