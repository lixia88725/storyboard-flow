import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeRecentFolders } from "./recentFolders.js";

export const defaultMaxRecentFolders = 10;

export const recentFoldersPath = (userDataPath: string): string =>
  path.join(userDataPath, "recent-folders.json");

export const toolRadialMenuPath = (userDataPath: string): string =>
  path.join(userDataPath, "tool-radial-menu.json");

export const readToolRadialMenu = async (userDataPath: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(toolRadialMenuPath(userDataPath), "utf8"));
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
};

export const writeToolRadialMenu = async (userDataPath: string, config: unknown): Promise<unknown> => {
  const settingsPath = toolRadialMenuPath(userDataPath);
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
};

export const readRecentFolders = async (
  userDataPath: string,
  maxRecentFolders = defaultMaxRecentFolders
): Promise<string[]> => {
  return (await readRecentFoldersWithRecovery(userDataPath, maxRecentFolders)).folders;
};

export type RecentFoldersReadResult = {
  folders: string[];
  recoveredFromCorruptFile: boolean;
};

export const readRecentFoldersWithRecovery = async (
  userDataPath: string,
  maxRecentFolders = defaultMaxRecentFolders
): Promise<RecentFoldersReadResult> => {
  try {
    const contents = await readFile(recentFoldersPath(userDataPath), "utf8");
    const parsed = JSON.parse(contents);
    const folders = Array.isArray(parsed)
      ? normalizeRecentFolders(
          parsed.filter((item): item is string => typeof item === "string"),
          maxRecentFolders
        )
      : [];
    return { folders, recoveredFromCorruptFile: false };
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return { folders: [], recoveredFromCorruptFile: false };
    }
    if (error instanceof SyntaxError) {
      await writeRecentFolders(userDataPath, [], maxRecentFolders);
      return { folders: [], recoveredFromCorruptFile: true };
    }

    throw error;
  }
};

export const writeRecentFolders = async (
  userDataPath: string,
  folders: string[],
  maxRecentFolders = defaultMaxRecentFolders
): Promise<string[]> => {
  const normalized = normalizeRecentFolders(folders, maxRecentFolders);
  const settingsPath = recentFoldersPath(userDataPath);
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
};
