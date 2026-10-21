import { expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { createWorkspacePendingAppHandlers } from "./workspacePendingAppRuntime";
import { beginPendingFileTransaction, hasPendingFileTransaction } from "./pendingFileTransactionService";
import { applyFileReplacements } from "./fileRenames";

it.each(["park", "restore"] as const)("real Pending %s retains published locations, materialization backup and journal after persist rejects", async direction => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pending-publication-recovery-"));
  try {
    const source = path.join(root, direction === "park" ? "source.tiff" : "Pending/source.tiff");
    await fs.mkdir(path.dirname(source), { recursive: true });
    const old = await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).tiff().toBuffer();
    const fresh = await sharp({ create: { width: 2, height: 2, channels: 4, background: "blue" } }).tiff().toBuffer();
    await fs.writeFile(source, old);
    const backup = path.join(root, "original.backup"), temp = path.join(root, "materialized.tiff");
    const rollback = vi.fn(), commit = vi.fn(), journalRollback = vi.fn();
    const metadataPath = path.join(root, ".storyboard-workbench/project.json");
    const project = { shots: [{ id: "s", imagePath: source, fileName: "source.tiff" }] };
    const handlers = createWorkspacePendingAppHandlers({
      uniquePath: async (folder, name) => path.join(folder, name),
      materializeShots: async () => {
        await fs.writeFile(temp, fresh);
        const applied = await applyFileReplacements([{ tempPath: temp, targetPath: source, backupPath: backup }], {
          mkdir: async dir => { await fs.mkdir(dir, { recursive: true }); }, rename: fs.rename, unlink: fs.unlink
        });
        return { rollback: async () => { rollback(); await applied.rollback(); }, commit: async () => { commit(); await applied.commit(); } };
      },
      beginTransaction: async (folder, moves) => {
        const actual = await beginPendingFileTransaction(folder, moves);
        return { commit: actual.commit, rollback: async () => { journalRollback(); await actual.rollback(); } };
      },
      persistProject: async (target, value) => {
        await fs.writeFile(target, JSON.stringify(value));
        throw new Error("persist rejected after JSON publication");
      }
    });
    const action = direction === "park" ? handlers.moveShotsToPending : handlers.restoreShotsFromPending;
    await expect(action({ folderPath: root, metadataPath, project }, ["s"])).rejects.toMatchObject({ recoveryIncomplete: true });
    const written = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    expect(await fs.readFile(written.shots[0].imagePath)).toEqual(direction === "park" ? fresh : old);
    expect(await hasPendingFileTransaction(root)).toBe(true);
    expect(rollback).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled(); expect(journalRollback).not.toHaveBeenCalled();
    if (direction === "park") expect(await fs.readFile(backup)).toEqual(old);
    await expect(fs.lstat(source)).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
