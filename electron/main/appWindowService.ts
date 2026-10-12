import type { BrowserWindow, BrowserWindowConstructorOptions, MessageBoxSyncOptions } from "electron";
import path from "node:path";
import {
  shouldCloseAfterUnsavedChangesPrompt,
  shouldSaveBeforeClose
} from "./closePrompt.js";

type CloseEvent = {
  preventDefault: () => void;
};

export type CloseManagedWindow = {
  destroy: () => void;
  webContents: {
    id: number;
    send: (channel: string, payload: unknown) => void;
  };
};

export const storyboardWindowOptions = (appPath: string): BrowserWindowConstructorOptions => ({
  width: 1440,
  height: 960,
  minWidth: 1100,
  minHeight: 720,
  title: "Storyboard Flow",
  backgroundColor: "#f3f0e8",
  webPreferences: {
    preload: path.join(appPath, "electron/preload/preload.cjs"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false
  }
});

export const closeWithoutSavingPromptOptions = (): MessageBoxSyncOptions => ({
  type: "warning",
  buttons: ["Save and Close", "Close Without Saving", "Cancel"],
  defaultId: 0,
  cancelId: 2,
  message: "Close without saving?",
  detail: "Storyboard Flow has unsaved changes. Save before closing to sync your edits back to the folder."
});

export type StoryboardWindowCloseOptions<Window extends CloseManagedWindow = CloseManagedWindow> = {
  closeGuardWebContentsIds: Set<number>;
  createRequestId: () => string;
  owner: Window | undefined;
  saveAndCloseRequests: Map<string, Window>;
  showMessageBoxSync: (owner: Window, options: MessageBoxSyncOptions) => number;
  closeProtection?: { begin: (owner: Window) => void };
};

export const handleStoryboardWindowClose = <Window extends CloseManagedWindow>(
  event: CloseEvent,
  {
    closeGuardWebContentsIds,
    createRequestId,
    owner,
    saveAndCloseRequests,
    showMessageBoxSync, closeProtection
  }: StoryboardWindowCloseOptions<Window>
): void => {
  if (owner && closeProtection) {
    event.preventDefault();
    closeProtection.begin(owner);
    return;
  }
  if (!owner || !closeGuardWebContentsIds.has(owner.webContents.id)) {
    return;
  }

  event.preventDefault();
  const buttonIndex = showMessageBoxSync(owner, closeWithoutSavingPromptOptions());

  if (shouldSaveBeforeClose(buttonIndex)) {
    const requestId = createRequestId();
    saveAndCloseRequests.set(requestId, owner);
    owner.webContents.send("app:saveAndClose", { requestId });
    return;
  }

  if (shouldCloseAfterUnsavedChangesPrompt(buttonIndex)) {
    owner.destroy();
  }
};

export const attachStoryboardWindowHandlers = (
  window: BrowserWindow,
  options: Omit<StoryboardWindowCloseOptions<BrowserWindow>, "owner">
): void => {
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${String(level)}] ${String(message)} (${String(sourceId)}:${String(line)})`);
  });

  window.webContents.on("preload-error", (_event, preloadPath, error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[preload-error] ${String(preloadPath)}: ${message}`);
  });

  window.on("close", (event) => {
    handleStoryboardWindowClose(event, {
      ...options,
      owner: window
    });
  });
};

export const loadStoryboardWindowEntry = async (
  window: Pick<BrowserWindow, "loadFile" | "loadURL">,
  { appPath, devServerUrl }: { appPath: string; devServerUrl?: string }
): Promise<void> => {
  if (devServerUrl) {
    await window.loadURL(devServerUrl);
    return;
  }

  await window.loadFile(path.join(appPath, "dist/index.html"));
};
