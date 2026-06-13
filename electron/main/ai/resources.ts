import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  aiResourceMetadataForFile,
  normalizeAiResourceMetadata,
  type AiResourceMetadata,
  type AiResourceMetadataItem
} from "./context.js";

export type ListedAiResource = AiResourceMetadataItem & {
  id: string;
  filePath: string;
};

export type ListedAiResources = {
  resourcesFolderPath: string;
  metadataPath: string;
  resources: ListedAiResource[];
};

export type ImportedAiResources = ListedAiResources & {
  importedFileNames: string[];
};

const aiResourcesFolderName = "AI Resources";
const aiResourcesMetadataFileName = "ai-resources.json";
const supportedResourceExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff"]);

export const aiResourcesFolderPath = (folderPath: string): string =>
  path.join(folderPath, aiResourcesFolderName);

export const aiResourceMetadataPath = (folderPath: string): string =>
  path.join(aiResourcesFolderPath(folderPath), aiResourcesMetadataFileName);

export const isSupportedAiResourceFileName = (fileName: string): boolean =>
  supportedResourceExtensions.has(path.extname(fileName).toLowerCase());

const safeJsonParse = (contents: string): unknown => {
  try {
    return JSON.parse(contents);
  } catch {
    return undefined;
  }
};

export const readAiResourceMetadata = async (
  folderPath: string,
  knownFileNames: string[]
): Promise<AiResourceMetadata> => {
  try {
    const contents = await readFile(aiResourceMetadataPath(folderPath), "utf8");
    return normalizeAiResourceMetadata(safeJsonParse(contents), knownFileNames);
  } catch {
    return normalizeAiResourceMetadata(undefined, knownFileNames);
  }
};

export const writeAiResourceMetadata = async (
  folderPath: string,
  metadata: AiResourceMetadata
): Promise<AiResourceMetadata> => {
  const resourcesFolder = aiResourcesFolderPath(folderPath);
  await mkdir(resourcesFolder, { recursive: true });
  const knownFileNames = metadata.resources.map((item) => item.fileName);
  const normalized = normalizeAiResourceMetadata(metadata, knownFileNames);
  await writeFile(aiResourceMetadataPath(folderPath), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
};

export const listAiResources = async (folderPath: string): Promise<ListedAiResources> => {
  const resourcesFolder = aiResourcesFolderPath(folderPath);
  await mkdir(resourcesFolder, { recursive: true });
  const dirents = await readdir(resourcesFolder, { withFileTypes: true });
  const fileNames = dirents
    .filter((dirent) => dirent.isFile())
    .map((dirent) => dirent.name)
    .filter((fileName) => supportedResourceExtensions.has(path.extname(fileName).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
  const metadata = await readAiResourceMetadata(folderPath, fileNames);
  await writeAiResourceMetadata(folderPath, metadata);

  return {
    resourcesFolderPath: resourcesFolder,
    metadataPath: aiResourceMetadataPath(folderPath),
    resources: fileNames.map((fileName) => ({
      ...aiResourceMetadataForFile(metadata, fileName),
      id: fileName,
      fileName,
      filePath: path.join(resourcesFolder, fileName)
    }))
  };
};

const uniqueResourceFileName = async (
  resourcesFolder: string,
  fileName: string,
  reservedFileNames: Set<string>
): Promise<string> => {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  let candidate = fileName;
  let index = 1;
  while (reservedFileNames.has(candidate)) {
    candidate = `${baseName}-${index}${extension}`;
    index += 1;
  }
  try {
    await readFile(path.join(resourcesFolder, candidate));
    reservedFileNames.add(candidate);
    return uniqueResourceFileName(resourcesFolder, fileName, reservedFileNames);
  } catch {
    reservedFileNames.add(candidate);
    return candidate;
  }
};

export const importAiResourceFiles = async (
  folderPath: string,
  sourceFilePaths: string[]
): Promise<ImportedAiResources> => {
  const resourcesFolder = aiResourcesFolderPath(folderPath);
  await mkdir(resourcesFolder, { recursive: true });
  const existingFileNames = new Set(
    (await readdir(resourcesFolder, { withFileTypes: true }))
      .filter((dirent) => dirent.isFile())
      .map((dirent) => dirent.name)
  );
  const importedFileNames: string[] = [];

  for (const sourceFilePath of sourceFilePaths) {
    const fileName = path.basename(sourceFilePath);
    if (!isSupportedAiResourceFileName(fileName)) {
      continue;
    }
    const targetFileName = await uniqueResourceFileName(resourcesFolder, fileName, existingFileNames);
    await copyFile(sourceFilePath, path.join(resourcesFolder, targetFileName));
    importedFileNames.push(targetFileName);
  }

  return {
    ...(await listAiResources(folderPath)),
    importedFileNames
  };
};

export const deleteAiResourceFile = async (
  folderPath: string,
  fileName: string
): Promise<ListedAiResources> => {
  if (path.basename(fileName) !== fileName || !isSupportedAiResourceFileName(fileName)) {
    throw new Error("Invalid AI resource file name");
  }
  await unlink(path.join(aiResourcesFolderPath(folderPath), fileName));
  return listAiResources(folderPath);
};
