import { describe, expect, it } from "vitest";
import { nextRangeSelection } from "./rangeSelection";

const orderedIds = ["item-1", "item-2", "item-3", "item-4", "item-5"];

describe("range selection", () => {
  it("selects a single clicked item and stores it as the range anchor", () => {
    expect(
      nextRangeSelection({
        orderedIds,
        selectedIds: ["item-1", "item-3"],
        clickedId: "item-4",
        anchorId: "item-1",
        mode: "single"
      })
    ).toEqual({ selectedIds: ["item-4"], anchorId: "item-4" });
  });

  it("toggles non-contiguous items with the multi-select modifier", () => {
    const first = nextRangeSelection({
      orderedIds,
      selectedIds: [],
      clickedId: "item-1",
      anchorId: undefined,
      mode: "toggle"
    });
    const second = nextRangeSelection({
      orderedIds,
      selectedIds: first.selectedIds,
      clickedId: "item-5",
      anchorId: first.anchorId,
      mode: "toggle"
    });

    expect(second).toEqual({ selectedIds: ["item-1", "item-5"], anchorId: "item-5" });
  });

  it("selects a forward continuous range from the anchor with shift", () => {
    expect(
      nextRangeSelection({
        orderedIds,
        selectedIds: ["item-1"],
        clickedId: "item-5",
        anchorId: "item-1",
        mode: "range"
      })
    ).toEqual({ selectedIds: ["item-1", "item-2", "item-3", "item-4", "item-5"], anchorId: "item-1" });
  });

  it("selects a reverse continuous range from the anchor with shift", () => {
    expect(
      nextRangeSelection({
        orderedIds,
        selectedIds: ["item-5"],
        clickedId: "item-2",
        anchorId: "item-5",
        mode: "range"
      })
    ).toEqual({ selectedIds: ["item-2", "item-3", "item-4", "item-5"], anchorId: "item-5" });
  });

  it("falls back to a single selection when shift has no valid anchor", () => {
    expect(
      nextRangeSelection({
        orderedIds,
        selectedIds: [],
        clickedId: "item-3",
        anchorId: undefined,
        mode: "range"
      })
    ).toEqual({ selectedIds: ["item-3"], anchorId: "item-3" });
  });

  it("removes toggled items while keeping the clicked item as the next range anchor", () => {
    expect(
      nextRangeSelection({
        orderedIds,
        selectedIds: ["item-1", "item-5"],
        clickedId: "item-5",
        anchorId: "item-5",
        mode: "toggle"
      })
    ).toEqual({ selectedIds: ["item-1"], anchorId: "item-5" });
  });
});
