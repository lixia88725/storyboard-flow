import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

export const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return false;
    }

    throw error;
  }
};

export const ensureDirectory = async (directoryPath: string): Promise<void> => {
  await mkdir(directoryPath, { recursive: true });
};

export const assertPathInsideFolder = (folderPath: string, filePath: string): void => {
  const relativePath = path.relative(folderPath, filePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Path must stay inside workspace folder: ${filePath}`);
  }
};
