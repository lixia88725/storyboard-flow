import { expect, it } from "vitest";
import { createProject } from "../shared/projectOps";
import { createNormalSaveProjectOwner } from "./normalSaveProjectOwner";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { deriveWorkspaceStatusPresentation } from "./workspaceStatusPresentation";

const setup = () => {
  const project = createProject("status");
  project.shots = [{ id: "s", order: 0, imagePath: "/owned.tiff", fileName: "owned.tiff", swb: { version: 1, status: "owned", canvasWidth: 2, canvasHeight: 2 }, layers: [] }];
  project.pendingBake = { version: 1, shots: { s: { state: "synced", acceptedOutputIdentity: "a".repeat(64) } } };
  const ref = { current: project }; let failPersist = false;
  const queue = createBitmapLayerWriteQueue();
  const persist = async () => { if (failPersist) throw Error("required MD EIO"); };
  const owner = createNormalSaveProjectOwner({ projectRef: ref, setProject: p => { ref.current = p; }, queue,
    freshToken: () => "T", readIdentity: async () => "a".repeat(64), persist,
    captureEffectPersistence: () => ({ folderPath: "/", metadataPath: "/project.json", persist }), output: async () => [] });
  const read = (message = "Saved and synced file names") => deriveWorkspaceStatusPresentation({ metadataState: "saved", message, project: ref.current, owner });
  return { ref, owner, read, fail: () => { failPersist = true; }, repair: () => { failPersist = false; } };
};
it("current clean owner preserves ordinary saved text", () => { const f = setup(); expect(f.read()).toEqual({ state: "saved", message: "Saved and synced file names", metadataState: "saved" }); });
it("real failed completion cannot reuse prior metadata Saved", () => { const f = setup(); f.owner.captureEffectCompletion().failed(Error("write EIO"), ["s"]); expect(f.read("Add layer failed: write EIO").state).toBe("error"); expect(f.read().message).not.toContain("Saved"); expect(f.owner.captureEffectAdmission()()).toBe(false); });
it("actual completed PNG with required persist refusal remains error", async () => { const f = setup(); f.fail(); await expect(f.owner.captureEffectCompletion()(p => p, ["s"])).rejects.toThrow("required MD EIO"); expect(f.read().state).toBe("error"); expect(f.ref.current.pendingBake?.shots.s.state).toBe("pending"); });
it("durable metadata with unfinished TIFF is pending not failure or saved", async () => { const f = setup(); await f.owner.captureEffectCompletion()(p => p, ["s"]); expect(f.read()).toEqual({ state: "pending", message: "Working TIFF output pending Save", metadataState: "saved" }); });
it("unknown/future raw and recovery beat a cached success even if owner reports clean", () => { const f = setup(); const owner = { hasUnsavedWork: () => false, lastError: undefined }; for (const pendingBake of [{ version: 1, shots: { s: { state: "unknown" } } }, { version: 99, shots: {} }]) { expect(deriveWorkspaceStatusPresentation({ project: { ...f.ref.current, pendingBake } as typeof f.ref.current, metadataState: "saved", message: "Saved and synced file names", owner }).state).toBe("error"); } expect(deriveWorkspaceStatusPresentation({ project: f.ref.current, metadataState: "saved", message: "ready", owner, recoveryRequired: "recovery" }).state).toBe("error"); });
it("held Save receipt/queue never borrows saved and non-success operation text stays intact", () => { const f = setup(); const owner = { hasUnsavedWork: () => true, lastError: undefined }; const p = deriveWorkspaceStatusPresentation({ project: f.ref.current, metadataState: "saved", message: "Layer renamed", owner }); expect(p.state).toBe("pending"); expect(p.message).toBe("Layer renamed"); });
it("legacy metadata display retains existing behavior without normal owner", () => { const f = setup(); expect(deriveWorkspaceStatusPresentation({ project: f.ref.current, metadataState: "saving", message: "Opening" }).state).toBe("saving"); });
