import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import { SystemLayer } from "../system-layer";
import { SystemObject } from "../../objects/system-object";
import { Frustum } from "../../frustum";
import { computeLOD } from "../../lod";
import type { SystemCells } from "../../voronoi-cache";
import type { MultiPolygon } from "../../territory-utils";
import { systemNode as sys } from "../../__tests__/system-node-fixture";

// jsdom has no real canvas backend (`getContext("2d")` returns null without the `canvas` npm
// package, and it doesn't even define the `CanvasRenderingContext2D` global Pixi feature-detects
// against). Constructing a `SystemObject` touches two things that need a working 2D context:
// Pixi's Text measures a string's pixel width/height (`SystemObject.update` reads that into
// `labelHalfExtentsWorld`'s cache), and the shared glow texture (`glow-texture.ts`) paints a
// radial gradient. Stub just enough of both for that to run without crashing; the fit-pass tests
// below only care about relative text width (a wider string measures wider) and that a texture
// object comes back, not exact pixel/gradient output.
if (typeof globalThis.CanvasRenderingContext2D === "undefined") {
  Object.defineProperty(globalThis, "CanvasRenderingContext2D", { value: class {}, writable: true });
}
const contextStub = () => {
  const stub = {
    font: "",
    fillStyle: "",
    measureText: (text: string) => ({
      width: text.length * 7,
      actualBoundingBoxAscent: 10,
      actualBoundingBoxDescent: 3,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: text.length * 7,
    }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    fillRect: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  };
  return stub;
};
// A property descriptor takes any value, so the partial stub installs without a cast; the
// descriptor stays configurable so the file-scoped environment can be restored.
const originalGetContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { value: contextStub, configurable: true, writable: true });
afterAll(() => {
  if (originalGetContext) Object.defineProperty(HTMLCanvasElement.prototype, "getContext", originalGetContext);
});


/** A `SystemCells` whose one cell (tiny, centred on the system) can never fit a label box. */
function tinyCell(id: string, x: number, y: number): SystemCells {
  const halfSide = 0.5; // far smaller than any real label's padded box
  const ring: MultiPolygon = [[[
    [x - halfSide, y - halfSide],
    [x + halfSide, y - halfSide],
    [x + halfSide, y + halfSide],
    [x - halfSide, y + halfSide],
    [x - halfSide, y - halfSide],
  ]]];
  return {
    systems: [],
    cellsBySystemId: new Map([[id, ring]]),
    centroidBySystemId: new Map([[id, { x, y }]]),
    findSystemAt: () => null,
    groupBy: () => new Map(),
  };
}

/** A frustum covering the whole test area, wide enough that nothing gets culled. */
function wideFrustum(): Frustum {
  const frustum = new Frustum();
  frustum.update(0, 0, 1, 100_000, 100_000);
  return frustum;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SystemLayer — selected/hovered override the cell-fit result", () => {
  it("shows the selected system's name even though it does not fit its cell, and hides it again when selection clears", () => {
    const layer = new SystemLayer();
    const nameShownSpy = vi.spyOn(SystemObject.prototype, "setNameShown");
    const data = sys("a", 0, 0);
    const lod = computeLOD(1); // > 0.8 → showSystemNames true

    layer.sync([data], null);
    layer.setCells(tinyCell("a", 0, 0));
    layer.updateVisibility(wideFrustum(), lod, 16);

    // The fit pass ran against the tiny cell — the plain (unselected) system does not fit.
    expect(nameShownSpy).toHaveBeenLastCalledWith(false);

    nameShownSpy.mockClear();
    layer.sync([data], "a");
    expect(nameShownSpy).toHaveBeenLastCalledWith(true);

    nameShownSpy.mockClear();
    layer.sync([data], null);
    expect(nameShownSpy).toHaveBeenLastCalledWith(false);
  });

  it("shows the hovered system's name even though it does not fit its cell, and hides it again on clear", () => {
    const layer = new SystemLayer();
    const nameShownSpy = vi.spyOn(SystemObject.prototype, "setNameShown");
    const data = sys("a", 0, 0);
    const lod = computeLOD(1);

    layer.sync([data], null);
    layer.setCells(tinyCell("a", 0, 0));
    layer.updateVisibility(wideFrustum(), lod, 16);
    expect(nameShownSpy).toHaveBeenLastCalledWith(false);

    nameShownSpy.mockClear();
    layer.setHovered("a");
    expect(nameShownSpy).toHaveBeenLastCalledWith(true);

    nameShownSpy.mockClear();
    layer.setHovered(null);
    expect(nameShownSpy).toHaveBeenLastCalledWith(false);
  });

  it("vacuity: a system in a large cell fits without any selected/hovered override", () => {
    const layer = new SystemLayer();
    const nameShownSpy = vi.spyOn(SystemObject.prototype, "setNameShown");
    const data = sys("a", 0, 0);
    const lod = computeLOD(1);

    const bigCell: SystemCells = {
      systems: [],
      cellsBySystemId: new Map([[
        "a",
        [[[
          [-1000, -1000],
          [1000, -1000],
          [1000, 1000],
          [-1000, 1000],
          [-1000, -1000],
        ]]],
      ]]),
      centroidBySystemId: new Map([["a", { x: 0, y: 0 }]]),
      findSystemAt: () => null,
      groupBy: () => new Map(),
    };

    layer.sync([data], null);
    layer.setCells(bigCell);
    layer.updateVisibility(wideFrustum(), lod, 16);

    expect(nameShownSpy).toHaveBeenLastCalledWith(true);
  });
});
