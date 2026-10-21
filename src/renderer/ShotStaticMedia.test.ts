import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BitmapLayer, Shot } from "../shared/types";
import { ShotLayerImageStack, ShotStaticMedia, staticLayerLoadingMode } from "./ShotStaticMedia";

const layer = (id: string, kind: BitmapLayer["kind"], order: number): BitmapLayer => ({
  id, kind, order, name: id, visible: false, locked: false,
  opacity: 1, blendMode: "normal", bitmapPath: `${id}.png`, width: 160, height: 90
});
const shot: Shot = {
  id: "shot", imagePath: "original.tif", previewPath: "preview.png",
  fileName: "original.tif", order: 0,
  layers: [layer("base", "image", 0), layer("paint", "paint", 1)]
};

beforeEach(() => {
  vi.stubGlobal("window", { storyboard: {
    assetUrl: (path: string) => `asset:${path}`,
    layerAssetUrl: ({ bitmapPath, revision }: { bitmapPath: string; revision: number }) =>
      `layer:${bitmapPath}?v=${revision}`
  } });
});
afterEach(() => vi.unstubAllGlobals());

it("renders an empty static stage when all bitmap layers are hidden", () => {
  const html = renderToStaticMarkup(createElement(ShotStaticMedia, {
    shot, folderPath: "/synthetic", revision: 7
  }));
  expect(html).toContain('class="image-stage"');
  expect(html).not.toContain("<img");
  expect(html).not.toContain("asset:");
});

describe("rendered layer stack", () => {
  const renderStack = (value: Shot, preloadBase = false, folderPath: string | undefined = "/synthetic") =>
    renderToStaticMarkup(createElement(ShotLayerImageStack, {
      shot: value, folderPath, revision: 7, preloadBase, className: "onion-skin-image"
    }));
  const images = (html: string) => html.match(/<img\b[^>]*>/g) ?? [];

  it.each([false, true])("keeps hidden onion layers empty with preload=%s", (preload) => {
    expect(renderStack(shot, preload)).toBe("");
    expect(renderStack(shot, preload, "")).toBe("");
    expect(renderStack({ ...shot, layers: [layer("paint", "paint", 0)] }, preload)).toBe("");
  });

  it.each([undefined, []] as Array<Shot["layers"]>)("preserves legacy fallback for layers=%s", (layers) => {
    const legacy = { ...shot, layers };
    expect(images(renderStack(legacy))).toEqual([
      '<img class="onion-skin-image" src="asset:preview.png" alt="" draggable="false" loading="lazy" decoding="async"/>'
    ]);
    const warm = images(renderStack({ ...legacy, previewPath: undefined }, true));
    expect(warm).toHaveLength(1);
    expect(warm[0]).toContain('src="asset:original.tif"');
    expect(warm[0]).toContain('loading="eager"');
  });

  it("renders only visible paint without exposing the hidden image fallback", () => {
    const html = renderStack({ ...shot, layers: [
      layer("base", "image", 0),
      { ...layer("paint", "paint", 1), visible: true, opacity: 0.4, blendMode: "multiply" }
    ] }, true);
    const rendered = images(html);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toContain('src="layer:paint.png?v=7"');
    expect(rendered[0]).toContain('style="opacity:0.4;mix-blend-mode:multiply"');
    expect(rendered[0]).toContain('loading="eager"');
    expect(html).not.toContain("asset:");
    expect(html).not.toContain("base.png");
  });

  it("preserves all-visible ordering, styles, and reordered base preloading", () => {
    const rendered = images(renderStack({ ...shot, layers: [
      { ...layer("base", "image", 1), visible: true },
      { ...layer("paint", "paint", 0), visible: true, opacity: 0.6, blendMode: "screen" }
    ] }, true));
    expect(rendered).toHaveLength(2);
    expect(rendered[0]).toContain('src="layer:paint.png?v=7"');
    expect(rendered[0]).toContain('style="opacity:0.6;mix-blend-mode:screen"');
    expect(rendered[0]).toContain('loading="lazy"');
    expect(rendered[1]).toContain('src="layer:base.png?v=7"');
    expect(rendered[1]).toContain('style="opacity:1;mix-blend-mode:normal"');
    expect(rendered[1]).toContain('loading="eager"');
  });

  it("retains visible image fallback without a folder but never revives a cleared image", () => {
    const visible = { ...layer("base", "image", 0), visible: true };
    expect(images(renderStack({ ...shot, layers: [visible] }, false, ""))[0])
      .toContain('src="asset:preview.png"');
    expect(renderStack({ ...shot, layers: [{ ...visible, cleared: true }] }, false, ""))
      .toBe("");
  });
});

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
