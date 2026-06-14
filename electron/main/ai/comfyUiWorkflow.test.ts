import { describe, expect, it } from "vitest";
import {
  renderComfyUiWorkflow,
  validateComfyUiServerUrl,
  validateComfyUiWorkflow
} from "./comfyUiWorkflow";

const workflow = JSON.stringify({
  "1": {
    class_type: "LoadImage",
    inputs: { image: "__SBF_IMAGE_1__" }
  },
  "2": {
    class_type: "CLIPTextEncode",
    inputs: { text: "__SBF_PROMPT__" }
  },
  "3": {
    class_type: "EmptyLatentImage",
    inputs: { width: "__SBF_WIDTH__", height: "__SBF_HEIGHT__", batch_size: 1 }
  },
  "4": {
    class_type: "KSampler",
    inputs: { seed: "__SBF_SEED__" }
  },
  "5": {
    class_type: "SaveImage",
    inputs: { filename_prefix: "__SBF_FILENAME_PREFIX__" }
  }
});

describe("ComfyUI workflow helpers", () => {
  it("allows only local ComfyUI server URLs", () => {
    expect(validateComfyUiServerUrl("http://127.0.0.1:8188")).toBe("http://127.0.0.1:8188");
    expect(validateComfyUiServerUrl("http://localhost:8188/")).toBe("http://localhost:8188");
    expect(validateComfyUiServerUrl("http://[::1]:8188")).toBe("http://[::1]:8188");
    expect(() => validateComfyUiServerUrl("http://192.168.1.20:8188")).toThrow("local ComfyUI");
    expect(() => validateComfyUiServerUrl("ftp://127.0.0.1:8188")).toThrow("http or https");
  });

  it("validates required placeholders and image capacity", () => {
    expect(validateComfyUiWorkflow(workflow, 1)).toMatchObject({
      ok: true,
      imagePlaceholderCount: 1
    });
    expect(validateComfyUiWorkflow(workflow.replace("__SBF_PROMPT__", "fixed"), 1).errors).toContain(
      "Workflow must include __SBF_PROMPT__"
    );
    expect(validateComfyUiWorkflow(workflow.replace("__SBF_IMAGE_1__", "fixed"), 1).errors).toContain(
      "Workflow must include __SBF_IMAGE_1__"
    );
    expect(validateComfyUiWorkflow(workflow.replace("__SBF_IMAGE_1__", "__SBF_IMAGE_2__"), 1).errors).toContain(
      "Workflow must include __SBF_IMAGE_1__"
    );
    expect(
      validateComfyUiWorkflow(
        workflow.replace("__SBF_IMAGE_1__", "__SBF_IMAGE_1__ and __SBF_IMAGE_3__"),
        1
      ).errors
    ).toContain("Workflow image placeholders must be continuous from __SBF_IMAGE_1__");
    expect(validateComfyUiWorkflow(workflow, 2).errors).toContain(
      "Workflow has 1 image placeholder but generation needs 2 images"
    );
    expect(validateComfyUiWorkflow("{", 1).errors).toContain("Workflow JSON is invalid");
  });

  it("renders prompt, uploaded image names, dimensions, seed, and filename prefix", () => {
    const rendered = renderComfyUiWorkflow({
      workflowJson: workflow,
      prompt: "Draw this storyboard panel.",
      uploadedImageNames: ["storyboard.png"],
      width: 1024,
      height: 576,
      seed: 123,
      filenamePrefix: "StoryboardFlow"
    });

    expect(rendered["1"].inputs.image).toBe("storyboard.png");
    expect(rendered["2"].inputs.text).toBe("Draw this storyboard panel.");
    expect(rendered["3"].inputs.width).toBe(1024);
    expect(rendered["3"].inputs.height).toBe(576);
    expect(rendered["4"].inputs.seed).toBe(123);
    expect(rendered["5"].inputs.filename_prefix).toBe("StoryboardFlow");
  });
});
