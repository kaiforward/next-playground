/**
 * Component-level proves for `GalaxyPreview` (spec `docs/planned/logistics-lanes.md` §5): jsdom has
 * no canvas (`getContext("2d")` returns null), so this asserts structure/text — never pixels — per
 * AGENTS Testing gotchas. The maths this renders (density-field byte array, placement parity, no-
 * crash extremes, perf ceiling) is proved separately in `galaxy-preview-render.test.ts` (node).
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { GalaxyPreview } from "../galaxy-preview";
import { buildGalaxyImpression } from "../galaxy-preview-render";
import { defaultGalaxyShapeKnobs, type GalaxyShapeKnobs } from "@/lib/engine/density-field";

vi.mock("../galaxy-preview-render", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../galaxy-preview-render")>();
  return { ...actual, buildGalaxyImpression: vi.fn(actual.buildGalaxyImpression) };
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(buildGalaxyImpression).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

function knobs(overrides: Partial<GalaxyShapeKnobs> = {}): GalaxyShapeKnobs {
  return { ...defaultGalaxyShapeKnobs(300), ...overrides };
}

describe("GalaxyPreview", () => {
  it("renders the canvas immediately, without crashing under jsdom's null 2d context", () => {
    render(<GalaxyPreview knobs={knobs()} seed={1} systemCount={300} />);
    expect(screen.getByRole("img", { name: "Galaxy generation preview" })).toBeInTheDocument();
  });

  it("shows a generating state before the debounced impression lands, then the placed-system count", async () => {
    render(<GalaxyPreview knobs={knobs()} seed={1} systemCount={300} />);
    expect(screen.getByText("Generating…")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(screen.queryByText("Generating…")).not.toBeInTheDocument();
    expect(screen.getByText(/systems placed · seed 1/)).toBeInTheDocument();
  });

  it("regenerates and updates the observable caption when a knob changes", async () => {
    const { rerender } = render(
      <GalaxyPreview knobs={knobs({ clusterCount: 4 })} seed={1} systemCount={300} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    const firstCaption = screen.getByText(/systems placed/).textContent;
    expect(vi.mocked(buildGalaxyImpression)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(buildGalaxyImpression).mock.calls[0][0].clusterCount).toBe(4);

    rerender(<GalaxyPreview knobs={knobs({ clusterCount: 20 })} seed={1} systemCount={300} />);
    // Mid-debounce: still showing the previous impression's caption, not yet regenerated.
    expect(screen.getByText(/systems placed/).textContent).toBe(firstCaption);
    expect(vi.mocked(buildGalaxyImpression)).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    // The regeneration this proves is real, not just "the caption text still matches its own
    // regex": a second call actually landed, keyed off the new knob value.
    expect(vi.mocked(buildGalaxyImpression)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(buildGalaxyImpression).mock.calls[1][0].clusterCount).toBe(20);
    expect(screen.getByText(/systems placed · seed 1/)).toBeInTheDocument();
  });

  it("debounces rapid knob changes into a single regeneration", async () => {
    const { rerender } = render(
      <GalaxyPreview knobs={knobs({ clusterCount: 4 })} seed={2} systemCount={300} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(vi.mocked(buildGalaxyImpression)).toHaveBeenCalledTimes(1);

    // Simulate a slider drag: several knob changes in quick succession, each well under the
    // 150ms debounce window — every one should cancel the previous pending regeneration rather
    // than firing its own.
    for (let n = 5; n <= 15; n += 5) {
      rerender(<GalaxyPreview knobs={knobs({ clusterCount: n })} seed={2} systemCount={300} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
    }
    expect(vi.mocked(buildGalaxyImpression)).toHaveBeenCalledTimes(1); // still just the mount call

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    // The settled drag fires exactly one more regeneration, at the final knob value the loop left.
    expect(vi.mocked(buildGalaxyImpression)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(buildGalaxyImpression).mock.calls[1][0].clusterCount).toBe(15);
  });

  it("regenerates when systemCount changes even with identical shape knobs", async () => {
    const fixedKnobs = knobs({ clusterCount: 6 });
    const { rerender } = render(
      <GalaxyPreview knobs={fixedKnobs} seed={3} systemCount={200} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(vi.mocked(buildGalaxyImpression)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(buildGalaxyImpression).mock.calls[0][2]).toBe(200);

    rerender(<GalaxyPreview knobs={fixedKnobs} seed={3} systemCount={2000} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(vi.mocked(buildGalaxyImpression)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(buildGalaxyImpression).mock.calls[1][2]).toBe(2000);
  });
});
