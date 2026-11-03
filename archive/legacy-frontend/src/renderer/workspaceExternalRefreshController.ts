import { useEffect, useRef } from "react";

type RefLike<T> = {
  current: T;
};

type WorkspaceSaveState = "saved" | "saving" | "error";

type ExternalChangesApi<Project, ExternalChangesResult> = {
  checkExternalChanges: (payload: {
    project: Project;
    folderPath: string;
    metadataPath: string;
    normalSave?: boolean;
  }) => Promise<ExternalChangesResult>;
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
  ExternalChangesResult extends { images: ExternalImage[]; scriptImportNeeded: boolean }
>({
  api,
  checkIdRef,
  folderPathRef,
  metadataPathRef,
  mergeExternalImageChanges,
  setScriptImportNeeded,
  workspaceSaveStateRef,
  normalSaveRefresh
}: {
  api: ExternalChangesApi<Project, ExternalChangesResult> | undefined;
  checkIdRef: RefLike<number>;
  folderPathRef: RefLike<string | undefined>;
  metadataPathRef: RefLike<string | undefined>;
  mergeExternalImageChanges: (project: Project, images: ExternalImage[]) => Project;
  setScriptImportNeeded: (needed: boolean) => void;
  workspaceSaveStateRef: RefLike<WorkspaceSaveState>;
  normalSaveRefresh: (read: (project: Project) => Promise<Project>, isCurrent: () => boolean) => Promise<boolean | { accepted: boolean; scriptImportNeeded?: boolean }>;
}): Promise<void> => {
  const nextFolderPath = folderPathRef.current;
  const nextMetadataPath = metadataPathRef.current;
  if (!api || !nextFolderPath || !nextMetadataPath) return;
  if (workspaceSaveStateRef.current === "saving") return;

  const checkId = (checkIdRef.current += 1);
  let observed: ExternalChangesResult | undefined;
  const completion = await normalSaveRefresh(async project => {
    // The owner invokes this reader only after old admitted I/O has settled.
    if (checkId !== checkIdRef.current) throw new Error("External refresh superseded");
    observed = await api.checkExternalChanges({ project, folderPath: nextFolderPath, metadataPath: nextMetadataPath, normalSave: true });
    if (checkId !== checkIdRef.current) throw new Error("External refresh superseded");
    return mergeExternalImageChanges(project, observed.images);
  }, () => checkId === checkIdRef.current && folderPathRef.current === nextFolderPath && metadataPathRef.current === nextMetadataPath);
  const accepted = typeof completion === "boolean" ? completion : completion.accepted;
  const remaining = typeof completion === "boolean" ? undefined : completion.scriptImportNeeded;
  if ((accepted || remaining !== undefined) && observed && checkId === checkIdRef.current && folderPathRef.current === nextFolderPath && metadataPathRef.current === nextMetadataPath) {
    setScriptImportNeeded(remaining ?? observed.scriptImportNeeded);
  }
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
