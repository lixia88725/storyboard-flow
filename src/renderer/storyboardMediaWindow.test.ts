import { describe, expect, it, vi } from "vitest";
import {
  shouldMountStoryboardEditor,
  storyboardMediaTierForVisibility
} from "./storyboardMediaWindow";
import {
  createStoryboardMediaVisibilityDispatcher,
  createStoryboardMediaWindowInteractionController
} from "./storyboardMediaWindowInteraction";

describe("storyboardMediaWindow", () => {
  it("separates cold, warm image preloading, and hot editor mounting", () => {
    expect(
      storyboardMediaTierForVisibility({
        isWarm: false,
        isHot: false,
        pinned: false
      })
    ).toBe("cold");
    expect(
      storyboardMediaTierForVisibility({
        isWarm: true,
        isHot: false,
        pinned: false
      })
    ).toBe("warm");
    expect(
      storyboardMediaTierForVisibility({
        isWarm: true,
        isHot: true,
        pinned: false
      })
    ).toBe("hot");
  });

  it("lets the hot range, but not the warm range, mount an editor", () => {
    expect(shouldMountStoryboardEditor("hot")).toBe(true);
    expect(shouldMountStoryboardEditor("warm")).toBe(false);
    expect(shouldMountStoryboardEditor("cold")).toBe(false);
  });

  it("keeps selected, drawing, animation, or panel-pinned shots hot", () => {
    expect(
      storyboardMediaTierForVisibility({
        isWarm: false,
        isHot: false,
        pinned: true
      })
    ).toBe("hot");
  });

  it("treats hot visibility as hot even if observer callbacks arrive out of order", () => {
    expect(
      storyboardMediaTierForVisibility({
        isWarm: false,
        isHot: true,
        pinned: false
      })
    ).toBe("hot");
  });

  it("freezes visibility delivery and reconciles at most six tiers per frame in priority order", () => {
    const controller = createStoryboardMediaWindowInteractionController();
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 0;
    const dispatcher = createStoryboardMediaVisibilityDispatcher({
      interactionController: controller,
      scheduler: {
        requestAnimationFrame(callback) {
          const frameId = ++nextFrameId;
          frames.set(frameId, callback);
          return frameId;
        },
        cancelAnimationFrame(frameId) {
          frames.delete(frameId);
        }
      }
    });
    const elements = Array.from({ length: 14 }, () => ({} as Element));
    const delivered: Array<{ index: number; isWarm: boolean; isHot: boolean }> = [];
    elements.forEach((element, index) => {
      dispatcher.observe(element, (visibility) => {
        delivered.push({ index, ...visibility });
      });
    });
    elements.slice(0, 8).forEach((element) => {
      dispatcher.updateVisibility(element, { isWarm: true, isHot: true });
    });
    delivered.length = 0;

    const lease = controller.beginInteraction();
    elements.slice(0, 8).forEach((element) => {
      dispatcher.updateVisibility(element, { isWarm: false, isHot: false });
    });
    elements.slice(8, 12).forEach((element) => {
      dispatcher.updateVisibility(element, { isWarm: true, isHot: true });
    });
    elements.slice(12).forEach((element) => {
      dispatcher.updateVisibility(element, { isWarm: true });
    });

    expect(delivered).toEqual([]);
    lease.release();
    expect(frames.size).toBe(1);

    const runNextFrame = () => {
      const [frameId, callback] = frames.entries().next().value as [
        number,
        FrameRequestCallback
      ];
      frames.delete(frameId);
      callback(0);
    };
    runNextFrame();
    expect(delivered.map(({ index }) => index)).toEqual([0, 1, 2, 3, 4, 5]);
    runNextFrame();
    expect(delivered.slice(6).map(({ index }) => index)).toEqual([
      6, 7, 8, 9, 10, 11
    ]);
    runNextFrame();
    expect(delivered.slice(12).map(({ index }) => index)).toEqual([12, 13]);
    expect(frames.size).toBe(0);
  });

  it("cancels an old restore queue when a new marquee interaction starts", () => {
    const controller = createStoryboardMediaWindowInteractionController();
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextFrameId = 0;
    const dispatcher = createStoryboardMediaVisibilityDispatcher({
      interactionController: controller,
      scheduler: {
        requestAnimationFrame(callback) {
          const frameId = ++nextFrameId;
          callbacks.set(frameId, callback);
          return frameId;
        },
        cancelAnimationFrame(frameId) {
          callbacks.delete(frameId);
        }
      },
      batchSize: 1
    });
    const element = {} as Element;
    const listener = vi.fn();
    dispatcher.observe(element, listener);
    const firstLease = controller.beginInteraction();
    dispatcher.updateVisibility(element, { isWarm: true, isHot: true });
    firstLease.release();
    expect(callbacks.size).toBe(1);

    const secondLease = controller.beginInteraction();
    expect(callbacks.size).toBe(0);
    expect(listener).not.toHaveBeenCalled();
    secondLease.release();
    expect(callbacks.size).toBe(1);
  });
});
