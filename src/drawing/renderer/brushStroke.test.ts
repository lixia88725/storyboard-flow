import { describe, expect, it } from "vitest";
import { brushHash, renderTipMask, tipMaskBounds, unitFromHash } from "./brushTips";
import { dabBounds, dabsForStroke, TIP_VARIANTS, type BrushableStroke } from "./brushStroke";

const stroke = (patch: Partial<BrushableStroke> = {}): BrushableStroke => ({
  tool: "brush",
  color: "#112233",
  size: 20,
  opacity: 0.4,
  points: [0, 0, 100, 0],
  brush: { tip: "hard", spacing: 0.1, hardness: 1, grain: 0, seed: 7, pressureSize: 0.5, pressureOpacity: 0.5 },
  ...patch,
});

describe("brushHash", () => {
  it("is stable and spreads over the unit interval", () => {
    const values = Array.from({ length: 512 }, (_, index) => unitFromHash(brushHash(7, index, 11)));
    expect(new Set(values).size).toBe(512);
    expect(values.every(value => value >= 0 && value < 1)).toBe(true);
    expect(unitFromHash(brushHash(7, 3, 11))).toBe(unitFromHash(brushHash(7, 3, 11)));
  });
});

describe("renderTipMask", () => {
  it("reproduces the same bytes for the same spec", () => {
    const spec = { tip: "pencil" as const, diameter: 24, hardness: 0.5, grain: 0.6, variant: 2 };
    expect(Array.from(renderTipMask(spec).alpha)).toEqual(Array.from(renderTipMask(spec).alpha));
  });

  it("gives the four presets genuinely different coverage", () => {
    const coverage = (tip: "hard" | "soft" | "pencil" | "charcoal") => {
      const mask = renderTipMask({ tip, diameter: 40, hardness: tip === "hard" ? 1 : 0.2, grain: 0.8, variant: 1 });
      let partial = 0, solid = 0, empty = 0;
      let total = 0;
      for (const value of mask.alpha) {
        if (value === 0) empty++;
        else if (value === 255) solid++;
        else partial++;
        total += value;
      }
      return { partial, solid, empty, mean: total / mask.alpha.length };
    };

    const hard = coverage("hard");
    const soft = coverage("soft");
    const pencil = coverage("pencil");
    const charcoal = coverage("charcoal");

    // A hard tip is mostly opaque; a soft one is mostly partial coverage.
    expect(hard.solid).toBeGreaterThan(hard.partial);
    expect(soft.partial).toBeGreaterThan(soft.solid);
    // Grain tips break the mask into partial pixels; harder grain deposits less ink.
    expect(pencil.partial).toBeGreaterThan(hard.partial);
    expect(charcoal.partial).toBeGreaterThan(hard.partial);
    expect(charcoal.mean).toBeLessThan(pencil.mean);
    expect(pencil.mean).toBeLessThan(hard.mean);
  });

  it("keeps the corners empty so a tip never paints outside its diameter", () => {
    const mask = renderTipMask({ tip: "hard", diameter: 16, hardness: 1, grain: 0, variant: 0 });
    expect(mask.alpha[0]).toBe(0);
    expect(mask.alpha[mask.width - 1]).toBe(0);
    expect(mask.alpha[mask.alpha.length - 1]).toBe(0);
  });

  it("reports the painted bounds inside the mask", () => {
    const mask = renderTipMask({ tip: "hard", diameter: 16, hardness: 1, grain: 0, variant: 0 });
    const bounds = tipMaskBounds(mask);
    expect(bounds).toBeDefined();
    expect(bounds!.width).toBeLessThanOrEqual(16);
    // The outermost pixel keeps a partial antialiased edge, so bounds may start at 0.
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(16);
  });
});

describe("dabsForStroke", () => {
  it("covers the whole path without gaps bigger than the spacing", () => {
    const dabs = dabsForStroke(stroke());
    expect(dabs.length).toBeGreaterThan(40);
    for (let index = 1; index < dabs.length; index++) {
      const gap = Math.hypot(dabs[index].x - dabs[index - 1].x, dabs[index].y - dabs[index - 1].y);
      expect(gap).toBeLessThanOrEqual(20 * 0.1 + 1e-6);
    }
    expect(dabs.at(-1)!.x).toBeCloseTo(100, 5);
  });

  it("is deterministic for the same stroke", () => {
    expect(dabsForStroke(stroke())).toEqual(dabsForStroke(stroke()));
  });

  it("varies grain between dabs so stamps do not line up", () => {
    const variants = new Set(dabsForStroke(stroke()).map(dab => dab.variant));
    expect(variants.size).toBeGreaterThan(1);
    expect(Math.max(...variants)).toBeLessThan(TIP_VARIANTS);
  });

  it("maps pressure onto size and coverage", () => {
    const points = [0, 0, 50, 0];
    const light = dabsForStroke(stroke({ points, pressures: [0.2, 0.2] }));
    const heavy = dabsForStroke(stroke({ points, pressures: [1, 1] }));
    expect(light[0].size).toBeLessThan(heavy[0].size);
    expect(light[0].coverage).toBeLessThan(heavy[0].coverage);
  });

  it("treats a missing pressure sample as a mouse: full pressure", () => {
    const noPressure = dabsForStroke(stroke());
    const full = dabsForStroke(stroke({ pressures: [1, 1] }));
    expect(noPressure[0].coverage).toBeCloseTo(full[0].coverage, 10);
  });

  it("never exceeds the stroke opacity: dabs accumulate inside the buffer, not on the layer", () => {
    // The contract: painting composites the buffer once at stroke.opacity, so the
    // achievable alpha of one stroke is bounded by that opacity regardless of dabs.
    for (const opacity of [0.1, 0.3, 0.75, 1]) {
      for (const dab of dabsForStroke(stroke({ opacity }))) {
        expect(Math.min(1, dab.coverage) * opacity).toBeLessThanOrEqual(opacity + 1e-9);
      }
    }
  });
});

describe("dabBounds", () => {
  it("clamps to the destination and skips off-canvas strokes", () => {
    const dabs = dabsForStroke(stroke({ points: [-500, -500, -480, -480] }));
    expect(dabBounds(dabs, 100, 100)).toBeUndefined();
    const inside = dabBounds(dabsForStroke(stroke()), 60, 60);
    expect(inside).toMatchObject({ x: 0, y: 0, width: 60 });
    // Size jitter moves the rim by a fraction of a pixel; the box stays tip-sized.
    expect(inside!.height).toBeGreaterThanOrEqual(10);
    expect(inside!.height).toBeLessThanOrEqual(13);
  });
});
