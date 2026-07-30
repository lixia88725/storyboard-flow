import { describe, expect, it } from "vitest";
import { staticLayerLoadingMode } from "./ShotStaticMedia";

describe("ShotStaticMedia", () => {
  it("preloads only the base layer in the warm range", () => {
    expect(staticLayerLoadingMode(true, 0, 0)).toBe("eager");
    expect(staticLayerLoadingMode(true, 1, 0)).toBe("lazy");
    expect(staticLayerLoadingMode(true, 7, 0)).toBe("lazy");
  });

  it("preloads a reordered image base instead of the first paint layer", () => {
    expect(staticLayerLoadingMode(true, 0, 2)).toBe("lazy");
    expect(staticLayerLoadingMode(true, 2, 2)).toBe("eager");
  });

  it("keeps all layer images lazy in the cold range", () => {
    expect(staticLayerLoadingMode(false, 0, 0)).toBe("lazy");
    expect(staticLayerLoadingMode(false, 1, 0)).toBe("lazy");
  });
});
