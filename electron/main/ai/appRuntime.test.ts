import { describe, expect, it, vi } from "vitest";
import { createAiAppHandlers, testComfyUiConnection } from "./appRuntime.js";
import type { AiCredentialStore } from "./credentials.js";
import type { AiSettingsStore } from "./settings.js";

const createResponse = ({
  ok,
  status,
  text = ""
}: {
  ok: boolean;
  status: number;
  text?: string;
}) => ({
  ok,
  status,
  text: vi.fn(async () => text)
});

describe("testComfyUiConnection", () => {
  it("checks normalized ComfyUI system stats", async () => {
    const fetchComfyUiConnection = vi.fn(async () => createResponse({ ok: true, status: 200 }));

    await expect(
      testComfyUiConnection("http://127.0.0.1:8188/", fetchComfyUiConnection)
    ).resolves.toEqual({ ok: true, message: "ComfyUI connection ready" });
    expect(fetchComfyUiConnection).toHaveBeenCalledWith(
      "http://127.0.0.1:8188/system_stats"
    );
  });

  it("uses response text for failed connection errors", async () => {
    const fetchComfyUiConnection = vi.fn(async () =>
      createResponse({ ok: false, status: 500, text: "ComfyUI is down" })
    );

    await expect(
      testComfyUiConnection("http://127.0.0.1:8188", fetchComfyUiConnection)
    ).rejects.toThrow("ComfyUI is down");
  });

  it("falls back to the status code when a failed response has no text", async () => {
    const fetchComfyUiConnection = vi.fn(async () =>
      createResponse({ ok: false, status: 503 })
    );

    await expect(
      testComfyUiConnection("http://127.0.0.1:8188", fetchComfyUiConnection)
    ).rejects.toThrow("ComfyUI connection failed with 503");
  });
});

describe("createAiAppHandlers", () => {
  it("wires ComfyUI connection checks through the injected fetch implementation", async () => {
    const fetchComfyUiConnection = vi.fn(async () =>
      createResponse({ ok: true, status: 200 })
    );
    const credentialStore: AiCredentialStore = {
      userDataPath: "/tmp/storyboard-flow-ai-test",
      crypto: {
        isEncryptionAvailable: () => false,
        encryptString: (value) => Buffer.from(value),
        decryptString: (value) => value.toString("utf8")
      }
    };
    const settingsStore: AiSettingsStore = {
      userDataPath: "/tmp/storyboard-flow-ai-test"
    };

    const handlers = createAiAppHandlers({
      aiCredentialStore: () => credentialStore,
      aiSettingsStore: () => settingsStore,
      clipboardWriteText: vi.fn(),
      createImageRecords: vi.fn(async () => []),
      fetchComfyUiConnection,
      trashItem: vi.fn(async () => undefined)
    });

    await expect(handlers.testComfyUiConnection("http://127.0.0.1:8188")).resolves.toEqual({
      ok: true,
      message: "ComfyUI connection ready"
    });
    expect(fetchComfyUiConnection).toHaveBeenCalledWith(
      "http://127.0.0.1:8188/system_stats"
    );
  });
});
