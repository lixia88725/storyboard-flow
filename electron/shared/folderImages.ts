export type FolderImages = {
  folderPath: string;
  files: string[];
  browse: boolean;
};
export type FolderImageRequest = { folderPath: string; fileName: string };
export type FolderImagePreview = { dataUrl: string; width: number; height: number };
export type FolderImageCopy = { folderPath: string; count: number };
