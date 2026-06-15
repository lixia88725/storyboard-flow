import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { isLikelyTiffPath } from "./photoshopTiffImport.js";
import { storyboardScriptFileName } from "./storyboardScript.js";
import { isWorkspaceTemporaryImagePath } from "./workspaceTemporaryPaths.js";

type WatchLike = (
  folderPath: string,
  options: { persistent: boolean },
  listener: (eventType: string, fileName: string | Buffer | null) => void
) => Pick<FSWatcher, "close" | "on">;

type SenderLike = {
  send: (channel: string, payload: unknown) => void;
};

export const shouldNotifyWorkspaceFolderChange = (fileName: string | undefined): boolean => {
  const changedName = fileName ?? "";
  return Boolean(
    changedName &&
      !changedName.includes(path.sep) &&
      !isWorkspaceTemporaryImagePath(changedName) &&
      (isLikelyTiffPath(changedName) || changedName === storyboardScriptFileName)
  );
};

export const createWorkspaceFolderWatchService = ({
  watch: watchFolder = watch as WatchLike
}: {
  watch?: WatchLike;
} = {}) => {
  const watchers = new Map<number, Pick<FSWatcher, "close" | "on">>();
  let nextWatcherId = 1;

  const stop = (watcherId: number): void => {
    watchers.get(watcherId)?.close();
    watchers.delete(watcherId);
  };

  return {
    start: (folderPath: string, sender: SenderLike): number => {
      const watcherId = nextWatcherId++;
      const watcher = watchFolder(folderPath, { persistent: false }, (_eventType, fileName) => {
        const changedName = fileName?.toString();
        if (!shouldNotifyWorkspaceFolderChange(changedName)) {
          return;
        }

        sender.send("workspace:folderChanged", { folderPath, fileName: changedName });
      });
      watchers.set(watcherId, watcher);
      watcher.on("error", () => {
        watchers.delete(watcherId);
      });
      return watcherId;
    },
    stop,
    closeAll: (): void => {
      for (const watcher of watchers.values()) {
        watcher.close();
      }
      watchers.clear();
    }
  };
};
