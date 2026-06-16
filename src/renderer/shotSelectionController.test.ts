import { describe, expect, it, vi } from "vitest";
import { createShotSelectionController } from "./shotSelectionController";

const createHarness = () => {
  const selectedShotIdsRef = { current: ["shot-1"] };
  const shotSelectionAnchorIdRef = { current: "shot-1" as string | undefined };
  const blurActiveFormControl = vi.fn();
  const setDeleteTarget = vi.fn();
  const setSelectedBitmapLayerIds = vi.fn();
  const setSelectedShotIds = vi.fn((shotIds: string[]) => {
    selectedShotIdsRef.current = shotIds;
  });
  const controller = createShotSelectionController({
    blurActiveFormControl,
    isEditableTarget: (target: EventTarget | null) => target === editableTarget,
    orderedShotIds: ["shot-1", "shot-2", "shot-3", "shot-4"],
    selectedShotIdsRef,
    shotSelectionAnchorIdRef,
    setDeleteTarget,
    setSelectedBitmapLayerIds,
    setSelectedShotIds
  });

  return {
    blurActiveFormControl,
    controller,
    selectedShotIdsRef,
    setDeleteTarget,
    setSelectedBitmapLayerIds,
    setSelectedShotIds,
    shotSelectionAnchorIdRef
  };
};

const editableTarget = new EventTarget();
const nonEditableTarget = new EventTarget();

describe("shotSelectionController", () => {
  it("selects one shot and keeps the selection ref and range anchor in sync", () => {
    const { controller, selectedShotIdsRef, setSelectedShotIds, shotSelectionAnchorIdRef } =
      createHarness();

    controller.selectSingleShot("shot-3");

    expect(selectedShotIdsRef.current).toEqual(["shot-3"]);
    expect(shotSelectionAnchorIdRef.current).toBe("shot-3");
    expect(setSelectedShotIds).toHaveBeenCalledWith(["shot-3"]);
  });

  it("clears the selected shot and range anchor together", () => {
    const { controller, selectedShotIdsRef, setSelectedShotIds, shotSelectionAnchorIdRef } =
      createHarness();

    controller.clearSelectedShots();

    expect(selectedShotIdsRef.current).toEqual([]);
    expect(shotSelectionAnchorIdRef.current).toBeUndefined();
    expect(setSelectedShotIds).toHaveBeenCalledWith([]);
  });

  it("uses the last selected shot as the next range anchor for explicit id selections", () => {
    const { controller, selectedShotIdsRef, setSelectedShotIds, shotSelectionAnchorIdRef } =
      createHarness();

    controller.selectShotsByIds(["shot-2", "shot-4"]);

    expect(selectedShotIdsRef.current).toEqual(["shot-2", "shot-4"]);
    expect(shotSelectionAnchorIdRef.current).toBe("shot-4");
    expect(setSelectedShotIds).toHaveBeenCalledWith(["shot-2", "shot-4"]);
  });

  it("selects a range from the synced anchor and updates refs and state", () => {
    const { controller, selectedShotIdsRef, setSelectedShotIds, shotSelectionAnchorIdRef } =
      createHarness();

    controller.selectShotWithMode("shot-4", "range");

    expect(selectedShotIdsRef.current).toEqual(["shot-1", "shot-2", "shot-3", "shot-4"]);
    expect(shotSelectionAnchorIdRef.current).toBe("shot-1");
    expect(setSelectedShotIds).toHaveBeenCalledWith(["shot-1", "shot-2", "shot-3", "shot-4"]);
  });

  it("handles shot click side effects before selecting with the requested mode", () => {
    const {
      blurActiveFormControl,
      controller,
      selectedShotIdsRef,
      setDeleteTarget,
      setSelectedBitmapLayerIds,
      setSelectedShotIds
    } = createHarness();

    controller.handleShotSelect("shot-3", {
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      target: nonEditableTarget
    });

    expect(blurActiveFormControl).toHaveBeenCalledTimes(1);
    expect(setDeleteTarget).toHaveBeenCalledWith({ type: "shot" });
    expect(setSelectedBitmapLayerIds).toHaveBeenCalledWith(undefined);
    expect(selectedShotIdsRef.current).toEqual(["shot-1", "shot-3"]);
    expect(setSelectedShotIds).toHaveBeenCalledWith(["shot-1", "shot-3"]);
  });

  it("does not blur editable targets when handling shot clicks", () => {
    const { blurActiveFormControl, controller } = createHarness();

    controller.handleShotSelect("shot-2", {
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      target: editableTarget
    });

    expect(blurActiveFormControl).not.toHaveBeenCalled();
  });
});
