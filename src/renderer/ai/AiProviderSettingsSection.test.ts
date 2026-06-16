import { describe, expect, it } from "vitest";
import {
  aiProviderModelFieldLabel,
  aiProviderSettingsHeading,
  aiProviderSelectOptions
} from "./AiProviderSettingsSection";

describe("AiProviderSettingsSection", () => {
  it("keeps provider settings copy stable", () => {
    expect(aiProviderSettingsHeading()).toBe("General Settings");
    expect(aiProviderSelectOptions()).toEqual([
      { value: "openai", label: "OpenAI" },
      { value: "seedream", label: "Seedream" },
      { value: "comfyui", label: "ComfyUI" }
    ]);
  });

  it("uses the active provider model label", () => {
    expect(aiProviderModelFieldLabel("openai")).toBe("OpenAI Model");
    expect(aiProviderModelFieldLabel("seedream")).toBe("Seedream Model / Endpoint ID");
  });
});
