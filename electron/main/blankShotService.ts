import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const blankShotPresets = {
  "16:9": { width: 1920, height: 1080 },
  "2.39:1": { width: 2581, height: 1080 },
  "1.43:1": { width: 1544, height: 1080 }
} as const;

export type BlankShotPreset = keyof typeof blankShotPresets;

export const createBlankShot = async (
  folderPath: string,
  preset: BlankShotPreset = "16:9"
): Promise<string> => {
  await mkdir(folderPath, { recursive: true });
  const size = blankShotPresets[preset] ?? blankShotPresets["16:9"];

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const imagePath = path.join(folderPath, `new_shot_${Date.now()}_${attempt}.tiff`);
    try {
      await stat(imagePath);
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
      if (code === "ENOENT") {
        await sharp({
          create: {
            width: size.width,
            height: size.height,
            channels: 3,
            background: "#ffffff"
          }
        })
          .tiff()
          .toFile(imagePath);
        return imagePath;
      }

      throw error;
    }
  }

  throw new Error("Could not create a unique blank shot filename");
};
