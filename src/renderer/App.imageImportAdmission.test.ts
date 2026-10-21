import { afterEach, describe, expect, it, vi } from "vitest";
// App imports its GUI components; this hook probe never mounts them.
vi.mock("react-konva", () => ({ Circle: () => null, Layer: () => null, Line: () => null, Stage: () => null }));
import React, { act, startTransition, Suspense, useLayoutEffect } from "react";
import { createRequire } from "node:module";
import { useImageImportAdmission } from "./App";
import { addGeneratedShot, createProject } from "../shared/projectOps";
import type { WorkspaceTask } from "./workspaceLifecycleState";

// Real React concurrent reconciler, no DOM/Electron/GUI. Probe returns only null.
// Host is inert; React owns hook scheduling, suspended renders and layout commits.
const createReconciler = createRequire(import.meta.url)("react-reconciler");
let priority = 0;
const renderer = createReconciler({
  supportsMutation: true, isPrimaryRenderer: true,
  getRootHostContext: () => ({}), getChildHostContext: () => ({}),
  prepareForCommit: () => null, resetAfterCommit: () => {},
  shouldSetTextContent: () => false, createInstance: () => ({}), createTextInstance: () => ({}),
  appendInitialChild: () => {}, appendChild: () => {}, appendChildToContainer: () => {},
  removeChild: () => {}, removeChildFromContainer: () => {}, clearContainer: () => {},
  finalizeInitialChildren: () => false, getPublicInstance: (instance: unknown) => instance,
  scheduleTimeout: setTimeout, cancelTimeout: clearTimeout, noTimeout: -1,
  supportsMicrotasks: true, scheduleMicrotask: queueMicrotask,
  getCurrentUpdatePriority: () => priority, setCurrentUpdatePriority: (p: number) => { priority = p; },
  resolveUpdatePriority: () => priority || 32,
  trackSchedulerEvent: () => {}, resolveEventType: () => null,
  resolveEventTimeStamp: () => -1, shouldAttemptEagerTransition: () => false,
  maySuspendCommitOnUpdate: () => false, maySuspendCommitInSyncRender: () => false,
  bindToConsole: (method: string, args: unknown[]) => (...more: unknown[]) => Reflect.apply(console[method as "log"], console, [...args, ...more]),
  maySuspendCommit: () => false, preloadInstance: () => true,
  preparePortalMount: () => {}, detachDeletedInstance: () => {},
  NotPendingTransition: null, HostTransitionContext: React.createContext(null)
});
const errors: unknown[] = [];
const host = () => renderer.createContainer({}, 1, null, false, null, "", (e: unknown) => errors.push(e), (e: unknown) => errors.push(e), (e: unknown) => errors.push(e), null);
afterEach(() => { expect(errors.splice(0)).toEqual([]); vi.unstubAllGlobals(); });

const setup = () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const projectRef = { current: addGeneratedShot(createProject("synthetic"), { imagePath: "/synthetic/import.tiff", fileName: "import.tiff", width: 2, height: 2 }) };
  projectRef.current.shots[0].swb = { version: 1, status: "non-swb", canvasWidth: 2, canvasHeight: 2 };
  const setState = vi.fn();
  const root = host();
  let current!: ReturnType<typeof useImageImportAdmission>;
  const blocker = new Promise<void>(() => {});
  let suspendedRenderCount = 0;
  function Probe({ task, suspend }: { task?: WorkspaceTask; suspend?: boolean }) {
    const admission = useImageImportAdmission(projectRef, task, setState);
    useLayoutEffect(() => { current = admission; });
    if (suspend) { suspendedRenderCount++; throw blocker; }
    return null;
  }
  const render = async (task?: WorkspaceTask, suspend = false) => {
    await act(async () => {
      const tree = React.createElement(Suspense, { fallback: null }, React.createElement(Probe, { task, suspend }));
      if (suspend) startTransition(() => renderer.updateContainer(tree, root, null, null));
      else renderer.updateContainer(tree, root, null, null);
    });
  };
  const unmount = async () => { await act(async () => renderer.updateContainer(null, root, null, null)); };
  return { render, unmount, projectRef, setState, current: () => current, suspended: () => suspendedRenderCount };
};
const task: WorkspaceTask = { kind: "import", label: "synthetic", current: 0, total: 1 };

describe("App image Import live admission React contract", () => {
  it("retains synchronous admission through real React batched task state updates", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const root = host();
    const projectRef = { current: addGeneratedShot(createProject("synthetic"), { imagePath: "/synthetic/import.tiff", fileName: "import.tiff", width: 2, height: 2 }) };
    projectRef.current.shots[0].swb!.status = "non-swb";
    let current!: ReturnType<typeof useImageImportAdmission>;
    function Probe() {
      const [state, setState] = React.useState<WorkspaceTask | undefined>();
      const admission = useImageImportAdmission(projectRef, state, setState);
      useLayoutEffect(() => { current = admission; });
      return null;
    }
    try {
      await act(async () => renderer.updateContainer(React.createElement(Probe), root, null, null));
      const retained = current;
      await act(async () => {
        retained.setWorkspaceTask(task);
        expect(retained.isImageImportLocked()).toBe(false);
        retained.setWorkspaceTask((previous) => { expect(previous).toBe(task); return undefined; });
        expect(retained.isImageImportLocked()).toBe(true);
      });
      expect(current.isImageImportLocked()).toBe(true);
      expect(retained.isImageImportLocked()).toBe(true);
    } finally { await act(async () => renderer.updateContainer(null, root, null, null)); }
  });
  it("preserves the exact image-only policy and the existing workspace-task exception", async () => {
    const h = setup();
    try {
      await h.render();
      expect(h.current().isImageImportLocked()).toBe(true);
      const live = h.current().isImageImportLocked;
      await h.render(task);
      expect(live()).toBe(false);
      await h.render();
      expect(live()).toBe(true);
      // Script-only Import changes are deliberately outside this getter's inputs.
      h.projectRef.current.shots[0].swb!.status = "owned";
      expect(live()).toBe(false);
    } finally { await h.unmount(); }
  });
  it("publishes task setters and functional updates synchronously without waiting for a render", async () => {
    const h = setup();
    try {
      await h.render();
      const old = h.current();
      old.setWorkspaceTask(task);
      expect(old.isImageImportLocked()).toBe(false);
      old.setWorkspaceTask((current) => { expect(current).toBe(task); return undefined; });
      expect(old.isImageImportLocked()).toBe(true);
      expect(h.setState.mock.calls).toEqual([[task], [undefined]]);
    } finally { await h.unmount(); }
  });
  it("does not relax the committed lock during an abandoned suspended task render", async () => {
    const h = setup();
    try {
      await h.render();
      const live = h.current().isImageImportLocked;
      await h.render(task, true);
      expect(h.suspended()).toBeGreaterThan(0);
      expect(live()).toBe(true);
      await h.render();
      expect(live()).toBe(true);
    } finally { await h.unmount(); }
  });
  it("does not revoke admitted actions during an abandoned suspended task-clear render", async () => {
    const h = setup();
    try {
      await h.render(task);
      const live = h.current().isImageImportLocked;
      await h.render(undefined, true);
      expect(h.suspended()).toBeGreaterThan(0);
      expect(live()).toBe(false);
    } finally { await h.unmount(); }
  });
});
