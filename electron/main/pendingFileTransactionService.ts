import path from "node:path";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { atomicWriteTextFile } from "./fileRenames.js";
import { assertPathInsideFolder, ensureDirectory } from "./pathSafety.js";

type PendingFileMove = { fromPath: string; toPath: string };

type PendingFileTransaction = {
  version: 1;
  moves: PendingFileMove[];
};

type ProjectWithImagePaths = {
  shots: Array<{ imagePath: string }>;
  parkedShots?: Array<{ imagePath: string }>;
};

const journalPath = (folderPath: string): string =>
  path.join(folderPath, ".storyboard-workbench", "pending-file-transaction.json");

const errorCode = (error: unknown): unknown =>
  typeof error === "object" && error && "code" in error ? error.code : undefined;

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return false;
    }
    throw error;
  }
};

const validateMoves = (folderPath: string, moves: PendingFileMove[]): PendingFileMove[] => {
  for (const move of moves) {
    assertPathInsideFolder(folderPath, move.fromPath);
    assertPathInsideFolder(folderPath, move.toPath);
  }
  return moves;
};

const readTransaction = async (folderPath: string): Promise<PendingFileTransaction | undefined> => {
  try {
    const parsed = JSON.parse(await readFile(journalPath(folderPath), "utf8")) as Partial<PendingFileTransaction>;
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.moves) ||
      parsed.moves.some(
        (move) =>
          !move || typeof move.fromPath !== "string" || typeof move.toPath !== "string"
      )
    ) {
      throw new Error("Pending file transaction journal is invalid");
    }
    return { version: 1, moves: validateMoves(folderPath, parsed.moves) };
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return undefined;
    }
    throw error;
  }
};

export const beginPendingFileTransaction = async (
  folderPath: string,
  moves: PendingFileMove[]
): Promise<{ commit: () => Promise<void>; rollback: () => Promise<void> }> => {
  const filePath = journalPath(folderPath);
  const transaction: PendingFileTransaction = {
    version: 1,
    moves: validateMoves(folderPath, moves)
  };
  await atomicWriteTextFile(filePath, `${JSON.stringify(transaction, null, 2)}\n`, {
    mkdir: ensureDirectory,
    writeFile,
    rename,
    unlink
  });
  const clear = () => unlink(filePath).catch((error) => {
    if (errorCode(error) !== "ENOENT") {
      throw error;
    }
  });
  return { commit: clear, rollback: clear };
};

export const recoverPendingFileTransaction = async (
  folderPath: string,
  project: ProjectWithImagePaths | undefined
): Promise<void> => {
  const transaction = await readTransaction(folderPath);
  if (!transaction) {
    return;
  }

  const referencedPaths = new Set([
    ...(project?.shots ?? []).map((shot) => shot.imagePath),
    ...(project?.parkedShots ?? []).map((shot) => shot.imagePath)
  ]);

  for (const move of transaction.moves) {
    const keepDestination = referencedPaths.has(move.toPath);
    const sourceExists = await pathExists(move.fromPath);
    const destinationExists = await pathExists(move.toPath);
    if (keepDestination && !destinationExists && sourceExists) {
      await ensureDirectory(path.dirname(move.toPath));
      await rename(move.fromPath, move.toPath);
    } else if (!keepDestination && destinationExists && !sourceExists) {
      await ensureDirectory(path.dirname(move.fromPath));
      await rename(move.toPath, move.fromPath);
    }
    const expectedPath = keepDestination ? move.toPath : move.fromPath;
    if (!(await pathExists(expectedPath))) {
      throw new Error(`Pending file transaction could not recover ${path.basename(expectedPath)}`);
    }
  }

  await unlink(journalPath(folderPath));
};
