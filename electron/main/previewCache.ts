import { stat } from "node:fs/promises";

export const previewIsFresh = async (imagePath: string, previewPath: string): Promise<boolean> => {
  try {
    const [sourceStat, previewStat] = await Promise.all([stat(imagePath), stat(previewPath)]);
    return previewStat.mtimeMs >= sourceStat.mtimeMs;
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return false;
    }

    throw error;
  }
};
