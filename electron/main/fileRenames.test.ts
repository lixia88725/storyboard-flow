import { describe, expect, it, vi } from "vitest";
import {
  applyFileMoves,
  applyFileRenamePlan,
  applyFileReplacements,
  atomicWriteTextFile,
  replaceFileWithTemp
} from "./fileRenames.js";

describe("applyFileRenamePlan", () => {
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
    expect(rename).toHaveBeenCalledWith("/scene/final-a.png", "/scene/a.png");
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
    expect(rename).toHaveBeenCalledWith("/scene/final-a.png", "/scene/a.png");
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
    expect(unlink).toHaveBeenCalledWith("/scene/a.tiff");
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
    expect(unlink).toHaveBeenCalledWith("/scene/a.tiff");
  });
});
