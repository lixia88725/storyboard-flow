import path from "node:path";
import { createHash } from "node:crypto";
import { manualImageImportAdmission, type ManualImportShot } from "../shared/manualImageImportRules.js";
import { lstat, realpath, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
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

/** Read-only presence/validation; never chooses an asset or clears a journal. */
export const hasPendingFileTransaction = async (folderPath: string): Promise<boolean> =>
  Boolean(await readTransaction(folderPath));

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

  await recoverTransaction(folderPath, project, transaction);
};

const recoverTransaction = async (folderPath: string, project: ProjectWithImagePaths | undefined, transaction: PendingFileTransaction): Promise<void> => {
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

/** Explicit normal recovery is separate from readonly discovery. Validate the
 * entire finite move plan before the first mkdir/rename/unlink; legacy recovery
 * retains its existing policy. This is not a cross-process filesystem lease. */
export const recoverAdmittedNormalPendingFileTransaction = async (
  folderPath: string,
  project: { shots: ManualImportShot[]; parkedShots?: ManualImportShot[]; pendingBake?: unknown } | undefined
): Promise<void> => {
  const transaction = await readTransaction(folderPath);
  if (!transaction) return;
  if (!project || project.pendingBake === undefined) throw new Error("Pending recovery compatibility is unknown");
  const admitted = manualImageImportAdmission(project);
  if (admitted.some(a => a.fresh || !a.entry || a.shot.swb?.status !== "owned")) throw new Error("Pending recovery compatibility is unknown");
  const root = await realpath(folderPath);
  const safeFile = async (file: string) => {
    assertPathInsideFolder(folderPath, file);
    if (!(await lstat(file)).isFile()) throw new Error("Pending recovery assets must be regular files");
    assertPathInsideFolder(root, await realpath(file));
  };
  await safeFile(journalPath(folderPath));
  // Internal artwork must already exist, never repaired as part of admission.
  for (const { shot } of admitted) {
    if (!shot.layers?.length) throw new Error("Pending recovery internal assets are missing");
    for (const raw of shot.layers) {
      const bitmapPath = (raw as { bitmapPath?: unknown })?.bitmapPath;
      if (typeof bitmapPath !== "string" || !bitmapPath.startsWith(".storyboard-workbench/layers/")) throw new Error("Pending recovery assets are invalid");
      await safeFile(path.join(folderPath, bitmapPath)).catch(() => { throw new Error("Pending recovery internal assets are missing or unsafe"); });
    }
  }
  const seen = new Set<string>();
  const seenFiles = new Set<string>();
  // Resolve every endpoint, including absent leaves and the non-selected side.
  // A source parent alias is as unsafe as a destination parent alias. This
  // finite root <-> Pending policy does not introduce symlink-follow semantics.
  for (const move of transaction.moves) {
    for (const endpoint of [move.fromPath, move.toPath]) {
      if (!path.isAbsolute(endpoint)) throw new Error("Pending recovery plan is ambiguous");
      const parent = path.dirname(endpoint);
      if (parent !== folderPath && parent !== path.join(folderPath, "Pending")) throw new Error("Pending recovery paths are unsupported");
      if (!(await lstat(parent)).isDirectory()) throw new Error("Pending recovery directory is unsafe");
      const realParent = await realpath(parent);
      if (realParent !== root) assertPathInsideFolder(root, realParent);
      // Conservative finite-plan policy: like Import's insensitive leaf key,
      // fold the basename with toLowerCase, but do not probe the user's volume.
      // Reject case-only leaves even on case-sensitive volumes: missing leaves
      // have no inode yet, and must not become aliases after the first move.
      // realpath supplies the existing parent's identity; this is not a claim
      // of universal Unicode/filesystem equivalence.
      const resolvedEndpoint = path.join(realParent, path.basename(endpoint).toLowerCase());
      if (seen.has(resolvedEndpoint)) throw new Error("Pending recovery plan has endpoint aliases");
      seen.add(resolvedEndpoint);
      try {
        const info = await lstat(endpoint);
        if (!info.isFile()) throw new Error("Pending recovery assets must be regular files");
        const identity = `${info.dev}:${info.ino}`;
        if (seenFiles.has(identity)) throw new Error("Pending recovery plan has file aliases");
        seenFiles.add(identity);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
      }
    }
  }
  for (const move of transaction.moves) {
    const endpoints = [move.fromPath, move.toPath];
    const parents = endpoints.map(p => path.dirname(p));
    if (!(parents.includes(folderPath) && parents.includes(path.join(folderPath, "Pending"))) || endpoints.some(p => !/\.tiff?$/iu.test(p))) throw new Error("Pending recovery paths are unsupported");
    const matched = admitted.filter(a => endpoints.includes(a.shot.imagePath));
    if (matched.length !== 1) throw new Error("Pending recovery shot identity is ambiguous");
    const exists = await Promise.all(endpoints.map(pathExists));
    if (exists.filter(Boolean).length !== 1) throw new Error("Pending recovery has ambiguous or missing assets; both sides retained");
    const file = endpoints[exists[0] ? 0 : 1];
    await safeFile(file);
    if (createHash("sha256").update(await readFile(file)).digest("hex") !== matched[0].entry!.acceptedOutputIdentity) throw new Error("Pending recovery output identity changed");

  }
  await recoverTransaction(folderPath, project, transaction);
};
