import { it, expect } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import { createOwnedFile, removeOwnedFile, OwnedFileCreationIncompleteError, type OwnedFileReceipt } from "./ownedFileCreation";

it("exclusive creation registers actual ownership and never removes a different directory item", async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR!, "owned-creation-identity-"));
  const target = path.join(root, "target"), replacement = path.join(root, "replacement");
  const records: OwnedFileReceipt[] = [];
  try {
    const receipt = await createOwnedFile(target, Buffer.from("owned"), value => { records.push(value); });
    const identity = await fs.lstat(target, { bigint: true });
    expect(receipt).toEqual({ filePath: target, identity: { dev: String(identity.dev), ino: String(identity.ino) } });
    expect(records).toEqual([receipt]);
    await expect(createOwnedFile(target, Buffer.from("must not replace"))).rejects.toMatchObject({ code: "EEXIST" });
    await fs.writeFile(replacement, "later"); await fs.rename(replacement, target);
    await expect(removeOwnedFile(receipt)).rejects.toThrow("identity changed");
    expect(await fs.readFile(target, "utf8")).toBe("later");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it("a native partial write closes and compensates its own new file while preserving the same original error", async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR!, "owned-short-write-"));
  const target = path.join(root, "target"), failure = new Error("synthetic ENOSPC after partial write");
  let closed = false;
  const openFile: typeof fs.open = async (...args) => {
    const handle = await fs.open(...args), write = handle.writeFile.bind(handle), close = handle.close.bind(handle);
    handle.writeFile = async () => { await write(Buffer.from("partial")); throw failure; };
    handle.close = async () => { await close(); closed = true; };
    return handle;
  };
  try {
    await expect(createOwnedFile(target, Buffer.from("complete"), undefined, openFile)).rejects.toBe(failure);
    expect(closed).toBe(true);
    await expect(fs.lstat(target)).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it("a failed write never deletes a replacement and reports incomplete compensation with its receipt", async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR!, "owned-short-write-replaced-"));
  const target = path.join(root, "target"), replacement = path.join(root, "replacement");
  const failure = new Error("synthetic write failure");
  const openFile: typeof fs.open = async (...args) => {
    const handle = await fs.open(...args), write = handle.writeFile.bind(handle);
    handle.writeFile = async () => {
      await write(Buffer.from("partial")); await fs.writeFile(replacement, "other bytes");
      await fs.rename(replacement, target); throw failure;
    };
    return handle;
  };
  try {
    const error = await createOwnedFile(target, Buffer.from("complete"), undefined, openFile).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(OwnedFileCreationIncompleteError);
    expect(error).toMatchObject({ recoveryIncomplete: true, filePath: target });
    expect((error as AggregateError).errors[0]).toBe(failure);
    expect(await fs.readFile(target, "utf8")).toBe("other bytes");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
