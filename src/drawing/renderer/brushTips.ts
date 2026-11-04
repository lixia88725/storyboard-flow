/**
 * Procedural brush tips.
 *
 * A tip is a grayscale coverage mask; the stroke renderer stamps it along the path.
 * Masks are generated instead of shipped so that the four presets differ in actual
 * pixels (edge falloff, grain, ragged outline) without adding binary assets.
 *
 * Determinism matters more than variety here: preview and committed pixels must be
 * identical, so every pixel of grain comes from a hash of (variant, x, y) and never
 * from Math.random(). Re-running the same stroke therefore reproduces the same mask.
 */

export type BrushTipKind = "hard" | "soft" | "pencil" | "charcoal";

export type TipSpec = {
  tip: BrushTipKind;
  /** Tip diameter in image pixels. */
  diameter: number;
  /** 0 = fully feathered, 1 = crisp edge. */
  hardness: number;
  /** Grain strength for pencil/charcoal; ignored by the round tips. */
  grain: number;
  /** 0..7 selects one of the grain variants so consecutive dabs do not repeat. */
  variant: number;
};

export type TipMask = { width: number; height: number; alpha: Uint8ClampedArray };

/** 32-bit integer hash. Same inputs always produce the same output on every platform. */
export const brushHash = (seed: number, index: number, salt = 0): number => {
  let h = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b)) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
};

/** Hash to [0, 1). */
export const unitFromHash = (hash: number): number => hash / 0x100000000;

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/** Cheap smooth value noise over a coarse grid; deterministic per (variant, x, y). */
const grainAt = (x: number, y: number, variant: number, seed: number, cell: number): number => {
  const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
  const fx = x / cell - gx, fy = y / cell - gy;
  const sample = (ix: number, iy: number) =>
    unitFromHash(brushHash(seed + variant * 7919, ix * 73856093 ^ iy * 19349663, 31));
  const a = sample(gx, gy), b = sample(gx + 1, gy), c = sample(gx, gy + 1), d = sample(gx + 1, gy + 1);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
};

/** Renders the coverage mask for one tip. Pure: no DOM, so the same code is testable. */
export const renderTipMask = (spec: TipSpec): TipMask => {
  const size = Math.max(1, Math.round(spec.diameter));
  const alpha = new Uint8ClampedArray(size * size);
  const radius = size / 2;
  const center = radius;
  // One pixel of antialiasing keeps hard edges crisp without turning them to mush.
  const edge = size <= 8 ? 0.75 : 1;
  const feather = Math.max(0.02, 1 - clamp01(spec.hardness));

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5 - center) / radius;
      const dy = (y + 0.5 - center) / radius;
      const distance = Math.sqrt(dx * dx + dy * dy);

      let coverage = 0;
      if (spec.tip === "hard" || spec.tip === "soft") {
        // Feather comes from the preset's hardness: 1 -> one-pixel edge, 0 -> long falloff.
        const inner = 1 - feather;
        const t = (1 - distance) / Math.max(1e-3, 1 - inner * 0.999);
        coverage = clamp01(t) * clamp01((size / 2) * (1 - distance) / edge);
      } else {
        // Grain tips keep a solid core, lose coverage through a per-pixel "tooth" and
        // lose the outline itself: the rim radius wobbles, so charcoal scatters further
        // than pencil instead of only fading.
        const grain = clamp01(spec.grain);
        const cell = Math.max(1, size * (spec.tip === "charcoal" ? 0.07 : 0.04));
        const noise = grainAt(x, y, spec.variant, 1337, cell);
        const rimJitter = unitFromHash(brushHash(spec.variant + 991, x * 131 + y * 977, 5));
        const rim = 1 - grain * 0.3 * (rimJitter - 0.5) * 2;
        const falloff = Math.max(1.5, size * 0.1) * (1 - grain * 0.45);
        const edgeCoverage = clamp01((rim - distance) * (size / 2) / falloff);
        const tooth = 0.4 + 0.6 * noise;
        coverage = edgeCoverage * (1 - 0.6 * grain * (1 - tooth));
        if (spec.tip === "charcoal") coverage *= 0.82 + 0.36 * noise;
      }

      alpha[y * size + x] = Math.round(clamp01(coverage) * 255);
    }
  }

  return { width: size, height: size, alpha };
};

/** Non-zero coverage bounds, used to crop compositing to the touched region. */
export const tipMaskBounds = (mask: TipMask): { x: number; y: number; width: number; height: number } | undefined => {
  let minX = mask.width, minY = mask.height, maxX = -1, maxY = -1;
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      if (mask.alpha[y * mask.width + x] === 0) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return undefined;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
};
