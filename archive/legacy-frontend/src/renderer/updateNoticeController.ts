import { useCallback, useEffect, useState } from "react";
import {
  cacheBustedUpdateManifestUrl,
  findAvailableUpdate,
  isVersionGreater,
  parseUpdateManifest,
  type AvailableUpdate,
  type UpdateManifest
} from "../shared/updateManifest";

export type UpdateNoticeState =
  | { status: "idle" | "checking" | "current" | "dismissed" }
  | { status: "available"; update: AvailableUpdate }
  | { status: "error"; message: string };

export type UpdateNoticeAppInfo = {
  version: string;
  platform: NodeJS.Platform | string;
  arch: NodeJS.Architecture | string;
};

export const resolveUpdateNoticeFromManifest = ({
  appInfo,
  manifest
}: {
  appInfo: UpdateNoticeAppInfo;
  manifest: UpdateManifest;
}): UpdateNoticeState => {
  const platformUpdate = findAvailableUpdate({
    currentVersion: appInfo.version,
    platform: appInfo.platform,
    arch: appInfo.arch,
    manifest
  });
  const update =
    platformUpdate ??
    (isVersionGreater(manifest.latest, appInfo.version)
      ? {
          version: manifest.latest,
          notes: `No direct ${appInfo.platform}/${appInfo.arch} package is listed. Open the release page to choose manually.`,
          releaseUrl: manifest.releaseUrl,
          downloadUrl: manifest.releaseUrl
        }
      : undefined);
  return update ? { status: "available", update } : { status: "current" };
};

export const useUpdateNoticeController = ({
  setStatus
}: {
  setStatus: (status: string) => void;
}) => {
  const [updateNotice, setUpdateNotice] = useState<UpdateNoticeState>({ status: "idle" });

  const checkForUpdates = useCallback(async (notifyWhenCurrent = false) => {
    if (!window.storyboard?.getAppInfo) {
      return;
    }

    setUpdateNotice({ status: "checking" });
    try {
      const appInfo = await window.storyboard.getAppInfo();
      const manifestUrl = cacheBustedUpdateManifestUrl(appInfo.updateManifestUrl, Date.now());
      const response = await fetch(manifestUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Update check failed with status ${response.status}`);
      }

      const manifest = parseUpdateManifest(await response.json());
      if (!manifest) {
        throw new Error("Update manifest is invalid.");
      }

      const nextNotice = resolveUpdateNoticeFromManifest({ appInfo, manifest });
      setUpdateNotice(nextNotice);
      if (nextNotice.status === "current" && notifyWhenCurrent) {
        setStatus(`Storyboard Flow ${appInfo.version} is up to date`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setUpdateNotice({ status: "error", message });
      if (notifyWhenCurrent) {
        setStatus(`Update check failed: ${message}`);
      }
    }
  }, [setStatus]);

  useEffect(() => {
    void checkForUpdates(false);
  }, [checkForUpdates]);

  const openUpdateDownload = (update: AvailableUpdate) => {
    void window.storyboard?.openExternal(update.downloadUrl).catch((error) => {
      setStatus(`Could not open update download: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  return {
    updateNotice,
    setUpdateNotice,
    checkForUpdates,
    openUpdateDownload
  };
};
