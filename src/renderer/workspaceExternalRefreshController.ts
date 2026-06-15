import { useEffect, useRef } from "react";

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
