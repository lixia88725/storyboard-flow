import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applyFileMoves,
  applyFileRenamePlan,
  applyFileReplacements,
  atomicWriteTextFile,
  replaceFileWithTemp
} from "./fileRenames.js";

describe("applyFileRenamePlan", () => {
  const fixtureDirectories: string[] = [];
  afterEach(async () => {
    await Promise.all(fixtureDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true })
    ));
  });

  const createCycle = async (names: string[]) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rename-rollback-"));
    fixtureDirectories.push(directory);
    const plan = names.map((name, index) => ({
      shotId: name,
      fromPath: path.join(directory, `${name}.png`),
      temporaryPath: path.join(directory, `.renaming-${name}.png`),
      finalPath: path.join(directory, `${names[(index + 1) % names.length]}.png`),
      finalFileName: `${names[(index + 1) % names.length]}.png`
    }));
    await Promise.all(plan.map((item) => fs.writeFile(item.fromPath, `original-${item.shotId}`)));
    const ops = {
      mkdir: async (directoryPath: string) => { await fs.mkdir(directoryPath, { recursive: true }); },
      rename: vi.fn(async (from: string, to: string) => fs.rename(from, to))
    };
    const expectRestored = async () => {
      for (const item of plan) {
        expect(await fs.readFile(item.fromPath, "utf8")).toBe(`original-${item.shotId}`);
      }
      expect((await fs.readdir(directory)).sort()).toEqual(names.map((name) => `${name}.png`).sort());
    };
    return { directory, plan, ops, expectRestored };
  };

  it.each([["a", "b"], ["a", "b", "c"]])("restores every byte in a real filesystem cycle starting at %s", async (...names) => {
    const { plan, ops, expectRestored } = await createCycle(names);
    const applied = await applyFileRenamePlan(plan, ops);
    for (const item of plan) {
      expect(await fs.readFile(item.finalPath, "utf8")).toBe(`original-${item.shotId}`);
    }
    await applied.rollback();
    await expectRestored();
  });

  it.each([1, 2, 3, 4, 5, 6])("restores real files after forward rename %i fails", async (failureCall) => {
    const { plan, ops, expectRestored } = await createCycle(["a", "b", "c"]);
    const failure = new Error("forward failed");
    let calls = 0;
    ops.rename.mockImplementation(async (from, to) => {
      if (++calls === failureCall) throw failure;
      await fs.rename(from, to);
    });
    await expect(applyFileRenamePlan(plan, ops)).rejects.toBe(failure);
    await expectRestored();
  });

  it.each([1, 2, 3, 4, 5, 6])("stops and preserves every asset when rollback rename %i fails, then permits retry", async (failureCall) => {
    const { directory, plan, ops, expectRestored } = await createCycle(["a", "b", "c"]);
    const applied = await applyFileRenamePlan(plan, ops);
    const failure = new Error("rollback failed");
    let calls = 0;
    ops.rename.mockImplementation(async (from, to) => {
      if (++calls === failureCall) throw failure;
      await fs.rename(from, to);
    });
    await expect(applied.rollback()).rejects.toBe(failure);
    expect(calls).toBe(failureCall);
    const contents = await Promise.all((await fs.readdir(directory)).map((name) =>
      fs.readFile(path.join(directory, name), "utf8")
    ));
    expect(contents.sort()).toEqual(["original-a", "original-b", "original-c"]);
    await applied.rollback();
    await expectRestored();
    const callsAfterRestore = calls;
    await applied.rollback();
    expect(calls).toBe(callsAfterRestore);
    await expectRestored();
  });

  it("reports both forward and rollback failures without overwriting recoverable files", async () => {
    const { directory, plan, ops } = await createCycle(["a", "b"]);
    const forwardFailure = new Error("forward failed");
    const rollbackFailure = new Error("rollback failed");
    let calls = 0;
    ops.rename.mockImplementation(async (from, to) => {
      calls++;
      if (calls === 4) throw forwardFailure;
      if (calls === 5) throw rollbackFailure;
      await fs.rename(from, to);
    });
    await expect(applyFileRenamePlan(plan, ops)).rejects.toMatchObject({
      message: expect.stringContaining("rollback failed"),
      errors: [forwardFailure, rollbackFailure],
      recoveryIncomplete: true
    });
    expect(calls).toBe(5);
    expect(await fs.readFile(plan[0].finalPath, "utf8")).toBe("original-a");
    expect(await fs.readFile(plan[1].temporaryPath, "utf8")).toBe("original-b");
    expect((await fs.readdir(directory)).length).toBe(2);
  });

  it("returns applied renames that can restore final paths", async () => {
    const existingPaths = new Set(["/scene/a.png"]);
    const rename = vi.fn(async (fromPath: string, toPath: string) => {
      existingPaths.delete(fromPath);
      existingPaths.add(toPath);
    });
    const mkdir = vi.fn(async () => undefined);

    const applied = await applyFileRenamePlan(
      [
        {
          shotId: "shot-a",
          fromPath: "/scene/a.png",
          temporaryPath: "/scene/.storyboard-renaming-shot-a.png",
          finalPath: "/scene/final-a.png",
          finalFileName: "final-a.png"
        }
      ],
      { mkdir, rename }
    );

    await applied.rollback();

    expect(existingPaths.has("/scene/a.png")).toBe(true);
    expect(existingPaths.has("/scene/final-a.png")).toBe(false);
    expect(rename).toHaveBeenCalledWith("/scene/final-a.png", "/scene/.storyboard-renaming-shot-a.png");
    expect(rename).toHaveBeenCalledWith("/scene/.storyboard-renaming-shot-a.png", "/scene/a.png");
  });

  it("rolls back temporary renames when a final rename fails", async () => {
    const existingPaths = new Set(["/scene/a.png", "/scene/b.png"]);
    const rename = vi.fn(async (fromPath: string, toPath: string) => {
      if (toPath === "/scene/final-b.png") {
        throw new Error("final rename failed");
      }

      existingPaths.delete(fromPath);
      existingPaths.add(toPath);
    });
    const mkdir = vi.fn(async () => undefined);

    await expect(
      applyFileRenamePlan(
        [
          {
            shotId: "shot-a",
            fromPath: "/scene/a.png",
            temporaryPath: "/scene/.storyboard-renaming-shot-a.png",
            finalPath: "/scene/final-a.png",
            finalFileName: "final-a.png"
          },
          {
            shotId: "shot-b",
            fromPath: "/scene/b.png",
            temporaryPath: "/scene/.storyboard-renaming-shot-b.png",
            finalPath: "/scene/final-b.png",
            finalFileName: "final-b.png"
          }
        ],
        { mkdir, rename }
      )
    ).rejects.toThrow("final rename failed");

    expect(existingPaths.has("/scene/a.png")).toBe(true);
    expect(existingPaths.has("/scene/b.png")).toBe(true);
    expect(existingPaths.has("/scene/.storyboard-renaming-shot-a.png")).toBe(false);
    expect(existingPaths.has("/scene/.storyboard-renaming-shot-b.png")).toBe(false);
    expect(existingPaths.has("/scene/final-a.png")).toBe(false);
    expect(rename).toHaveBeenCalledWith("/scene/final-a.png", "/scene/.storyboard-renaming-shot-a.png");
    expect(rename).toHaveBeenCalledWith("/scene/.storyboard-renaming-shot-a.png", "/scene/a.png");
    expect(rename).toHaveBeenCalledWith("/scene/.storyboard-renaming-shot-b.png", "/scene/b.png");
  });
});

describe("applyFileMoves", () => {
  it("rolls back moved files when a later move fails", async () => {
    const existingPaths = new Set(["/scene/a.png", "/scene/b.png"]);
    const rename = vi.fn(async (fromPath: string, toPath: string) => {
      if (toPath === "/archive/b.png") {
        throw new Error("archive move failed");
      }

      existingPaths.delete(fromPath);
      existingPaths.add(toPath);
    });
    const mkdir = vi.fn(async () => undefined);

    await expect(
      applyFileMoves(
        [
          { fromPath: "/scene/a.png", toPath: "/archive/a.png" },
          { fromPath: "/scene/b.png", toPath: "/archive/b.png" }
        ],
        { mkdir, rename }
      )
    ).rejects.toThrow("archive move failed");

    expect(existingPaths.has("/scene/a.png")).toBe(true);
    expect(existingPaths.has("/scene/b.png")).toBe(true);
    expect(existingPaths.has("/archive/a.png")).toBe(false);
    expect(rename).toHaveBeenCalledWith("/archive/a.png", "/scene/a.png");
  });

  it("returns applied moves that can be rolled back after later import work fails", async () => {
    const existingPaths = new Set(["/tmp/a.tiff"]);
    const rename = vi.fn(async (fromPath: string, toPath: string) => {
      existingPaths.delete(fromPath);
      existingPaths.add(toPath);
    });
    const mkdir = vi.fn(async () => undefined);

    const applied = await applyFileMoves(
      [{ fromPath: "/tmp/a.tiff", toPath: "/scene/a.tiff" }],
      { mkdir, rename }
    );

    await applied.rollback();

    expect(existingPaths.has("/tmp/a.tiff")).toBe(true);
    expect(existingPaths.has("/scene/a.tiff")).toBe(false);
    expect(rename).toHaveBeenCalledWith("/scene/a.tiff", "/tmp/a.tiff");
  });
});

describe("replaceFileWithTemp", () => {
  it("deletes the temp file when replacing the target fails", async () => {
    const existingPaths = new Set(["/scene/.storyboard-metadata-shot.tiff", "/scene/shot.tiff"]);
    const rename = vi.fn(async () => {
      throw new Error("replace failed");
    });
    const unlink = vi.fn(async (filePath: string) => {
      existingPaths.delete(filePath);
    });

    await expect(
      replaceFileWithTemp("/scene/.storyboard-metadata-shot.tiff", "/scene/shot.tiff", {
        rename,
        unlink
      })
    ).rejects.toThrow("replace failed");

    expect(existingPaths.has("/scene/.storyboard-metadata-shot.tiff")).toBe(false);
    expect(existingPaths.has("/scene/shot.tiff")).toBe(true);
    expect(unlink).toHaveBeenCalledWith("/scene/.storyboard-metadata-shot.tiff");
  });
});

describe("atomicWriteTextFile", () => {
  it("writes text to a temp file before replacing the target", async () => {
    const writes = new Map<string, string>();
    const mkdir = vi.fn(async () => undefined);
    const writeFile = vi.fn(async (filePath: string, content: string) => {
      writes.set(filePath, content);
    });
    const rename = vi.fn(async (fromPath: string, toPath: string) => {
      const content = writes.get(fromPath);
      if (content === undefined) {
        throw new Error(`missing ${fromPath}`);
      }
      writes.delete(fromPath);
      writes.set(toPath, content);
    });
    const unlink = vi.fn(async (filePath: string) => {
      writes.delete(filePath);
    });

    await atomicWriteTextFile("/scene/.storyboard-workbench/storyboard.project.json", "new metadata", {
      mkdir,
      writeFile,
      rename,
      unlink,
      tempPath: "/scene/.storyboard-workbench/.storyboard.project.json.tmp"
    });

    expect(mkdir).toHaveBeenCalledWith("/scene/.storyboard-workbench");
    expect(writeFile).toHaveBeenCalledWith(
      "/scene/.storyboard-workbench/.storyboard.project.json.tmp",
      "new metadata",
      "utf8"
    );
    expect(rename).toHaveBeenCalledWith(
      "/scene/.storyboard-workbench/.storyboard.project.json.tmp",
      "/scene/.storyboard-workbench/storyboard.project.json"
    );
    expect(writes.get("/scene/.storyboard-workbench/storyboard.project.json")).toBe("new metadata");
  });

  it("deletes the temp file when replacement fails", async () => {
    const writes = new Map<string, string>();
    const unlink = vi.fn(async (filePath: string) => {
      writes.delete(filePath);
    });

    await expect(
      atomicWriteTextFile("/scene/storyboard.project.json", "new metadata", {
        mkdir: vi.fn(async () => undefined),
        writeFile: vi.fn(async (filePath: string, content: string) => {
          writes.set(filePath, content);
        }),
        rename: vi.fn(async () => {
          throw new Error("rename failed");
        }),
        unlink,
        tempPath: "/scene/.storyboard.project.json.tmp"
      })
    ).rejects.toThrow("rename failed");

    expect(unlink).toHaveBeenCalledWith("/scene/.storyboard.project.json.tmp");
    expect(writes.has("/scene/.storyboard.project.json.tmp")).toBe(false);
  });

  it("deletes the temp file when writing fails", async () => {
    const writes = new Map([["/scene/.storyboard.project.json.tmp", "partial"]]);
    const unlink = vi.fn(async (filePath: string) => {
      writes.delete(filePath);
    });

    await expect(
      atomicWriteTextFile("/scene/storyboard.project.json", "new metadata", {
        mkdir: vi.fn(async () => undefined),
        writeFile: vi.fn(async () => {
          throw new Error("write failed");
        }),
        rename: vi.fn(async () => undefined),
        unlink,
        tempPath: "/scene/.storyboard.project.json.tmp"
      })
    ).rejects.toThrow("write failed");

    expect(unlink).toHaveBeenCalledWith("/scene/.storyboard.project.json.tmp");
    expect(writes.has("/scene/.storyboard.project.json.tmp")).toBe(false);
  });
});

describe("applyFileReplacements", () => {
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
  });
  const fixture = async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "replacement-recovery-"));
    directories.push(directory);
    const items = ["a", "b"].map((name) => ({
      targetPath: path.join(directory, `${name}.tiff`),
      tempPath: path.join(directory, `${name}.temp`),
      backupPath: path.join(directory, `${name}.backup`)
    }));
    for (const [index, item] of items.entries()) {
      await fs.writeFile(item.targetPath, Buffer.from([index, 0, 255]));
      await fs.writeFile(item.tempPath, Buffer.from([index, 1, 254]));
    }
    const ops = {
      mkdir: async (dir: string) => { await fs.mkdir(dir, { recursive: true }); },
      rename: vi.fn(async (from: string, to: string) => fs.rename(from, to)),
      unlink: vi.fn(async (file: string) => fs.unlink(file))
    };
    const originals = async () => {
      for (const [index, item] of items.entries()) {
        expect(await fs.readFile(item.targetPath)).toEqual(Buffer.from([index, 0, 255]));
      }
    };
    const allBytes = async () => {
      const bytes = await Promise.all((await fs.readdir(directory)).map((name) => fs.readFile(path.join(directory, name))));
      expect(bytes.map((value) => value.toString("hex")).sort()).toEqual(["0000ff", "0001fe", "0100ff", "0101fe"]);
    };
    return { items, ops, originals, allBytes };
  };

  it.each([1, 2, 3, 4])("rejects restore move %i without losing bytes, resumes progress and makes repeated rollback harmless", async (failureCall) => {
    const f = await fixture();
    const applied = await applyFileReplacements(f.items, f.ops);
    let calls = 0;
    f.ops.rename.mockImplementation(async (from, to) => {
      if (++calls === failureCall) throw new Error("restore failed");
      await fs.rename(from, to);
    });
    await expect(applied.rollback()).rejects.toThrow("restore failed");
    expect(calls).toBe(failureCall);
    await f.allBytes();
    await applied.rollback();
    await f.originals();
    await f.allBytes();
    const restoredCalls = calls;
    await applied.rollback();
    expect(calls).toBe(restoredCalls);
    await f.originals();
  });
  it.each([1, 2, 3, 4])("restores original bytes after backup/install move %i fails", async (failureCall) => {
    const f = await fixture();
    const failure = new Error("apply failed");
    let calls = 0;
    f.ops.rename.mockImplementation(async (from, to) => {
      if (++calls === failureCall) throw failure;
      await fs.rename(from, to);
    });
    await expect(applyFileReplacements(f.items, f.ops)).rejects.toBe(failure);
    await f.originals();
    await f.allBytes();
  });

  it.each([5, 6, 7])("reports apply and automatic recovery errors at move %i without a handle or lost bytes", async (restoreCall) => {
    const f = await fixture();
    const forward = new Error("install failed");
    const restore = new Error("automatic restore failed");
    let calls = 0;
    f.ops.rename.mockImplementation(async (from, to) => {
      if (++calls === 4) throw forward;
      if (calls === restoreCall) throw restore;
      await fs.rename(from, to);
    });
    await expect(applyFileReplacements(f.items, f.ops)).rejects.toMatchObject({
      name: "FileReplacementRecoveryIncompleteError", recoveryIncomplete: true,
      errors: [forward, restore], message: expect.stringMatching(/install failed.*automatic restore failed/)
    });
    expect(calls).toBe(restoreCall);
    await f.allBytes();
  });

  it.each([0, 1, 2])("protects committed targets and reports backup cleanup failure %i, allowing cleanup retry", async (failureCall) => {
    const f = await fixture();
    const applied = await applyFileReplacements(f.items, f.ops);
    const cleanupError = new Error("backup cleanup failed");
    let calls = 0;
    f.ops.unlink.mockImplementation(async (file) => {
      if (++calls === failureCall) throw cleanupError;
      await fs.unlink(file);
    });
    if (failureCall) {
      await expect(applied.commit()).rejects.toBe(cleanupError);
      for (const item of f.items.slice(failureCall - 1)) expect(await fs.readFile(item.backupPath)).toBeDefined();
    } else {
      await applied.commit();
    }
    const moveCalls = f.ops.rename.mock.calls.length;
    await expect(applied.rollback()).rejects.toMatchObject({ recoveryIncomplete: true,
      message: expect.stringMatching(/commit.*rollback/i) });
    expect(f.ops.rename).toHaveBeenCalledTimes(moveCalls);
    for (const [index, item] of f.items.entries()) {
      expect(await fs.readFile(item.targetPath)).toEqual(Buffer.from([index, 1, 254]));
    }
    await applied.commit();
    const cleanedCalls = calls;
    await applied.commit();
    expect(calls).toBe(cleanedCalls);
    for (const item of f.items) await expect(fs.stat(item.backupPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cannot commit after rollback has begun", async () => {
    const f = await fixture();
    const applied = await applyFileReplacements(f.items, f.ops);
    f.ops.rename.mockRejectedValueOnce(new Error("restore failed"));
    await expect(applied.rollback()).rejects.toThrow("restore failed");
    await expect(applied.commit()).rejects.toThrow(/rollback/i);
    expect(f.ops.unlink).not.toHaveBeenCalled();
    await f.allBytes();
    await applied.rollback();
    await f.originals();
    await expect(applied.commit()).rejects.toThrow(/rollback|restored/i);
  });

  it("returns applied replacements that can restore originals", async () => {
    const existingPaths = new Map([
      ["/scene/a.tiff", "original-a"],
      ["/tmp/a.tiff", "new-a"]
    ]);
    const rename = vi.fn(async (fromPath: string, toPath: string) => {
      const value = existingPaths.get(fromPath);
      if (value === undefined) {
        throw new Error(`missing ${fromPath}`);
      }
      existingPaths.delete(fromPath);
      existingPaths.set(toPath, value);
    });
    const mkdir = vi.fn(async () => undefined);
    const unlink = vi.fn(async (filePath: string) => {
      existingPaths.delete(filePath);
    });

    const applied = await applyFileReplacements(
      [
        {
          tempPath: "/tmp/a.tiff",
          targetPath: "/scene/a.tiff",
          backupPath: "/scene/.storyboard-workbench/save-backup/save-123/a.tiff"
        }
      ],
      { mkdir, rename, unlink }
    );

    expect(existingPaths.get("/scene/a.tiff")).toBe("new-a");

    await applied.rollback();

    expect(existingPaths.get("/scene/a.tiff")).toBe("original-a");
    expect(existingPaths.has("/scene/.storyboard-workbench/save-backup/save-123/a.tiff")).toBe(false);
    expect(existingPaths.get("/tmp/a.tiff")).toBe("new-a");
    expect(unlink).not.toHaveBeenCalled();
  });

  it("rolls back original files when a later replacement fails", async () => {
    const existingPaths = new Map([
      ["/scene/a.tiff", "original-a"],
      ["/scene/b.tiff", "original-b"],
      ["/tmp/a.tiff", "new-a"],
      ["/tmp/b.tiff", "new-b"]
    ]);
    const rename = vi.fn(async (fromPath: string, toPath: string) => {
      if (fromPath === "/tmp/b.tiff" && toPath === "/scene/b.tiff") {
        throw new Error("replace failed");
      }

      const value = existingPaths.get(fromPath);
      if (value === undefined) {
        throw new Error(`missing ${fromPath}`);
      }
      existingPaths.delete(fromPath);
      existingPaths.set(toPath, value);
    });
    const mkdir = vi.fn(async () => undefined);
    const unlink = vi.fn(async (filePath: string) => {
      existingPaths.delete(filePath);
    });

    await expect(
      applyFileReplacements(
        [
          {
            tempPath: "/tmp/a.tiff",
            targetPath: "/scene/a.tiff",
            backupPath: "/scene/.storyboard-workbench/save-backup/save-123/a.tiff"
          },
          {
            tempPath: "/tmp/b.tiff",
            targetPath: "/scene/b.tiff",
            backupPath: "/scene/.storyboard-workbench/save-backup/save-123/b.tiff"
          }
        ],
        { mkdir, rename, unlink }
      )
    ).rejects.toThrow("replace failed");

    expect(existingPaths.get("/scene/a.tiff")).toBe("original-a");
    expect(existingPaths.get("/scene/b.tiff")).toBe("original-b");
    expect(existingPaths.has("/scene/.storyboard-workbench/save-backup/save-123/a.tiff")).toBe(false);
    expect(existingPaths.has("/scene/.storyboard-workbench/save-backup/save-123/b.tiff")).toBe(false);
    expect(existingPaths.get("/tmp/a.tiff")).toBe("new-a");
    expect(unlink).not.toHaveBeenCalled();
  });
});
