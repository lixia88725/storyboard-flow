import { expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { registerWorkspacePendingIpcHandlers } from "./ipc/workspacePendingHandlers";
import { workspaceEffectFailure } from "./workspaceEffectFailure";
import { ProtectedLayerWriteError } from "./protectedLayerFileWriter";
import { FileReplacementRecoveryIncompleteError } from "./fileRenames";
import { SaveRecoveryIncompleteError } from "./saveRecovery";
import { PendingRecoveryIncompleteError } from "./pendingShotFilesService";
import { decodeWorkspaceEffectResult } from "../../src/shared/workspaceEffectIpc";

it("ordinary refusals are still rejections, not envelopes or successful Pending arrays", async () => {
  const ordinary = new Error("SAVE_RECOVERY_INCOMPLETE is only text, not an effect fact");
  expect(() => workspaceEffectFailure(ordinary, "save")).toThrow(ordinary);
  const refused = new ProtectedLayerWriteError("refused", "/synthetic/existing.png", "denied");
  expect(() => workspaceEffectFailure(refused, "pending")).toThrow(refused);
  const map = new Map<string, (...args: any[]) => any>();
  registerWorkspacePendingIpcHandlers({ handle: (name, fn) => { map.set(name, fn); } }, {
    moveShotsToPending: async () => { throw ordinary; }, restoreShotsFromPending: () => []
  });
  await expect(map.get("workspace:moveShotsToPending")!({}, {}, [])).rejects.toBe(ordinary);
  const files = await map.get("workspace:restoreShotsFromPending")!({}, {}, []);
  expect(decodeWorkspaceEffectResult(files)).toBe(files);
  const success = { project: {}, normalSaveOutputs: [] };
  expect(decodeWorkspaceEffectResult(success)).toBe(success);
});
it("nested typed unknown effects retain only reported paths and never infer owned paths from messages", () => {
  const effect = new ProtectedLayerWriteError("unknown", "/synthetic/layer.png", "mentions /not-owned/fake.png", "/synthetic/owned-stage.png");
  const nested = new SaveRecoveryIncompleteError([new FileReplacementRecoveryIncompleteError([effect])]);
  expect(workspaceEffectFailure(nested, "save")).toMatchObject({ error: { metadata: "not-started", publicationOrCleanup: "not-started",
    retainedPaths: ["/synthetic/layer.png", "/synthetic/owned-stage.png"] } });
  expect(workspaceEffectFailure(new PendingRecoveryIncompleteError(new Error("primary"), nested), "pending")).toMatchObject({ error: {
    code: "PENDING_RECOVERY_INCOMPLETE", retainedPaths: ["/synthetic/layer.png", "/synthetic/owned-stage.png"] } });
});
it.each([{ok:true}, {ok:false}, {ok:false,error:{code:"other"}}, {ok:false,error:{code:"SAVE_RECOVERY_INCOMPLETE",retainedPaths:null}}])("malformed envelopes fail closed (%j)", value => {
  expect(() => decodeWorkspaceEffectResult(value)).toThrow("Invalid workspace effect result");
});
it("two TypeScript compile targets carry identical plain protocol", async () => {
  expect(await readFile(new URL("../shared/workspaceEffectIpc.ts", import.meta.url), "utf8"))
    .toBe(await readFile(new URL("../../src/shared/workspaceEffectIpc.ts", import.meta.url), "utf8"));
});
