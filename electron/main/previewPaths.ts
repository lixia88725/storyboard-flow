import { createHash } from "node:crypto";
import path from "node:path";

export const previewPathForImage = (imagePath: string, previewRoot: string): string => {
  const previewName = `${createHash("sha256").update(path.resolve(imagePath)).digest("hex")}.png`;
  return path.join(previewRoot, previewName);
};

