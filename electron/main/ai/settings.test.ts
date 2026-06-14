import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultComfyUiSettings,
  readAiSettings,
  writeComfyUiSettings
} from "./settings";

describe("AI app settings", () => {
  it("reads default ComfyUI settings when no app settings file exists", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "swb-ai-settings-"));

    await expect(readAiSettings({ userDataPath })).resolves.toEqual({
      comfyUi: defaultComfyUiSettings
    });
  });

  it("persists non-sensitive ComfyUI settings under app userData", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "swb-ai-settings-"));
    const settings = await writeComfyUiSettings(
      { userDataPath },
      {
        serverUrl: "http://localhost:8188/",
        workflowJson: "{\"1\":{\"inputs\":{\"text\":\"__SBF_PROMPT__\",\"image\":\"__SBF_IMAGE_1__\"}}}",
        timeoutMs: 45000
      }
    );

    expect(settings.comfyUi).toEqual({
      serverUrl: "http://localhost:8188",
      workflowJson: "{\"1\":{\"inputs\":{\"text\":\"__SBF_PROMPT__\",\"image\":\"__SBF_IMAGE_1__\"}}}",
      timeoutMs: 45000
    });
    const raw = await readFile(path.join(userDataPath, "ai-settings.json"), "utf8");
    expect(raw).toContain("__SBF_PROMPT__");
    expect(raw).not.toContain("apiKey");
  });
});
