import { addGeneratedShot } from "../shared/projectOps";
import { generatedShotTransparentLayerAssets } from "../shared/generatedShotAssets";
import type {
  BlankShotPreset,
  FolderScanPayload,
  ImportedImage,
  Project
} from "../shared/types";
import type { WorkspaceTask } from "./workspaceLifecycleState";
import { withStatus } from "./statusAction";

type ProjectUpdate = Project | ((currentProject: Project) => Project);
type StoryboardApi = Window["storyboard"] | undefined;

export type InitialAddShotContext =
  | {
      kind: "ready";
      baseProject: Project;
      insertAfterShotId: string | undefined;
      targetFolderPath: string;
    }
  | {
      kind: "needs-folder";
      status: "Choose a folder for the first shot";
    };

export const initialAddShotContext = ({
  folderPath,
  metadataPath,
  primarySelectedShotId,
  project
}: {
  folderPath: string | undefined;
  metadataPath: string | undefined;
  primarySelectedShotId: string | undefined;
  project: Project;
}): InitialAddShotContext =>
  folderPath && metadataPath
    ? {
        kind: "ready",
        baseProject: project,
        insertAfterShotId: primarySelectedShotId,
        targetFolderPath: folderPath
      }
    : {
        kind: "needs-folder",
        status: "Choose a folder for the first shot"
      };

export const addShotInsertedShotId = (
  project: Project,
  imagePath: string
): string | undefined => project.shots.find((shot) => shot.imagePath === imagePath)?.id;

export const useAddShotController = ({
  api,
  blankShotPreset,
  createTransparentLayerDataUrl,
  folderPath,
  loadFolderScan,
  markShotsDirty,
  metadataPath,
  primarySelectedShotId,
  projectRef,
  selectSingleShot,
  setRecentFolders,
  setStatus,
  setWorkspaceTask,
  updateProject
}: {
  api: StoryboardApi;
  blankShotPreset: BlankShotPreset;
  createTransparentLayerDataUrl: (width: number, height: number) => Promise<string>;
  folderPath: string | undefined;
  loadFolderScan: (
    scan: FolderScanPayload,
    nextStatus: string,
    dirty?: boolean,
    resetDirtyShots?: boolean
  ) => Promise<Project | undefined>;
  markShotsDirty: (shotIds: string[]) => void;
  metadataPath: string | undefined;
  primarySelectedShotId: string | undefined;
  projectRef: { current: Project };
  selectSingleShot: (shotId: string | undefined) => void;
  setRecentFolders: (folders: string[]) => void;
  setStatus: (status: string) => void;
  setWorkspaceTask: (task: WorkspaceTask | undefined) => void;
  updateProject: (projectUpdate: ProjectUpdate, markFileNamesUnsynced?: boolean, recordUndo?: boolean) => void;
}) => {
  const handleAddShot = async () => {
    if (!api) {
      setStatus("Cannot add shot: Electron preload API is unavailable");
      return;
    }

    let context = initialAddShotContext({
      folderPath,
      metadataPath,
      primarySelectedShotId,
      project: projectRef.current
    });

    if (context.kind === "needs-folder") {
      setStatus(context.status);
      const selectedFolder = await withStatus(
        "Choose folder failed",
        () => api.selectFolder(),
        setStatus
      );
      if (!selectedFolder) {
        setStatus("Add shot cancelled");
        return;
      }

      setWorkspaceTask({
        kind: "open",
        label: "Loading folder...",
        current: 0,
        total: 0
      });

      const scan = await withStatus(
        "Open folder failed",
        () => api.openFolderByPath(selectedFolder),
        setStatus
      );

      setWorkspaceTask(undefined);
      if (!scan) {
        return;
      }

      const loadedProject = await loadFolderScan(scan, "Folder opened", !scan.project);
      const baseProject = loadedProject ?? projectRef.current;
      context = {
        kind: "ready",
        targetFolderPath: scan.folderPath,
        baseProject,
        insertAfterShotId: baseProject.shots[0]?.id
      };
      void api.getRecentFolders().then(setRecentFolders).catch(() => undefined);
    }

    const image = await withStatus(
      "Add shot failed",
      () => api.createBlankShot(context.targetFolderPath, { preset: blankShotPreset }),
      setStatus
    );

    if (!image) {
      return;
    }

    const nextProject = addGeneratedShot(context.baseProject, image as ImportedImage, context.insertAfterShotId);
    const nextShotId = addShotInsertedShotId(nextProject, image.imagePath);
    const nextShot = nextShotId ? nextProject.shots.find((shot) => shot.id === nextShotId) : undefined;
    if (nextShot) {
      const didCreateLayerAssets = await withStatus(
        "Add shot layer failed",
        async () => {
          await Promise.all(
            generatedShotTransparentLayerAssets(nextShot).map(async (layer) => {
              const dataUrl = await createTransparentLayerDataUrl(layer.width, layer.height);
              await api.writeLayerPng({
                folderPath: context.targetFolderPath,
                bitmapPath: layer.bitmapPath,
                dataUrl
              });
            })
          );
          return true;
        },
        setStatus
      );
      if (!didCreateLayerAssets) {
        return;
      }
    }

    updateProject(nextProject, true, false);
    if (nextShotId) {
      markShotsDirty([nextShotId]);
    }
    selectSingleShot(nextShotId);
    setStatus(`Added ${blankShotPreset} shot: ${image.fileName}`);
  };

  return { handleAddShot };
};
