import { describe, expect, it, vi } from "vitest";
import {
  closeWithoutSavingPromptOptions,
  handleStoryboardWindowClose,
  loadStoryboardWindowEntry,
  storyboardWindowOptions
} from "./appWindowService";

const fakeWindow = () => ({
  destroy: vi.fn(),
  loadFile: vi.fn(async () => undefined),
  loadURL: vi.fn(async () => undefined),
  on: vi.fn(),
  webContents: {
    id: 42,
    on: vi.fn(),
    send: vi.fn()
  }
});

describe("appWindowService", () => {
  it("builds the Storyboard Flow browser window options", () => {
    expect(storyboardWindowOptions("/app")).toMatchObject({
      width: 1440,
      height: 960,
      minWidth: 1100,
      minHeight: 720,
      title: "Storyboard Flow",
      backgroundColor: "#f3f0e8",
      webPreferences: {
        preload: "/app/electron/preload/preload.cjs",
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    });
  });

  it("leaves unguarded window close events alone", () => {
    const owner = fakeWindow();
    const event = { preventDefault: vi.fn() };

    handleStoryboardWindowClose(event, {
      closeGuardWebContentsIds: new Set(),
      createRequestId: () => "request-1",
      owner,
      saveAndCloseRequests: new Map(),
      showMessageBoxSync: vi.fn(() => 0)
    });

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(owner.webContents.send).not.toHaveBeenCalled();
    expect(owner.destroy).not.toHaveBeenCalled();
  });

  it("requests renderer Save before closing when the prompt chooses Save and Close", () => {
    const owner = fakeWindow();
    const event = { preventDefault: vi.fn() };
    const requests = new Map();

    handleStoryboardWindowClose(event, {
      closeGuardWebContentsIds: new Set([42]),
      createRequestId: () => "request-1",
      owner,
      saveAndCloseRequests: requests,
      showMessageBoxSync: vi.fn(() => 0)
    });

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(requests.get("request-1")).toBe(owner);
    expect(owner.webContents.send).toHaveBeenCalledWith("app:saveAndClose", {
      requestId: "request-1"
    });
    expect(owner.destroy).not.toHaveBeenCalled();
  });

  it("destroys the window when the prompt chooses Close Without Saving", () => {
    const owner = fakeWindow();

    handleStoryboardWindowClose(
      { preventDefault: vi.fn() },
      {
        closeGuardWebContentsIds: new Set([42]),
        createRequestId: () => "request-1",
        owner,
        saveAndCloseRequests: new Map(),
        showMessageBoxSync: vi.fn(() => 1)
      }
    );

    expect(owner.destroy).toHaveBeenCalledOnce();
    expect(owner.webContents.send).not.toHaveBeenCalled();
  });

  it("keeps the window open when the prompt chooses Cancel", () => {
    const owner = fakeWindow();

    handleStoryboardWindowClose(
      { preventDefault: vi.fn() },
      {
        closeGuardWebContentsIds: new Set([42]),
        createRequestId: () => "request-1",
        owner,
        saveAndCloseRequests: new Map(),
        showMessageBoxSync: vi.fn(() => 2)
      }
    );

    expect(owner.destroy).not.toHaveBeenCalled();
    expect(owner.webContents.send).not.toHaveBeenCalled();
  });

  it("uses the same close prompt copy as the previous inline handler", () => {
    expect(closeWithoutSavingPromptOptions()).toMatchObject({
      buttons: ["Save and Close", "Close Without Saving", "Cancel"],
      message: "Close without saving?"
    });
  });

  it("loads the dev server URL or packaged index", async () => {
    const devWindow = fakeWindow();
    await loadStoryboardWindowEntry(devWindow, {
      appPath: "/app",
      devServerUrl: "http://localhost:5173"
    });
    expect(devWindow.loadURL).toHaveBeenCalledWith("http://localhost:5173");
    expect(devWindow.loadFile).not.toHaveBeenCalled();

    const packagedWindow = fakeWindow();
    await loadStoryboardWindowEntry(packagedWindow, { appPath: "/app" });
    expect(packagedWindow.loadFile).toHaveBeenCalledWith("/app/dist/index.html");
  });
});
