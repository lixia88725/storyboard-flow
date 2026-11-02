import { describe, expect, it } from "vitest";
import {
  anchorBeforeId,
  boardBlocks,
  caretRange,
  commitPayload,
  decodeDragPayload,
  dropIndexFromPoint,
  encodeDragPayload,
  hardLineCount,
  moveCommit,
  reconcileBlocks,
  reorderBlocks,
  sameDialogues,
  sameOrder,
  type DialogueBlock,
  type DraftBlock
} from "./model";

const block = (id: string, text: string, shotId = "a"): DialogueBlock => ({ id, shotId, text });
const typed = (id: string, text: string, pending: boolean): DraftBlock => ({ id, shotId: "a", text, pending });

describe("late echo", () => {
  it("holds typed text until the host echoes it, then settles", () => {
    const lagging = reconcileBlocks([typed("d1", "你好", true)], [block("d1", "你")]);
    expect(lagging).toEqual([{ id: "d1", shotId: "a", text: "你好", pending: true }]);
    const echoed = reconcileBlocks(lagging, [block("d1", "你好")]);
    expect(echoed).toEqual([{ id: "d1", shotId: "a", text: "你好", pending: false }]);
  });

  it("keeps a split the host has not echoed yet in its own place", () => {
    const split = [typed("new-head", "前半", true), typed("d1", "后半", false)];
    expect(reconcileBlocks(split, [block("d1", "后半")]).map((item) => item.id)).toEqual(["new-head", "d1"]);
    const trailing = [typed("d1", "整句", false), typed("new-tail", "", true)];
    expect(reconcileBlocks(trailing, [block("d1", "整句")]).map((item) => item.id)).toEqual(["d1", "new-tail"]);
  });
});

describe("undo", () => {
  it("accepts a host change once the block has settled, in both directions", () => {
    expect(reconcileBlocks([typed("d1", "你好", false)], [block("d1", "")]).map((item) => item.text)).toEqual([""]);
    expect(reconcileBlocks([typed("d1", "", false)], [block("d1", "你好")]).map((item) => item.text)).toEqual(["你好"]);
  });

  it("lets the host order win while untyped text still comes from the draft", () => {
    const held = [typed("d1", "甲改", true), typed("d2", "乙", false)];
    const echoed = reconcileBlocks(held, [block("d2", "乙"), block("d1", "甲")]);
    expect(echoed.map((item) => `${item.id}:${item.text}`)).toEqual(["d2:乙", "d1:甲改"]);
  });
});

describe("board isolation", () => {
  it("only ever exposes one board's rows, so a switch cannot carry another board's text", () => {
    const rows = [block("d1", "甲的台词", "a"), block("d2", "乙的台词", "b")];
    expect(boardBlocks(rows, "b")).toEqual([{ id: "d2", shotId: "b", text: "乙的台词" }]);
    expect(boardBlocks(rows, "c")).toEqual([]);
    expect(reconcileBlocks([], boardBlocks(rows, "c"))).toEqual([]);
  });
});

describe("commit payloads", () => {
  it("never turns a blank draft into an empty dialogue, and keeps exact text", () => {
    expect(commitPayload("a", [block("d1", "   "), block("d2", " 你好 ")])).toEqual([
      { id: "d2", shotId: "a", text: " 你好 " }
    ]);
    expect(commitPayload("a", [])).toEqual([]);
  });

  it("compares payloads by identity, board and text", () => {
    expect(sameDialogues([block("d1", "甲")], [block("d1", "甲")])).toBe(true);
    expect(sameDialogues([block("d1", "甲")], [block("d1", "乙")])).toBe(false);
    expect(sameDialogues([block("d1", "甲")], [block("d1", "甲", "b")])).toBe(false);
    expect(sameDialogues([block("d1", "甲")], [block("d2", "甲")])).toBe(false);
  });

  it("expresses a cross-board insertion in one move, with and without an anchor", () => {
    expect(moveCommit("b", "d1", "d9")).toEqual({
      kind: "moveDialogues",
      dialogueIds: ["d1"],
      targetShotId: "b",
      beforeId: "d9"
    });
    expect(moveCommit("b", "d1", undefined)).toEqual({
      kind: "moveDialogues",
      dialogueIds: ["d1"],
      targetShotId: "b"
    });
  });
});

describe("drop placement", () => {
  it("inserts before the middle of the hovered block and appends past the last one", () => {
    const rects = [
      { top: 0, bottom: 10 },
      { top: 10, bottom: 20 }
    ];
    expect(dropIndexFromPoint(rects, 4)).toBe(0);
    expect(dropIndexFromPoint(rects, 9)).toBe(1);
    expect(dropIndexFromPoint(rects, 19)).toBe(2);
    expect(dropIndexFromPoint([], 3)).toBe(0);
  });

  it("anchors on the following dialogue and appends when there is none", () => {
    expect(anchorBeforeId([block("d1", "一"), block("d2", "二")], 0)).toBe("d1");
    expect(anchorBeforeId([block("d1", "一")], 1)).toBeUndefined();
    expect(anchorBeforeId([], 0)).toBeUndefined();
  });

  it("changes nothing when a block is dropped onto its own position", () => {
    const blocks = [block("d1", "一"), block("d2", "二"), block("d3", "三")];
    expect(sameOrder(reorderBlocks(blocks, "d2", 1), blocks)).toBe(true);
    expect(sameOrder(reorderBlocks(blocks, "d2", 2), blocks)).toBe(true);
    expect(sameOrder(reorderBlocks(blocks, "missing", 0), blocks)).toBe(true);
    expect(reorderBlocks(blocks, "d1", 3).map((item) => item.id)).toEqual(["d2", "d3", "d1"]);
    expect(reorderBlocks(blocks, "d3", 0).map((item) => item.id)).toEqual(["d3", "d1", "d2"]);
  });
});

describe("text measurement", () => {
  it("counts only hard newlines, so soft wrapping adds no rows", () => {
    expect(hardLineCount("一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十")).toBe(1);
    expect(hardLineCount("甲\n乙")).toBe(2);
    expect(hardLineCount("")).toBe(1);
  });

  it("normalises a reversed range and never lands inside a surrogate pair", () => {
    expect(caretRange("abc", 2, 0)).toEqual({ start: 0, end: 2 });
    expect(caretRange("abc", null, null)).toEqual({ start: 3, end: 3 });
    expect(caretRange("😀ab", 1, 1)).toEqual({ start: 0, end: 0 });
    expect(caretRange("😀ab", 2, 4)).toEqual({ start: 2, end: 4 });
  });
});

describe("drag payload", () => {
  it("round-trips board identity and still reads the legacy bare id", () => {
    expect(decodeDragPayload(encodeDragPayload({ id: "d1", shotId: "a" }))).toEqual({ id: "d1", shotId: "a" });
    expect(decodeDragPayload("d1")).toEqual({ id: "d1", shotId: "" });
    expect(decodeDragPayload("")).toBeNull();
    expect(decodeDragPayload(undefined)).toBeNull();
  });
});
