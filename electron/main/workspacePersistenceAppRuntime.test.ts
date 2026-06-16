import { describe, expect, it, vi } from "vitest";
import { createWorkspacePersistenceAppHandlers } from "./workspacePersistenceAppRuntime.js";

type ProjectPayload = {
  folderPath: string;
  metadataPath: string;
  project: { shots: string[] };
};

describe("createWorkspacePersistenceAppHandlers", () => {
  it("returns the workspace persistence dependencies used by the IPC handler", async () => {
    const ensureProjectLayerAssets = vi.fn(async () => undefined);
    const writeProjectFiles = vi.fn(async () => undefined);

    const handlers = createWorkspacePersistenceAppHandlers<ProjectPayload>({
      ensureProjectLayerAssets,
      writeProjectFiles
    });

    await handlers.ensureProjectLayerAssets({ shots: ["shot-1"] }, "/scene", {
      includeExternalShots: false
    });
    await handlers.writeProjectFiles("/scene/.storyboard-workbench/storyboard.project.json", "/scene", {
      shots: ["shot-1"]
    });

    expect(ensureProjectLayerAssets).toHaveBeenCalledWith({ shots: ["shot-1"] }, "/scene", {
      includeExternalShots: false
    });
    expect(writeProjectFiles).toHaveBeenCalledWith(
      "/scene/.storyboard-workbench/storyboard.project.json",
      "/scene",
      { shots: ["shot-1"] }
    );
  });
});
