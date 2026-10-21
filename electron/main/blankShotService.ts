import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createOwnedFile, type OwnedFileReceipt } from "./ownedFileCreation.js";

const blankShotPresets = {
  "16:9": { width: 1920, height: 1080 },
  "1.85:1": { width: 1998, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "2.39:1": { width: 2581, height: 1080 },
  "1.43:1": { width: 1544, height: 1080 }
} as const;

export type BlankShotPreset = keyof typeof blankShotPresets;

export const createBlankShot = async (
  folderPath: string,
  preset: BlankShotPreset = "16:9",
  onCreated?: (receipt: OwnedFileReceipt) => void
): Promise<string> => {
  await mkdir(folderPath, { recursive: true });
  const size = blankShotPresets[preset] ?? blankShotPresets["16:9"];
  // Encode before touching a candidate name; publish only through an actual
  // exclusive creation, so dangling links are occupied names rather than holes.
  const bytes = await sharp({ create: {
    width: size.width, height: size.height, channels: 3, background: "#ffffff"
  } }).tiff().toBuffer();

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const imagePath = path.join(folderPath, `new_shot_${Date.now()}_${attempt}.tiff`);
    try {
      await createOwnedFile(imagePath, bytes, onCreated);
      return imagePath;
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
      if (code === "EEXIST") continue;

      throw error;
    }
  }

  throw new Error("Could not create a unique blank shot filename");
};
