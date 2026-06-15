import { describe, expect, it } from "vitest";
import {
  aiBatchApplySuccessStatus,
  aiBatchGenerationReadyStatus,
  aiBatchGenerationResetKey,
  hasAiBatchCandidates,
  type AiBatchCandidate,
  type AiBatchGroupResult
} from "./useAiBatchGenerationController";

const candidate: AiBatchCandidate = {
  id: "candidate-1",
  shotId: "shot-1",
  bitmapPath: ".storyboard-workbench/ai-candidates/candidate-1.png",
  filePath: "/workspace/.storyboard-workbench/ai-candidates/candidate-1.png",
  width: 1920,
  height: 1080,
  prompt: "Generate a 4-up storyboard contact sheet",
  createdAt: "2026-06-15T00:00:00.000Z"
};

const successfulGroup: AiBatchGroupResult = {
  index: 0,
  shotIds: ["shot-1", "shot-2"],
  candidateIds: ["candidate-1"]
};

describe("AI batch generation controller", () => {
  it("detects active batch candidates", () => {
    expect(hasAiBatchCandidates([])).toBe(false);
    expect(hasAiBatchCandidates([candidate])).toBe(true);
  });

  it("reports ready status with failed groups when present", () => {
    expect(aiBatchGenerationReadyStatus([candidate], [successfulGroup])).toBe(
      "1 AI batch candidates ready"
    );

    expect(
      aiBatchGenerationReadyStatus([candidate], [
        successfulGroup,
        {
          index: 1,
          shotIds: ["shot-3"],
          candidateIds: [],
          error: "Provider failed"
        }
      ])
    ).toBe("1 AI batch candidates ready; 1 group failed: #2");
  });

  it("keeps additive apply status explicit", () => {
    expect(aiBatchApplySuccessStatus(3)).toBe("3 AI Draft layers added");
  });

  it("resets batch candidates when folder or selected shots change", () => {
    expect(
      aiBatchGenerationResetKey({
        folderPath: "/workspace",
        selectedShotIds: ["shot-1", "shot-2"]
      })
    ).toBe("/workspace|shot-1|shot-2");
  });
});
