export const normalizeRecentFolders = (folders: string[], maxRecentFolders: number): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const folder of folders) {
    const trimmedFolder = folder.trim();
    if (!trimmedFolder || seen.has(trimmedFolder)) {
      continue;
    }

    seen.add(trimmedFolder);
    normalized.push(trimmedFolder);

    if (normalized.length === maxRecentFolders) {
      break;
    }
  }

  return normalized;
};

export const addRecentFolderPath = (
  folders: string[],
  folderPath: string,
  maxRecentFolders: number
): string[] => {
  return normalizeRecentFolders([folderPath, ...folders], maxRecentFolders);
};

export const removeRecentFolderPath = (folders: string[], folderPath: string): string[] => {
  return folders.filter((folder) => folder !== folderPath);
};
