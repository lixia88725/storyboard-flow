type DroppedFile = File & { path?: string };
type DroppedFilePathResolver = (file: File) => string | undefined;

export const markdownPathFromDroppedFiles = (
  droppedFiles: ArrayLike<File>,
  resolveDroppedFilePath: DroppedFilePathResolver | undefined
): string | undefined => {
  const files = Array.from(droppedFiles) as DroppedFile[];
  if (files.length !== 1) {
    return undefined;
  }

  const file = files[0];
  if (!file.name.toLowerCase().endsWith(".md")) {
    return undefined;
  }

  return resolveDroppedFilePath?.(file) || file.path;
};
