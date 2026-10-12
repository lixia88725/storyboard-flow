import os from "node:os";
import { rm, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { onTestFinished, expect, it } from "vitest";
import { writeProtectedLayerFile } from "./protectedLayerFileWriter";

it("ordinary existing layer bytes are replaced completely without changing its mode; fresh writes are complete", async () => {
  const root = await mkdtemp(path.join(process.env.TMPDIR ?? os.tmpdir(), "layer-protected-port-"));
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }); });
  const target = path.join(root, ".storyboard-workbench/layers/s/image.png");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, Buffer.from("old synthetic bytes"), { mode: 0o640 });
  const before = await stat(target);
  await writeProtectedLayerFile(root, target, Buffer.from("new complete bytes"));
  expect(await readFile(target)).toEqual(Buffer.from("new complete bytes"));
  expect((await stat(target)).mode).toBe(before.mode);
  const fresh = path.join(root, ".storyboard-workbench/layers/s/fresh.png");
  const committed = await writeProtectedLayerFile(root, fresh, Buffer.from("fresh complete bytes"));
  expect(await readFile(fresh)).toEqual(Buffer.from("fresh complete bytes"));
  expect((await stat(fresh)).nlink).toBe(1);
  const identity = await stat(fresh, { bigint: true });
  expect(committed).toMatchObject({ identity: { dev: String(identity.dev), ino: String(identity.ino) } });
  const refused = await writeProtectedLayerFile(root, fresh, Buffer.from("must not replace"), "create-only")
    .catch((error: unknown) => error);
  expect(refused).toMatchObject({ effect: "refused", filePath: fresh, retainedTemporary: null });
  expect(await readFile(fresh)).toEqual(Buffer.from("fresh complete bytes"));
});
