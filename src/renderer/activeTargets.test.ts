import { describe, expect, it } from "vitest";
import type { BitmapLayer, Shot } from "../shared/types";
import {
  activeVisibleBitmapLayerForShot,
  canFillBitmapLayer,
  editableBitmapLayerForShot,
  primaryShotFromSelection,
  primaryShotOrFirst
} from "./activeTargets";

const bitmapLayer = (id: string, order: number, visible = true): BitmapLayer => ({
  id,
  kind: "paint",
  name: id,
  visible,
  locked: false,
  opacity: 1,
  blendMode: "normal",
  order,
  bitmapPath: `${id}.png`,
  width: 100,
  height: 80
});

const shot = (id: string, layers: BitmapLayer[] = [], activeLayerId?: string): Shot => ({
  id,
  imagePath: `${id}.tiff`,
  fileName: `${id}.tiff`,
  order: 0,
  layers,
  activeLayerId
});

describe("active targets", () => {
  it("resolves the primary selected shot by id", () => {
    const shots = [shot("first"), shot("second")];

    expect(primaryShotFromSelection(shots, ["second"])?.id).toBe("second");
    expect(primaryShotFromSelection(shots, ["missing"])).toBeUndefined();
  });

  it("falls back to the first shot when command handling allows a fallback", () => {
    const shots = [shot("first"), shot("second")];

    expect(primaryShotOrFirst(shots, [])?.id).toBe("first");
    expect(primaryShotOrFirst(shots, ["second"])?.id).toBe("second");
  });

  it("uses the active bitmap layer when it is visible", () => {
    const layers = [bitmapLayer("bottom", 0), bitmapLayer("top", 1)];

    expect(activeVisibleBitmapLayerForShot(shot("shot-a", layers, "bottom"))?.id).toBe("bottom");
  });

  it("falls back to the topmost visible bitmap layer when active layer is hidden", () => {
    const layers = [
      bitmapLayer("bottom", 0),
      bitmapLayer("hidden-active", 1, false),
      bitmapLayer("top", 2)
    ];

    expect(activeVisibleBitmapLayerForShot(shot("shot-a", layers, "hidden-active"))?.id).toBe(
      "top"
    );
  });

  it("returns undefined when no bitmap layer is visible", () => {
    const layers = [bitmapLayer("hidden-bottom", 0, false), bitmapLayer("hidden-top", 1, false)];

    expect(activeVisibleBitmapLayerForShot(shot("shot-a", layers, "hidden-bottom"))).toBeUndefined();
  });

  it("uses the topmost visible unlocked bitmap layer for drawing when active is locked", () => {
    const lockedTop = { ...bitmapLayer("locked-top", 2), locked: true };
    const layers = [bitmapLayer("bottom", 0), bitmapLayer("editable", 1), lockedTop];

    expect(editableBitmapLayerForShot(shot("shot-a", layers, "locked-top"))?.id).toBe("editable");
  });

  it("allows color fill on unlocked paint and Image bitmap layers", () => {
    const imageLayer: BitmapLayer = {
      ...bitmapLayer("layer-image", 0),
      kind: "image",
      name: "Image"
    };
    const paintLayer = bitmapLayer("paint", 1);

    expect(canFillBitmapLayer(imageLayer)).toBe(true);
    expect(canFillBitmapLayer(paintLayer)).toBe(true);
    expect(canFillBitmapLayer({ ...imageLayer, locked: true })).toBe(false);
    expect(canFillBitmapLayer({ ...imageLayer, visible: false })).toBe(false);
    expect(canFillBitmapLayer(undefined)).toBe(false);
  });
});
