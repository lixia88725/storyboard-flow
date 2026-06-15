import { readFile as readFileFromDisk } from "node:fs/promises";

type ReadFile = (path: string, encoding: BufferEncoding) => Promise<string>;

type ProjectMetadataOptions = {
  readFile?: ReadFile;
};

export const readProjectMetadata = async <Project>(
  metadataPath: string,
  { readFile = readFileFromDisk }: ProjectMetadataOptions = {}
): Promise<Project | undefined> => {
  try {
    const contents = await readFile(metadataPath, "utf8");
    return JSON.parse(contents) as Project;
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
};
