import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DEFAULT_ALERT_CATEGORIES } from "@/lib/constants/attention";
import { useAlerts } from "@/lib/hooks/use-alerts";
import { seedSlices } from "./store-fixture";
import type { AlertCategory } from "@/lib/types/api";

function AlertCountProbe() {
  const alerts = useAlerts();
  return <div data-testid="alert-count">{alerts.categories.length}</div>;
}

function famineCategory(): AlertCategory {
  return {
    id: "famine",
    unit: "developed_systems",
    count: 2,
    denominator: 10,
    instances: [
      { systemId: "sys-1", name: "Sys 1", measure: "-5%/cycle", sortKey: 0 },
      { systemId: "sys-2", name: "Sys 2", measure: "-3%/cycle", sortKey: 1 },
    ],
  };
}

describe("useAlerts — a store-backed component test, no QueryClientProvider", () => {
  it("renders synchronously off the store's current alerts slice — no Suspense fallback needed", () => {
    seedSlices({ alerts: { categories: [], categorySettings: DEFAULT_ALERT_CATEGORIES } });

    render(<AlertCountProbe />);

    expect(screen.getByTestId("alert-count")).toHaveTextContent("0");
  });

  it("re-renders when the store applies a newer alerts slice", () => {
    seedSlices({ alerts: { categories: [], categorySettings: DEFAULT_ALERT_CATEGORIES } });
    render(<AlertCountProbe />);
    expect(screen.getByTestId("alert-count")).toHaveTextContent("0");

    seedSlices({ alerts: { categories: [famineCategory()], categorySettings: DEFAULT_ALERT_CATEGORIES } });

    expect(screen.getByTestId("alert-count")).toHaveTextContent("1");
  });
});
