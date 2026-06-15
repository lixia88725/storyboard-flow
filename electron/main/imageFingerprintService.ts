import { createHash } from "node:crypto";
import sharp from "sharp";

const sharpSourceOptions = { unlimited: true } as const;

export const pixelFingerprint = async (imagePath: string): Promise<string> => {
  const { data, info } = await sharp(imagePath, sharpSourceOptions)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const hash = createHash("sha256");
  hash.update(`${info.width}x${info.height}:${info.channels}:`);
  hash.update(data);
  return hash.digest("hex");
};
