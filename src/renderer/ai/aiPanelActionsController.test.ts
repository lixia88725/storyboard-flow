import { describe, expect, it, vi } from "vitest";
import {
  createAiPanelActions,
  hasActiveAiCandidate
} from "./aiPanelActionsController";

describe("AI panel actions controller", () => {
  it("routes single-shot actions to the single candidate controller", async () => {
    const single = {
      applyCandidate: vi.fn(async () => undefined),
      copyRequestPreview: vi.fn(async () => undefined),
      discardCandidate: vi.fn(async () => undefined),
      generateCandidate: vi.fn(async () => undefined),
      hasCandidate: true
    };
    const batch = {
      applyBatchCandidates: vi.fn(async () => undefined),
      copyBatchRequestPreview: vi.fn(async () => undefined),
      discardBatchCandidates: vi.fn(async () => undefined),
      generateBatchCandidates: vi.fn(async () => undefined),
      hasBatchCandidates: true
    };

    const actions = createAiPanelActions({ mode: "single", single, batch });

    await actions.generate();
    await actions.copyRequestPreview();
    await actions.discardCandidate();
    await actions.applyCandidate();

    expect(single.generateCandidate).toHaveBeenCalledTimes(1);
    expect(single.copyRequestPreview).toHaveBeenCalledTimes(1);
    expect(single.discardCandidate).toHaveBeenCalledTimes(1);
    expect(single.applyCandidate).toHaveBeenCalledTimes(1);
    expect(batch.generateBatchCandidates).not.toHaveBeenCalled();
    expect(batch.copyBatchRequestPreview).not.toHaveBeenCalled();
    expect(batch.discardBatchCandidates).not.toHaveBeenCalled();
    expect(batch.applyBatchCandidates).not.toHaveBeenCalled();
  });

  it("routes multi-shot actions to the batch controller", async () => {
    const single = {
      applyCandidate: vi.fn(async () => undefined),
      copyRequestPreview: vi.fn(async () => undefined),
      discardCandidate: vi.fn(async () => undefined),
      generateCandidate: vi.fn(async () => undefined),
      hasCandidate: true
    };
    const batch = {
      applyBatchCandidates: vi.fn(async () => undefined),
      copyBatchRequestPreview: vi.fn(async () => undefined),
      discardBatchCandidates: vi.fn(async () => undefined),
      generateBatchCandidates: vi.fn(async () => undefined),
      hasBatchCandidates: false
    };

    const actions = createAiPanelActions({ mode: "batch", single, batch });

    await actions.generate();
    await actions.copyRequestPreview();
    await actions.discardCandidate();
    await actions.applyCandidate();

    expect(batch.generateBatchCandidates).toHaveBeenCalledTimes(1);
    expect(batch.copyBatchRequestPreview).toHaveBeenCalledTimes(1);
    expect(batch.discardBatchCandidates).toHaveBeenCalledTimes(1);
    expect(batch.applyBatchCandidates).toHaveBeenCalledTimes(1);
    expect(single.generateCandidate).not.toHaveBeenCalled();
    expect(single.copyRequestPreview).not.toHaveBeenCalled();
    expect(single.discardCandidate).not.toHaveBeenCalled();
    expect(single.applyCandidate).not.toHaveBeenCalled();
  });

  it("reports whether the active mode has candidates", () => {
    expect(hasActiveAiCandidate({ mode: "single", hasCandidate: true, hasBatchCandidates: false })).toBe(true);
    expect(hasActiveAiCandidate({ mode: "single", hasCandidate: false, hasBatchCandidates: true })).toBe(false);
    expect(hasActiveAiCandidate({ mode: "batch", hasCandidate: true, hasBatchCandidates: false })).toBe(false);
    expect(hasActiveAiCandidate({ mode: "batch", hasCandidate: false, hasBatchCandidates: true })).toBe(true);
  });
});
