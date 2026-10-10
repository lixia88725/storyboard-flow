import { describe, expect, it } from "vitest";
import { initialWorkspaceLifecycleState } from "./workspaceLifecycleState";
import * as lifecycle from "./workspaceLifecycleState";
import { createProject } from "../shared/projectOps";
import type { Project } from "../shared/types";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

describe("workspaceLifecycleState", () => {
  it("uses the existing workspace lifecycle defaults", () => {
    const state = initialWorkspaceLifecycleState();

    expect(state.project.name).toBe("Untitled Storyboard");
    expect(state.project.shots).toEqual([]);
    expect(state.folderPath).toBeUndefined();
    expect(state.folderInputValue).toBe("");
    expect(state.metadataPath).toBeUndefined();
    expect(state.workspaceSaveState).toBe("saved");
    expect(state.workspaceTask).toBeUndefined();
    expect(state.fileNameSyncState).toBe("synced");
    expect(state.recentFolders).toEqual([]);
    expect(state.autosaveRevision).toBe(0);
  });
  it("real React App state hook publishes two edits before effects without lagging the ref", () => {
    let edited = false;
    const Probe = () => {
      const owner = lifecycle.useWorkspaceLifecycleState();
      if (!edited) {
        edited = true;
        owner.setProject(p => ({ ...p, name: "P1" }));
        expect(owner.projectRef.current.name).toBe("P1");
        owner.setProject(p => ({ ...p, name: `${p.name}-P2` }));
        expect(owner.projectRef.current.name).toBe("P1-P2");
      }
      return createElement("span", null, owner.project.name);
    };
    expect(renderToString(createElement(Probe))).toBe("<span>P1-P2</span>");
  });
  it("publishes the App Project ref synchronously before state dispatch, functional edits use latest ref", () => {
    const publish = (lifecycle as unknown as { publishWorkspaceProject?: (ref: { current: Project }, set: (p: Project) => void,
      update: Project | ((p: Project) => Project)) => void }).publishWorkspaceProject;
    expect(publish, "App has no synchronous owner publication seam").toBeDefined();
    const ref = { current: createProject("P0") };
    const deferred: Project[] = [];
    const dispatch = (p: Project) => { expect(ref.current).toBe(p); deferred.push(p); };
    publish!(ref, dispatch, createProject("P1"));
    publish!(ref, dispatch, p => ({ ...p, name: `${p.name}-P2` }));
    expect(ref.current.name).toBe("P1-P2");
    expect(deferred.map(p => p.name)).toEqual(["P1", "P1-P2"]);
  });
});
