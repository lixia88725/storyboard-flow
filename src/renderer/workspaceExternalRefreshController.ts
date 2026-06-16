import { useEffect, useRef } from "react";

type RefLike<T> = {
  current: T;
};

type WorkspaceSaveState = "saved" | "saving" | "error";

type ExternalChangesApi<Project, ExternalChangesResult, ImportPayload, FolderScan> = {
  checkExternalChanges: (payload: {
    project: Project;
    folderPath: string;
    metadataPath: string;
  }) => Promise<ExternalChangesResult>;
  importSwbFormat: (payload: ImportPayload) => Promise<FolderScan>;
};

type WorkspaceFolderWatchApi = {
  watchWorkspaceFolder: (
    folderPath: string,
    callback: (change: { folderPath: string; fileName: string }) => void
  ) => Promise<() => void>;
};

type FocusEventTarget = {
  addEventListener: (type: "focus", listener: () => void) => void;
  removeEventListener: (type: "focus", listener: () => void) => void;
};

type RefreshTimers = {
  setTimeout: (callback: () => void, delayMs: number) => number;
  clearTimeout: (timeoutId: number) => void;
};

const externalRefreshDebounceMs = 500;

export const refreshWorkspaceExternalImportState = async <
  Project,
  ExternalImage,
  ExternalChangesResult extends { images: ExternalImage[]; scriptImportNeeded: boolean },
  FolderScan,
  BlankShotPreset
>({
  api,
  blankShotPreset,
  checkIdRef,
  dirtyShotIds,
  folderPathRef,
  hasOnlyCompatibleExternalEdits,
  loadFolderScan,
  metadataPathRef,
  mergeExternalImageChanges,
  persistResolvedExternalProject,
  projectNeedsSwbImport,
  projectRef,
  runWithStatus,
  setProject,
  setScriptImportNeeded,
  workspaceSaveStateRef
}: {
  api:
    | ExternalChangesApi<
        Project,
        ExternalChangesResult,
        {
          project: Project;
          folderPath: string;
          metadataPath: string;
          blankShotPreset: BlankShotPreset;
          dirtyShotIds: string[];
          preserveDirtyShotLayers: true;
        },
        FolderScan
      >
    | undefined;
  blankShotPreset: BlankShotPreset;
  checkIdRef: RefLike<number>;
  dirtyShotIds: () => string[];
  folderPathRef: RefLike<string | undefined>;
  hasOnlyCompatibleExternalEdits: (project: Project) => boolean;
  loadFolderScan: (
    scan: FolderScan,
    nextStatus: string,
    dirty: boolean,
    resetDirtyShots: boolean
  ) => Promise<unknown>;
  metadataPathRef: RefLike<string | undefined>;
  mergeExternalImageChanges: (project: Project, images: ExternalImage[]) => Project;
  persistResolvedExternalProject: (
    project: Project,
    folderPath: string,
    metadataPath: string
  ) => void;
  projectNeedsSwbImport: (project: Project) => boolean;
  projectRef: RefLike<Project>;
  runWithStatus: <Result>(
    label: string,
    action: () => Promise<Result>
  ) => Promise<Result | undefined>;
  setProject: (project: Project) => void;
  setScriptImportNeeded: (needed: boolean) => void;
  workspaceSaveStateRef: RefLike<WorkspaceSaveState>;
}): Promise<void> => {
  const nextFolderPath = folderPathRef.current;
  const nextMetadataPath = metadataPathRef.current;

  if (!api || !nextFolderPath || !nextMetadataPath) {
    return;
  }
  if (workspaceSaveStateRef.current === "saving") {
    return;
  }

  const checkId = (checkIdRef.current += 1);
  const projectToCheck = projectRef.current;
  const result = await runWithStatus("Workspace change check failed", () =>
    api.checkExternalChanges({
      project: projectToCheck,
      folderPath: nextFolderPath,
      metadataPath: nextMetadataPath
    })
  );

  if (
    !result ||
    checkId !== checkIdRef.current ||
    projectRef.current !== projectToCheck ||
    folderPathRef.current !== nextFolderPath ||
    metadataPathRef.current !== nextMetadataPath
  ) {
    return;
  }

  const nextProject = mergeExternalImageChanges(projectToCheck, result.images);
  if (
    nextProject !== projectToCheck &&
    hasOnlyCompatibleExternalEdits(nextProject)
  ) {
    const imported = await runWithStatus("Import external Photoshop edits failed", () =>
      api.importSwbFormat({
        project: nextProject,
        folderPath: nextFolderPath,
        metadataPath: nextMetadataPath,
        blankShotPreset,
        dirtyShotIds: dirtyShotIds(),
        preserveDirtyShotLayers: true
      })
    );
    if (
      imported &&
      checkId === checkIdRef.current &&
      folderPathRef.current === nextFolderPath &&
      metadataPathRef.current === nextMetadataPath
    ) {
      await loadFolderScan(imported, "Imported external Photoshop edits", false, true);
      return;
    }
  }

  if (nextProject !== projectToCheck) {
    setProject(nextProject);
    if (projectNeedsSwbImport(projectToCheck) && !projectNeedsSwbImport(nextProject)) {
      persistResolvedExternalProject(nextProject, nextFolderPath, nextMetadataPath);
    }
  }
  setScriptImportNeeded(result.scriptImportNeeded);
};

export const registerWorkspaceFocusRefresh = (
  eventTarget: FocusEventTarget,
  refreshExternalImportState: () => void | Promise<void>
): (() => void) => {
  const handleFocus = () => {
    void refreshExternalImportState();
  };

  eventTarget.addEventListener("focus", handleFocus);

  return () => eventTarget.removeEventListener("focus", handleFocus);
};

export const registerWorkspaceFolderWatchRefresh = ({
  api,
  folderPath,
  refreshExternalImportState,
  timers,
  debounceMs = externalRefreshDebounceMs
}: {
  api: WorkspaceFolderWatchApi | undefined;
  folderPath: string | undefined;
  refreshExternalImportState: () => void | Promise<void>;
  timers: RefreshTimers;
  debounceMs?: number;
}): (() => void) => {
  if (!api || !folderPath) {
    return () => undefined;
  }

  let stopWatching: (() => void) | undefined;
  let debounceId: number | undefined;
  let cancelled = false;

  void api
    .watchWorkspaceFolder(folderPath, () => {
      if (debounceId !== undefined) {
        timers.clearTimeout(debounceId);
      }
      debounceId = timers.setTimeout(() => {
        void refreshExternalImportState();
      }, debounceMs);
    })
    .then((stop) => {
      if (cancelled) {
        stop();
        return;
      }
      stopWatching = stop;
    })
    .catch(() => undefined);

  return () => {
    cancelled = true;
    if (debounceId !== undefined) {
      timers.clearTimeout(debounceId);
    }
    stopWatching?.();
  };
};

export const useWorkspaceExternalRefreshController = ({
  folderPath,
  focusRefreshKey,
  refreshExternalImportState
}: {
  folderPath: string | undefined;
  focusRefreshKey: unknown;
  refreshExternalImportState: () => void | Promise<void>;
}): void => {
  const refreshExternalImportStateRef = useRef(refreshExternalImportState);
  refreshExternalImportStateRef.current = refreshExternalImportState;

  useEffect(
    () =>
      registerWorkspaceFocusRefresh(window, () =>
        refreshExternalImportStateRef.current()
      ),
    [focusRefreshKey]
  );

  useEffect(
    () =>
      registerWorkspaceFolderWatchRefresh({
        api: window.storyboard,
        folderPath,
        refreshExternalImportState: () => refreshExternalImportStateRef.current(),
        timers: window
      }),
    [folderPath]
  );
};
