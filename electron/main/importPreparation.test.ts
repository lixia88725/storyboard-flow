import { it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import { prepareImportStaging } from "./importPreparation";
import { ImportRecoveryIncompleteError } from "./importRecovery";
import { ProtectedLayerWriteError } from "./protectedLayerFileWriter";
import { workspaceEffectFailure } from "./workspaceEffectFailure";

const faults = vi.hoisted(() => ({ identityPath: "" }));
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, lstat: async (...args: Parameters<typeof fs.lstat>) => {
    if (args[0] === faults.identityPath) throw new Error("controlled identity read failure after mkdir");
    return actual.lstat(...args);
  } };
});
afterEach(() => { faults.identityPath = ""; });

it("actual exclusive mkdir followed by failed identity read retains its directory and plain workspace path", async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR!, "f4-identity-"));
  const directory = path.join(root, "staging"); faults.identityPath = directory;
  const prepare = vi.fn(async () => "never");
  try {
    const error = await prepareImportStaging(directory, prepare).catch(error => error);
    expect(error).toBeInstanceOf(ImportRecoveryIncompleteError);
    expect(prepare).not.toHaveBeenCalled();
    expect((await fs.stat(directory)).isDirectory()).toBe(true);
    expect(workspaceEffectFailure(error, "save").error.retainedPaths).toContain(directory);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it("an existing UUID namespace never grants cleanup authority", async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR!, "f4-existing-"));
  const directory = path.join(root, "staging"); await fs.mkdir(directory);
  const asset = path.join(directory, "user.png"); await fs.writeFile(asset, "unowned bytes");
  const prepare = vi.fn(async () => "never");
  try {
    await expect(prepareImportStaging(directory, prepare)).rejects.toMatchObject({ code: "EEXIST" });
    expect(prepare).not.toHaveBeenCalled(); expect(await fs.readFile(asset, "utf8")).toBe("unowned bytes");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it("a drained aggregate unknown effect preserves the whole namespace, source and all reported native paths", async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR!, "f4-aggregate-"));
  const directory = path.join(root, "staging"), source = path.join(root, "original.tiff");
  await fs.writeFile(source, "original TIFF bytes");
  const unknown = new ProtectedLayerWriteError("unknown", source, "unknown effect", path.join(directory, "user.png"));
  const primary = new AggregateError([new Error("first encoder failure"), unknown]);
  try {
    const error = await prepareImportStaging(directory, async () => {
      await fs.writeFile(path.join(directory, "user.png"), "uncertain user asset"); throw primary;
    }).catch(error => error);
    expect(error).toBeInstanceOf(ImportRecoveryIncompleteError);
    const plain = workspaceEffectFailure(error, "save");
    expect(plain.error.retainedPaths).toEqual(expect.arrayContaining([source, directory, unknown.retainedTemporary]));
    expect(await fs.readFile(source, "utf8")).toBe("original TIFF bytes");
    expect(await fs.readFile(path.join(directory, "user.png"), "utf8")).toBe("uncertain user asset");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
