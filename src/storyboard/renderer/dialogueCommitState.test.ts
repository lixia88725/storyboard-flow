import { describe, expect, it } from "vitest";
import { createDialogueCommitState } from "./dialogueCommitState";

describe("dialogue commit state", () => {
  it("is idle until an editor composes", () => {
    const state = createDialogueCommitState();
    expect(state.busy()).toBe(false);
    expect(state.holdShots()).toEqual([]);
    state.report("editor", { shotId: "a", composing: true });
    expect(state.busy()).toBe(true);
    expect(state.composingShots()).toEqual(["a"]);
    expect(state.holdShots()).toEqual(["a"]);
    state.report("editor", { shotId: "a", composing: false });
    expect(state.busy()).toBe(false);
  });

  it("keeps a committed board held until that request settles", () => {
    const state = createDialogueCommitState();
    const id = state.begin("b", "panel");
    expect(state.busy()).toBe(true);
    expect(state.holdShots()).toEqual(["b"]);
    state.settle(id, true);
    expect(state.busy()).toBe(false);
    expect(state.holdShots()).toEqual([]);
  });

  it("does not let an unrelated board's success release a failed commit", () => {
    const state = createDialogueCommitState();
    const a = state.begin("a", "panel");
    const b = state.begin("b", "track");
    state.settle(a, false);
    state.settle(b, true);
    expect(state.busy()).toBe(true);
    expect(state.holdShots()).toEqual(["a"]);
  });

  it("keeps the failure in the opposite completion order too", () => {
    const state = createDialogueCommitState();
    const a = state.begin("a", "panel");
    const b = state.begin("b", "track");
    state.settle(b, true);
    state.settle(a, false);
    expect(state.busy()).toBe(true);
    expect(state.holdShots()).toEqual(["a"]);
  });

  it("lets a newer commit from the same editor supersede its own earlier one", () => {
    const state = createDialogueCommitState();
    state.begin("a", "panel");
    const second = state.begin("a", "panel");
    state.settle(second, true);
    expect(state.busy()).toBe(false);
    expect(state.holdShots()).toEqual([]);
  });

  it("keeps a newer failure even after the older text was installed", () => {
    const state = createDialogueCommitState();
    const first = state.begin("a", "panel");
    const second = state.begin("a", "panel");
    state.settle(first, true);
    expect(state.busy()).toBe(true); // the newer text is still unsaved
    state.settle(second, false);
    expect(state.busy()).toBe(true);
    expect(state.holdShots()).toEqual(["a"]);
    const third = state.begin("a", "panel");
    state.settle(third, true);
    expect(state.busy()).toBe(false);
  });

  it("keeps another editor's unsaved text on the same board", () => {
    const state = createDialogueCommitState();
    // The info panel's text X fails; the dialogue track commits Y from a snapshot that never
    // contained X. The track's success must not release the panel's obligation.
    const panel = state.begin("s", "panel");
    const track = state.begin("s", "track");
    state.settle(panel, false);
    state.settle(track, true);
    expect(state.busy()).toBe(true);
    expect(state.holdShots()).toEqual(["s"]);
    // Only the panel's own retry (with its text X) settles it.
    const retry = state.begin("s", "panel");
    state.settle(retry, true);
    expect(state.busy()).toBe(false);
    expect(state.holdShots()).toEqual([]);
  });

  it("settles a board only after every editor that wrote it said so", () => {
    const state = createDialogueCommitState();
    const panel = state.begin("s", "panel");
    const track = state.begin("s", "track");
    state.settle(panel, true);
    expect(state.busy()).toBe(true);
    state.settle(track, true);
    expect(state.busy()).toBe(false);
  });

  it("ignores a settle for a request it does not know", () => {
    const state = createDialogueCommitState();
    state.settle(99, true);
    expect(state.busy()).toBe(false);
    const id = state.begin("a", "panel");
    state.settle(id, true);
    state.settle(id, true);
    expect(state.busy()).toBe(false);
  });

  it("treats unmounting an editor as releasing composition only", () => {
    const state = createDialogueCommitState();
    state.report("editor", { shotId: "a", composing: true });
    const id = state.begin("a", "panel");
    state.report("editor", null);
    expect(state.busy()).toBe(true);
    expect(state.holdShots()).toEqual(["a"]);
    state.settle(id, false);
    expect(state.busy()).toBe(true);
  });

  it("holds every unsettled board, not only the latest one", () => {
    const state = createDialogueCommitState();
    state.begin("a", "panel");
    state.begin("b", "track");
    state.report("editor", { shotId: "c", composing: true });
    expect(state.holdShots().sort()).toEqual(["a", "b", "c"]);
    expect(state.composingShots()).toEqual(["c"]);
  });

  it("resets cleanly", () => {
    const state = createDialogueCommitState();
    state.begin("a", "panel");
    state.report("editor", { shotId: "b", composing: true });
    state.reset();
    expect(state.busy()).toBe(false);
    expect(state.holdShots()).toEqual([]);
  });
});
