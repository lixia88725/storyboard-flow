import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  beginPendingFileTransaction,
  recoverPendingFileTransaction
} from "./pendingFileTransactionService.js";

const temporaryFolders: string[] = [];

const createScene = async () => {
  const folderPath = await mkdtemp(path.join(os.tmpdir(), "storyboard-pending-transaction-"));
  temporaryFolders.push(folderPath);
  await mkdir(path.join(folderPath, "Pending"), { recursive: true });
  return folderPath;
};

afterEach(async () => {
  await Promise.all(temporaryFolders.splice(0).map((folderPath) => rm(folderPath, { recursive: true })));
});

describe("pending file transaction recovery", () => {
  it("rolls a completed move back when project metadata still references the source", async () => {
    const folderPath = await createScene();
    const sourcePath = path.join(folderPath, "shot.tiff");
    const destinationPath = path.join(folderPath, "Pending", "shot.tiff");
    await writeFile(sourcePath, "pixels");
    await beginPendingFileTransaction(folderPath, [{ fromPath: sourcePath, toPath: destinationPath }]);
    await rename(sourcePath, destinationPath);

    await recoverPendingFileTransaction(folderPath, {
      shots: [{ imagePath: sourcePath }],
      parkedShots: []
    });

    await expect(readFile(sourcePath, "utf8")).resolves.toBe("pixels");
    await expect(readFile(destinationPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the destination when project metadata already references it", async () => {
    const folderPath = await createScene();
    const sourcePath = path.join(folderPath, "shot.tiff");
    const destinationPath = path.join(folderPath, "Pending", "shot.tiff");
    await writeFile(sourcePath, "pixels");
    await beginPendingFileTransaction(folderPath, [{ fromPath: sourcePath, toPath: destinationPath }]);
    await rename(sourcePath, destinationPath);

    await recoverPendingFileTransaction(folderPath, {
      shots: [],
      parkedShots: [{ imagePath: destinationPath }]
    });

    await expect(readFile(destinationPath, "utf8")).resolves.toBe("pixels");
    await expect(readFile(sourcePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
