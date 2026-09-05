import { describe, it, expect } from "vitest";
import { ValueChoroplethLayer } from "../value-choropleth-layer";
import { computeLOD } from "../../lod";

// The layer's children are added in constructor order: fills, outlines, numbers.
function alphas(layer: ValueChoroplethLayer) {
  const [fills, outlines] = layer.container.children;
  return { fills: fills.alpha, outlines: outlines.alpha };
}

describe("ValueChoroplethLayer.updateVisibility", () => {
  it("in Lanes mode the cell tint hands off to the lanes while the faction outlines stay", () => {
    const layer = new ValueChoroplethLayer();
    layer.setActive(true);
    layer.setValues(new Map(), new Map(), "lanes");

    const zoomedIn = computeLOD(1.5); // lanes fully in, cell tint fully out
    layer.updateVisibility(zoomedIn);

    expect(zoomedIn.lanesCellAlpha).toBe(0);
    expect(alphas(layer).fills).toBe(0);
    expect(alphas(layer).outlines).toBe(zoomedIn.valueChoroplethAlpha);
    expect(alphas(layer).outlines).toBeGreaterThan(0);
  });

  it("in a value mode the fills and outlines share the value-choropleth fade", () => {
    const layer = new ValueChoroplethLayer();
    layer.setActive(true);
    layer.setValues(new Map(), new Map(), "population");

    const lod = computeLOD(1.5);
    layer.updateVisibility(lod);

    expect(alphas(layer).fills).toBe(lod.valueChoroplethAlpha);
    expect(alphas(layer).outlines).toBe(lod.valueChoroplethAlpha);
  });
});
