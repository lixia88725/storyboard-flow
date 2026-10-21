import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { Project } from "../shared/types";
import { autosaveErrorReducer, type AutosaveErrorNotice } from "./autosaveError";
import { shouldRunAutosave } from "./workspacePersistenceController";
import type { WorkspaceSaveState } from "./workspaceLifecycleState";

type WorkspaceAutosaveApi = {
  autosaveWorkspace: (payload: {
    folderPath: string;
    metadataPath: string;
    project: Project;
  }) => Promise<unknown>;
};

type AutosaveTimers = {
  setTimeout: (callback: () => void, delayMs: number) => number;
  clearTimeout: (timeoutId: number) => void;
};

type WorkspaceAutosaveInput = {
  autosaveRevision: number;
  folderPathRef: RefObject<string | undefined>;
  hasStoryboardApi: boolean;
  metadataPathRef: RefObject<string | undefined>;
  persistWorkspace: (
    projectToSave: Project,
    activeFolderPath: string,
    activeMetadataPath: string
  ) => Promise<void>;
  projectRef: RefObject<Project>;
  setAutosaveError: Dispatch<SetStateAction<AutosaveErrorNotice | undefined>>;
  setStatus: (status: string) => void;
  setWorkspaceSaveState: Dispatch<SetStateAction<WorkspaceSaveState>>;
  timers: AutosaveTimers;
};

export const autosaveDelayMs = 600;

export const persistWorkspaceProject = async ({
  activeFolderPath,
  activeMetadataPath,
  api,
  isCurrentWorkspace,
  now = () => new Date(),
  projectToSave,
  scriptImportCheckIdRef,
  setAutosaveError,
  setScriptImportNeeded,
  setWorkspaceSaveState
}: {
  activeFolderPath: string | undefined;
  activeMetadataPath: string | undefined;
  api: WorkspaceAutosaveApi | undefined;
  isCurrentWorkspace: () => boolean;
  now?: () => Date;
  projectToSave: Project;
  scriptImportCheckIdRef: { current: number };
  setAutosaveError: Dispatch<SetStateAction<AutosaveErrorNotice | undefined>>;
  setScriptImportNeeded: (needed: boolean) => void;
  setWorkspaceSaveState: Dispatch<SetStateAction<WorkspaceSaveState>>;
}): Promise<void> => {
  if (!api || !activeFolderPath || !activeMetadataPath) {
    return;
  }

  await api.autosaveWorkspace({
    project: { ...projectToSave, updatedAt: now().toISOString() },
    folderPath: activeFolderPath,
    metadataPath: activeMetadataPath
  });
  // Disk completion belongs to the captured workspace, not whichever project
  // happens to be displayed when IPC returns.
  if (!isCurrentWorkspace()) {
    return;
  }
  scriptImportCheckIdRef.current += 1;
  setScriptImportNeeded(false);
  setWorkspaceSaveState("saved");
  setAutosaveError((current) => autosaveErrorReducer(current, { type: "saved" }));
};

export const registerWorkspaceAutosave = ({
  autosaveRevision,
  folderPathRef,
  hasStoryboardApi,
  metadataPathRef,
  persistWorkspace,
  projectRef,
  setAutosaveError,
  setStatus,
  setWorkspaceSaveState,
  timers
}: WorkspaceAutosaveInput): (() => void) | undefined => {
  const activeFolderPath = folderPathRef.current;
  const activeMetadataPath = metadataPathRef.current;
  if (!shouldRunAutosave(autosaveRevision, activeFolderPath, activeMetadataPath, hasStoryboardApi)) {
    return undefined;
  }
  if (!activeFolderPath || !activeMetadataPath) {
    return undefined;
  }

  const projectToSave = projectRef.current;
  setWorkspaceSaveState("saving");
  const timer = timers.setTimeout(() => {
    void persistWorkspace(projectToSave, activeFolderPath, activeMetadataPath).catch((error) => {
      if (folderPathRef.current !== activeFolderPath ||
          metadataPathRef.current !== activeMetadataPath ||
          projectRef.current !== projectToSave) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setWorkspaceSaveState("error");
      setAutosaveError((current) => autosaveErrorReducer(current, { type: "failed", message }));
      setStatus(`Autosave failed: ${message}`);
    });
  }, autosaveDelayMs);

  return () => timers.clearTimeout(timer);
};

export const useWorkspaceAutosaveController = (
  input: Omit<WorkspaceAutosaveInput, "hasStoryboardApi" | "timers">
): void => {
  const inputRef = useRef(input);
  inputRef.current = input;

  useEffect(
    () =>
      registerWorkspaceAutosave({
        ...inputRef.current,
        autosaveRevision: input.autosaveRevision,
        hasStoryboardApi: Boolean(window.storyboard),
        timers: window
      }),
    [input.autosaveRevision]
  );
};
