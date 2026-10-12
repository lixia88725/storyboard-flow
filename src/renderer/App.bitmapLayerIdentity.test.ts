import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addGeneratedShot, createProject } from "../shared/projectOps";
import { useBitmapLayerActions, type BitmapLayerActionsOptions } from "./bitmapLayerActions";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { createWorkspaceSession } from "./workspaceSession";

// Execute the actual App options expression, not a hand-written imitation of its wiring.
// No React shim: this controller has no React runtime hooks. IPC/canvas are fixture ports.
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const expressions: string[] = [];
let sessionInitializer = "";
let historyInitializer = "";
const visit = (node: ts.Node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "workspaceSession")
    sessionInitializer = node.initializer!.getText(source);
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "captureInstalledHistory")
    historyInitializer = node.initializer!.getText(source);
  if (ts.isCallExpression(node) && node.expression.getText(source) === "useBitmapLayerActions") {
    expressions.push(node.arguments[0].getText(source));
  }
  ts.forEachChild(node, visit);
};
visit(source);
const setup = (omitPort = false) => {
  expect(expressions).toHaveLength(1);
  const projectRef = { current: addGeneratedShot(createProject("A"), {
    imagePath: "/synthetic/a.tiff", fileName: "a.tiff", width: 2, height: 2
  }) };
  const aiApplyWorkspaceIdentityRef = { current: {} };
  const folderPathRef = { current: "/synthetic" };
  const metadataPathRef = { current: "/synthetic/project.json" };
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const api = {
    writeLayerPng: vi.fn(async () => ({})), deleteLayerPng: vi.fn(async () => ({})),
    mergeLayerDown: vi.fn(async () => ({})), mergeVisibleLayers: vi.fn(async () => ({}))
  };
  vi.stubGlobal("window", { storyboard: api });
  const recordUndoEntry = vi.fn(); const markShotsDirty = vi.fn(); const updateProject = vi.fn();
  // Isolate only the normal-owner seam here: this matrix exercises App's
  // render destination and generation wiring, not receipt or disk authority.
  // Those capabilities use the actual owner in normalSave* chains and UI.
  const captureEnsureScope = vi.fn(() => () => true);
  const captureEffectCompletion = vi.fn(() => Object.assign(async () => undefined, { failed: () => undefined }));
  const normalSaveAppAdapterRef = { current: { owner: { captureEffectAdmission: captureEnsureScope, captureEffectCompletion,
    hasUnsavedWork: () => false, lastError: undefined } } };
  const scope = {
    // A deliberately false obsolete binding cannot select a different App path.
    normalSaveAppEnabled: false,
    normalSaveAppAdapterRef,
    renderAdapter: normalSaveAppAdapterRef.current,
    isImageImportLocked: () => false, projectRef, folderPath: folderPathRef.current,
    metadataPath: metadataPathRef.current, folderPathRef, metadataPathRef, aiApplyWorkspaceIdentityRef,
    bitmapLayerWriteQueueRef: { current: createBitmapLayerWriteQueue() },
    createTransparentLayerDataUrl: async () => "transparent",
    createHistoryEntry: async () => { entered(); await gate; return { fixture: true }; },
    recordUndoEntry, markShotsDirty, updateProject, setStatus: vi.fn()
  };
  expect(sessionInitializer).not.toBe("");
  const sessionBindings = { ...scope, createWorkspaceSession, workspaceRecoveryRequiredRef: { current: undefined } };
  const workspaceSession = new Function(...Object.keys(sessionBindings), ts.transpile(`return (${sessionInitializer});`))(...Object.values(sessionBindings));
  const renderSlot = { incarnation: {}, projectRef };
  const historyBindings = { projectRef, renderSlot, workspaceSlotsRef: { current: { active: renderSlot, isActive: (slot: unknown) => slot === renderSlot } } };
  const captureInstalledHistory = new Function(...Object.keys(historyBindings), ts.transpile(`return (${historyInitializer});`))(...Object.values(historyBindings));
  const bindings = { ...scope, workspaceSession, captureInstalledHistory };
  const compiled = ts.transpileModule(`return (${expressions[0]});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText;
  const options = new Function(...Object.keys(bindings), compiled)(
    ...Object.values(bindings)
  ) as BitmapLayerActionsOptions<{ fixture: boolean }>;
  if (omitPort) delete options.getWorkspaceIdentity;
  const actions = useBitmapLayerActions(options);
  const shot = projectRef.current.shots[0]; const ids = shot.layers!.map(l => l.id);
  const invoke = (action: string) => {
    if (action === "clear") return actions.handleClearBitmapLayer(shot.id, ids[1]);
    if (action === "remove") return actions.handleRemoveBitmapLayer(shot.id, ids[1]);
    if (action === "down") return actions.handleMergeBitmapLayerDown(shot.id, ids[1]);
    if (action === "selected") return actions.handleMergeBitmapLayers(shot.id, ids[1], ids);
    if (action === "visible") return actions.handleMergeVisibleBitmapLayers(shot.id);
    return actions.handleAddBitmapLayer(shot.id);
  };
  return { options, projectRef, aiApplyWorkspaceIdentityRef, folderPathRef, metadataPathRef,
    api, started, release, invoke, recordUndoEntry, markShotsDirty, updateProject, captureEnsureScope, captureEffectCompletion };
};
afterEach(() => vi.unstubAllGlobals());
const actions = ["clear", "remove", "down", "selected", "visible", "add"];
describe("actual App bitmap layer identity composition", () => {
  it("passes the live owner identity rather than a frozen token", () => {
    const s = setup();
    expect(s.options.getWorkspaceIdentity).toBeTypeOf("function");
    expect(s.options.getWorkspaceIdentity!()).toBe(s.aiApplyWorkspaceIdentityRef.current);
    s.aiApplyWorkspaceIdentityRef.current = {};
    expect(s.options.getWorkspaceIdentity!()).toBe(s.aiApplyWorkspaceIdentityRef.current);
  });
  describe.each(["ABA", "reload", "successful Save", "folder", "metadata"])("%s during read-only preparation", change => {
    it.each(actions)("rejects %s before the first write or publication", async action => {
      const s = setup(); const original = s.projectRef.current;
      const task = s.invoke(action); await s.started;
      if (change === "ABA") {
        s.aiApplyWorkspaceIdentityRef.current = {}; s.projectRef.current = createProject("B");
        s.aiApplyWorkspaceIdentityRef.current = {}; s.projectRef.current = original;
      } else if (change === "folder") s.folderPathRef.current = "/synthetic/other";
      else if (change === "metadata") s.metadataPathRef.current = "/synthetic/other.json";
      else s.aiApplyWorkspaceIdentityRef.current = {};
      s.release(); await task;
      for (const write of Object.values(s.api)) expect(write).not.toHaveBeenCalled();
      expect(s.recordUndoEntry).not.toHaveBeenCalled();
      expect(s.markShotsDirty).not.toHaveBeenCalled(); expect(s.updateProject).not.toHaveBeenCalled();
      expect(s.projectRef.current).toBe(original);
    });
  });
  it("unchanged workspace still permits a prepared write", async () => {
    const s = setup(); const task = s.invoke("clear"); await s.started; s.release(); await task;
    expect(s.api.writeLayerPng).toHaveBeenCalledOnce(); expect(s.recordUndoEntry).toHaveBeenCalledOnce();
    expect(s.captureEnsureScope).toHaveBeenCalled();
    expect(s.captureEffectCompletion).toHaveBeenCalledOnce();
  });
  it("deliberately omitted identity shows why the App port cannot be replaced by fixture admission", async () => {
    const s = setup(true); const task = s.invoke("clear"); await s.started;
    s.aiApplyWorkspaceIdentityRef.current = {};
    s.release(); await task;
    expect(s.api.writeLayerPng).toHaveBeenCalledOnce(); expect(s.recordUndoEntry).toHaveBeenCalledOnce();
  });
});
