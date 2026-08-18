import { describe, it, expect, vi } from "vitest";

// Isolated from the sibling suite because it replaces polyclip's intersection with a
// throwing stub; the other tests need the real one to check actual clip geometry.
vi.mock("polyclip-ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("polyclip-ts")>();
  return {
    ...actual,
    intersection: () => {
      throw new Error("Unable to complete output ring");
    },
  };
});

const { clipPolygonToDisc } = await import("../territory-utils");

describe("clipPolygonToDisc when polyclip throws", () => {
  const square: [number, number][] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
    [0, 0],
  ];

  it("returns the unclipped ring rather than letting the throw escape", () => {
    expect(() => clipPolygonToDisc(square, 5, 5, 4, 24)).not.toThrow();
    expect(clipPolygonToDisc(square, 5, 5, 4, 24)).toEqual([[square]]);
  });
});
