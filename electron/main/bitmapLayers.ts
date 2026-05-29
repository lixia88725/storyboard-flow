import sharp from "sharp";

type SharpBlendMode = "over" | "multiply" | "screen";

export type BitmapLayerComposite = {
  input: Buffer;
  blend: SharpBlendMode;
  opacity: number;
};

export const applyBitmapLayerOpacity = async (
  pngBuffer: Buffer,
  opacity: number
): Promise<Buffer> => {
  return sharp(pngBuffer)
    .ensureAlpha()
    .linear([1, 1, 1, opacity], [0, 0, 0, 0])
    .png()
    .toBuffer();
};

export const flattenBitmapLayerBuffersToTiff = async (
  width: number,
  height: number,
  layers: BitmapLayerComposite[]
): Promise<Buffer> => {
  const composites = await Promise.all(
    layers.map(async (layer) => {
      const opacity = Math.min(1, Math.max(0, layer.opacity));
      return {
        input: opacity < 1 ? await applyBitmapLayerOpacity(layer.input, opacity) : layer.input,
        blend: layer.blend
      };
    })
  );

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  })
    .composite(composites)
    .tiff({ compression: "none" })
    .toBuffer();
};
