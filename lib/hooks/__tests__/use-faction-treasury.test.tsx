import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFactionTreasury, useUpdateTreasuryPolicy } from "../use-faction-treasury";
import { seedSlices } from "./store-fixture";
import { installFakeCommandTransport } from "./command-client-fixture";
import { configureCommandTransport, deliverCommandResult } from "@/lib/runtime/command-client";
import type { FactionTreasuryData } from "@/lib/types/api";

const FACTION_ID = "f1";

function treasury(bands: FactionTreasuryData["bands"]): FactionTreasuryData {
  return {
    factionId: FACTION_ID,
    balance: 100,
    taxLevel: "normal",
    bands,
    funded: bands,
    net: 0,
    foundingCommitted: 0,
    lastSettlement: null,
  };
}

afterEach(() => {
  configureCommandTransport(null);
});

// Proves 2 (client-runtime build plan Task 8): two rapid treasury band commits — the second is
// built from the first's COMMITTED state, not a stale pre-commit snapshot (census C4's silent-
// revert kill). `TreasuryCard`'s real `commitBand` spreads whatever `useFactionTreasury` currently
// returns (`components/factions/treasury-card.tsx:51-52`); this test reproduces that exact call
// shape against the real hooks rather than asserting on the overlay mechanism directly.

describe("useUpdateTreasuryPolicy — the read-modify-write hazard (census C4)", () => {
  it("payload #2 carries payload #1's committed band, not the pre-commit value", async () => {
    const { posted } = installFakeCommandTransport();
    seedSlices({ factionTreasury: { [FACTION_ID]: treasury({ maintenance: 0.5, logistics: 0.2, construction: 0.2 }) } });

    const { result } = renderHook(() => ({
      data: useFactionTreasury(FACTION_ID),
      update: useUpdateTreasuryPolicy(FACTION_ID),
    }));

    // Commit #1: the maintenance slider releases at 0.9 — built the way TreasuryCard builds it,
    // spreading the CURRENT read's bands.
    act(() => {
      result.current.update.mutate({ bands: { ...result.current.data.bands, maintenance: 0.9 } });
    });
    expect(posted).toHaveLength(1);
    expect(posted[0].payload).toMatchObject({ bands: { maintenance: 0.9, logistics: 0.2, construction: 0.2 } });

    // The worker resolves commit #1 BEFORE the store's next state frame arrives (the window this
    // rule exists for) — its result carries the committed bands.
    await act(async () => {
      deliverCommandResult({
        type: "commandResult",
        id: posted[0].id,
        result: { ok: true, data: { taxLevel: "normal", bands: { maintenance: 0.9, logistics: 0.2, construction: 0.2 } } },
      });
    });

    // Commit #2, rapid: the logistics slider releases at 0.6, again spreading the CURRENT read.
    act(() => {
      result.current.update.mutate({ bands: { ...result.current.data.bands, logistics: 0.6 } });
    });

    expect(posted).toHaveLength(2);
    // The bug this proves against: without the in-flight overlay, `result.current.data.bands` here
    // would still read the pre-commit `{ maintenance: 0.5, ... }` (the store's own `factionTreasury`
    // slice hasn't moved — no state frame landed), so payload #2 would silently revert commit #1's
    // maintenance change back to 0.5.
    expect(posted[1].payload).toMatchObject({
      bands: { maintenance: 0.9, logistics: 0.6, construction: 0.2 },
    });
  });
});
