import path from "node:path";

export const workspaceCopyTemporaryFileName = (fileName: string, id: string): string => {
  return `.storyboard-copy-${id}-${path.basename(fileName)}`;
};

export const isWorkspaceTemporaryImagePath = (filePath: string): boolean => {
  const name = path.basename(filePath);
  return (
    name.startsWith(".storyboard-renaming-") ||
    name.startsWith(".storyboard-metadata-") ||
    name.startsWith(".storyboard-copy-")
  );
};
