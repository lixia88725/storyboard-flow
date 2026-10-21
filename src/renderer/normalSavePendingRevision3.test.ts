import { expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { createProject, parkShotGroup } from "../shared/projectOps";
import { readLayerPng, writeLayerPng, deleteLayerPng } from "../../electron/main/layerAssetService";
import { historyFixture } from "../../research/save-pending-revision2/history-fixture";

// Real PNG service and actual controller applyHistoryEntry; hook setters alone
// are scaffolding. The separate mounted React proof covers passive effects.
async function chain(direction: "undo" | "redo", run: (f: any) => Promise<void>, namespaceGap = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pending-revision3-"));
  try {
    const bitmapPath = ".storyboard-workbench/layers/b/base.png";
    await mkdir(path.dirname(path.join(root, bitmapPath)), { recursive: true });
    const png = async (height: number, background: string) => sharp({ create: { width: 4, height, channels: 4, background } }).png().toBuffer();
    const small = await png(3, "red"), large = await png(153, "blue");
    const shot = (id: string, height: number) => ({ id, order: id === "s" ? 0 : 1, imagePath: path.join(root, `${id}.tiff`), fileName: `${id}.tiff`, swb: { version: 1, status: "owned", canvasWidth: 4, canvasHeight: height }, layers: [{ id: "base", kind: "image", name: "Base", visible: true, locked: false, opacity: 1, blendMode: "normal", order: 0, bitmapPath: id === "b" ? bitmapPath : ".storyboard-workbench/layers/s/base.png", width: 4, height }] });
    const state = (name: string, s: number, b: number) => ({ ...createProject(name), shots: [shot("s", s), shot("b", b)] } as any);
    const current = state("current", 153, 153), old = state("Eold", 153, 3), bad = state("Ebad", 3, 3), valid = state("Enew", 153, 153);
    if (direction === "redo") {
      // This valid chronological redo history uses a metadata-only visibility
      // change on S (same installed pixels), so Eold's reciprocal is truly empty.
      bad.shots[0] = { ...shot("s", 153), baseVisible: false };
    }
    if (namespaceGap) bad.shots[0].imagePath = path.join(root, "changed.tiff");
    const projectRef = { current }, api = { readLayerPng, writeLayerPng, deleteLayerPng };
    const h = await historyFixture(projectRef, api, root);
    const install = async (p: any) => {
      projectRef.current = p;
      for (const s of p.shots) {
        await mkdir(path.dirname(path.join(root, s.layers[0].bitmapPath)), { recursive: true });
        await writeFile(path.join(root, s.layers[0].bitmapPath), s.swb.canvasHeight === 3 ? small : large);
      }
    };
    if (direction === "undo") {
      // record order [Eold(empty), Ebad(B=3 snapshot), Enew(empty)]; pop from END.
      await install(old); h.controller.recordProjectUndoEntry();
      await install(bad); h.controller.recordUndoEntry(await h.controller.createHistoryEntry([bitmapPath]));
      await install(valid); h.controller.recordProjectUndoEntry();
      await install(current);
    } else {
      // Valid chronological chain; three actual Undos produce redo order
      // [Eold(empty), Ebad(B=3 reciprocal), Enew(empty)], again pop from END.
      await install(current); h.controller.recordProjectUndoEntry();
      await install(valid); h.controller.recordUndoEntry(await h.controller.createHistoryEntry([bitmapPath, valid.shots[0].layers[0].bitmapPath]));
      await install(bad); h.controller.recordProjectUndoEntry();
      await install(old);
      await h.controller.applyUndoEntry(); expect(projectRef.current.name).toBe("Ebad");
      await h.controller.applyUndoEntry(); expect(projectRef.current.name).toBe("Enew");
      await h.controller.applyUndoEntry(); expect(projectRef.current.name).toBe("current");
    }
    const apply = direction === "undo" ? h.controller.applyUndoEntry : h.controller.applyRedoEntry;
    const check = async () => {
      const bytes = await readFile(path.join(root, bitmapPath));
      const b = projectRef.current.shots.find((s: any) => s.id === "b");
      expect((await sharp(bytes).metadata()).height).toBe(b.swb.canvasHeight);
      expect(b.layers[0].height).toBe(153);
      expect(await sharp(bytes).raw().toBuffer()).toEqual(await sharp(large).raw().toBuffer());
      const s = [...projectRef.current.shots, ...(projectRef.current.parkedShots ?? [])].find((shot: any) => shot.id === "s");
      const sBytes = await readFile(path.join(root, s.layers[0].bitmapPath));
      expect((await sharp(sBytes).metadata()).height).toBe(s.swb.canvasHeight);
      expect(await sharp(sBytes).raw().toBuffer()).toEqual(await sharp(large).raw().toBuffer());
    };
    await run({ h, projectRef, current: projectRef.current, bitmapPath, root, apply, check, large });
  } finally { await rm(root, { recursive: true, force: true }); }
}

it.each(["undo", "redo"] as const)("presentation boundary preserves contiguous %s PNG chain, never skips Ebad to metadata-only Eold", async direction => {
  await chain(direction, async ({ h, projectRef, current, apply, check, bitmapPath, root, large }) => {
    h.controller.invalidatePresentationHistory(current, ["s"], [current.shots[0].layers[0].bitmapPath]);
    await apply(); expect(projectRef.current.name).toBe("Enew"); await check();
    await apply(); await check(); expect(h.status).toHaveBeenLastCalledWith(`Nothing to ${direction}`);
    expect(projectRef.current.name).toBe("Enew");
    // Retained near-current segment wasn't reset; future metadata/bitmap edits work.
    h.controller.recordProjectUndoEntry(); projectRef.current = { ...projectRef.current, name: "future metadata" };
    await h.controller.applyUndoEntry(); expect(projectRef.current.name).toBe("Enew");
    await h.controller.applyRedoEntry(); expect(projectRef.current.name).toBe("future metadata");
    h.controller.recordUndoEntry(await h.controller.createHistoryEntry([bitmapPath]));
    const painted = await sharp(large).negate({ alpha: false }).png().toBuffer();
    await writeFile(path.join(root, bitmapPath), painted);
    await h.controller.applyUndoEntry(); await check();
    await h.controller.applyRedoEntry(); expect(await readFile(path.join(root, bitmapPath))).toEqual(painted);
  });
});

it.each(["undo", "redo"] as const)("namespace rebase boundary preserves contiguous %s PNG chain without jumping invalid lineage", async direction => {
  await chain(direction, async ({ h, projectRef, current, apply, check }) => {
    // Ebad has incompatible S lineage and the B=3 snapshot needed by Eold.
    // Eold itself has compatible lineage but cannot be reached across the gap.
    const after = parkShotGroup(current, ["s"]) as any;
    after.parkedShots[0].imagePath = path.join(path.dirname(current.shots[0].imagePath), "Pending/s.tiff");
    h.controller.rebasePendingHistory(current, after, ["s"], (p: any) => parkShotGroup(p, ["s"]));
    projectRef.current = after;
    await apply(); expect(projectRef.current.name).toBe("Enew"); await check();
    expect(projectRef.current.parkedShots[0].imagePath).toBe(after.parkedShots[0].imagePath);
    await apply(); await check(); expect(h.status).toHaveBeenLastCalledWith(`Nothing to ${direction}`);
  }, true);
});
