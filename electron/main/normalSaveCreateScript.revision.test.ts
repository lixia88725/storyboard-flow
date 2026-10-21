import { afterEach, expect, it, vi } from "vitest";
const fault = vi.hoisted(() => ({ openSuffix: "", unlinkSuffix: "", beforeOpen: undefined as undefined | ((p: string) => Promise<void>), afterReadDir: undefined as undefined | ((p: string) => Promise<void>), beforeUnlink: undefined as undefined | ((p: string) => Promise<void>) }));
vi.mock("node:fs/promises", async importActual => {
  const real = await importActual<typeof import("node:fs/promises")>();
  return { ...real, readdir: async (...args: Parameters<typeof real.readdir>) => {
    const entries = await real.readdir(...args); await fault.afterReadDir?.(String(args[0])); return entries;
  }, open: async (...args: Parameters<typeof real.open>) => {
    await fault.beforeOpen?.(String(args[0]));
    if (fault.openSuffix && String(args[0]).endsWith(fault.openSuffix)) throw new Error("injected create write failure");
    return real.open(...args);
  }, unlink: async (...args: Parameters<typeof real.unlink>) => {
    await fault.beforeUnlink?.(String(args[0]));
    if (fault.unlinkSuffix && String(args[0]).endsWith(fault.unlinkSuffix)) throw new Error("injected rollback failure");
    return real.unlink(...args);
  } };
});
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProjectFromStoryboardScriptMarkdown } from "./storyboardScriptProject";
import { registerWorkspaceScriptIpcHandlers } from "./ipc/workspaceScriptHandlers";
import { decodeNormalSaveImportResult } from "../shared/normalSaveImportIpc";
const dirs: string[] = [];
afterEach(async () => { fault.openSuffix = ""; fault.unlinkSuffix = ""; fault.beforeOpen = undefined; fault.afterReadDir = undefined; fault.beforeUnlink = undefined; await Promise.all(dirs.splice(0).map(p => fs.rm(p, { recursive: true, force: true }))); });
const setup = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "b2-revision-")); dirs.push(root);
  const sourceMarkdownPath = path.join(root, "source.md"), targetFolderPath = path.join(root, "target");
  await fs.mkdir(targetFolderPath); await fs.writeFile(sourceMarkdownPath, "1. Opening\n2. Close up\n");
  return { sourceMarkdownPath, targetFolderPath, blankShotPreset: "9:16" as const, normalSave: true as const };
};
it("revision rejects an observable parent symlink inserted after the empty check with zero external writes", async () => {
  const options = await setup(), outside = path.join(path.dirname(options.targetFolderPath), "outside");
  await fs.mkdir(outside); let checks = 0;
  fault.afterReadDir = async p => {
    if (p === options.targetFolderPath && ++checks === 2) await fs.symlink(outside, path.join(p, ".storyboard-workbench"));
  };
  await expect(createProjectFromStoryboardScriptMarkdown(options)).rejects.toThrow(/directory|symlink/i);
  fault.afterReadDir = undefined;
  expect(await fs.readdir(outside)).toEqual([]);
  expect((await fs.lstat(path.join(options.targetFolderPath, ".storyboard-workbench"))).isSymbolicLink()).toBe(true);
});
for (const replacement of ["symlink", "different-file", "different-directory"] as const) {
  it(`revision rollback retains a ${replacement} replacement rather than treating its path as a receipt`, async () => {
    const options = await setup(); const leaf = path.join(options.targetFolderPath, "script_shot_0001_0.tiff");
    const moved = path.join(path.dirname(options.targetFolderPath), "moved");
    fault.beforeOpen = async p => {
      if (!p.endsWith("storyboard.project.json")) return;
      if (replacement === "different-directory") {
        const directory = path.join(options.targetFolderPath, ".storyboard-workbench/layers");
        await fs.rename(directory, moved); await fs.mkdir(directory);
      } else {
        await fs.rename(leaf, moved);
        if (replacement === "symlink") await fs.symlink(moved, leaf);
        else await fs.writeFile(leaf, await fs.readFile(moved));
      }
    };
    fault.openSuffix = "storyboard.project.json";
    await expect(createProjectFromStoryboardScriptMarkdown(options)).rejects.toThrow("recovery incomplete");
    if (replacement === "different-directory") expect((await fs.lstat(path.join(options.targetFolderPath, ".storyboard-workbench/layers"))).isDirectory()).toBe(true);
    else expect((await fs.lstat(leaf)).isSymbolicLink()).toBe(replacement === "symlink");
  });
}
it("revision rejects an observable layers parent alias before the Image PNG phase", async () => {
  const options = await setup(), outside = path.join(path.dirname(options.targetFolderPath), "outside");
  await fs.mkdir(outside);
  fault.beforeOpen = async p => {
    if (!p.endsWith("script_shot_0001_0.tiff")) return;
    const internal = path.join(options.targetFolderPath, ".storyboard-workbench");
    await fs.mkdir(internal); await fs.symlink(outside, path.join(internal, "layers"));
  };
  await expect(createProjectFromStoryboardScriptMarkdown(options)).rejects.toThrow(/directory|symlink/i);
  expect(await fs.readdir(outside)).toEqual([]);
  expect((await fs.lstat(path.join(options.targetFolderPath, ".storyboard-workbench/layers"))).isSymbolicLink()).toBe(true);
});
it("revision normal rollback cleans its own empty directories and the actual target can be reused", async () => {
  const options = await setup(); fault.openSuffix = "storyboard.project.json";
  await expect(createProjectFromStoryboardScriptMarkdown(options)).rejects.toThrow("injected create write failure");
  expect(await fs.readdir(options.targetFolderPath)).toEqual([]);
  fault.openSuffix = "";
  const scan = await createProjectFromStoryboardScriptMarkdown(options);
  expect(scan.project!.shots).toHaveLength(2);
  expect(JSON.parse(await fs.readFile(scan.metadataPath, "utf8"))).toEqual(scan.project);
});
for (const admission of ["pre-existing", "appearing-at-json-open"] as const) {
  it(`normal Create preserves original same-name JSON bytes (${admission})`, async () => {
    const options = await setup();
    const internal = path.join(options.targetFolderPath, ".storyboard-workbench");
    const json = path.join(internal, "storyboard.project.json");
    // Deliberately noncanonical whitespace/bytes: semantic JSON equality is insufficient.
    const original = Buffer.from("{ \"outside\": true, \"value\": 7 }\r\n\t", "utf8");
    let inserted = false;
    if (admission === "pre-existing") {
      await fs.mkdir(internal); await fs.writeFile(json, original);
    } else {
      fault.beforeOpen = async p => {
        if (p === json) { inserted = true; await fs.writeFile(json, original); }
      };
    }
    if (admission === "pre-existing") {
      await expect(createProjectFromStoryboardScriptMarkdown(options)).rejects.toThrow("Choose an empty folder");
    } else {
      await expect(createProjectFromStoryboardScriptMarkdown(options)).rejects.toMatchObject({ code: "EEXIST" });
      expect(inserted).toBe(true);
    }
    expect(await fs.readFile(json)).toEqual(original);
    expect(await fs.readdir(options.targetFolderPath)).toEqual([".storyboard-workbench"]);
    expect(await fs.readdir(internal)).toEqual(["storyboard.project.json"]);
  });
}

it("revision reports primary and concrete cleanup reason in renderer only after every cleanup settles", async () => {
  const options = await setup(); fault.openSuffix = "storyboard.project.json"; fault.unlinkSuffix = "0001_0.tiff";
  let release!: () => void, reached!: () => void;
  const blocked = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { reached = r; });
  fault.beforeUnlink = async p => { if (p.endsWith("0002_0.tiff")) { reached(); await blocked; } };
  const handlers = new Map<string, Function>();
  registerWorkspaceScriptIpcHandlers({ handle: (name: string, fn: Function) => { handlers.set(name, fn); } } as never, {
    createFromStoryboardScript: createProjectFromStoryboardScriptMarkdown, inspectStoryboardScript: async () => ({}), addRecentFolder: async () => {}, ensureStoryboardScriptMarkdown: async () => false
  });
  let settled = false;
  const pending = handlers.get("workspace:createFromStoryboardScript")!({}, options).then((v: unknown) => { settled = true; return structuredClone(v); });
  await started; await new Promise(r => setTimeout(r, 20)); expect(settled).toBe(false);
  release(); const result = await pending;
  expect(() => decodeNormalSaveImportResult(result)).toThrow("injected create write failure");
  expect(() => decodeNormalSaveImportResult(result)).toThrow("injected rollback failure");
  await expect(fs.lstat(path.join(options.targetFolderPath, "script_shot_0002_0.tiff"))).rejects.toMatchObject({ code: "ENOENT" });
});
