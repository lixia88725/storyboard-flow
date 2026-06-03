import { describe, expect, it } from "vitest";
import {
  closeWithoutSavingButtonIndex,
  saveAndCloseButtonIndex,
  shouldCloseAfterUnsavedChangesPrompt,
  shouldSaveBeforeClose
} from "./closePrompt.js";

describe("shouldCloseAfterUnsavedChangesPrompt", () => {
  it("keeps the window open when the user cancels or saves first", () => {
    expect(shouldCloseAfterUnsavedChangesPrompt(saveAndCloseButtonIndex)).toBe(false);
    expect(shouldCloseAfterUnsavedChangesPrompt(2)).toBe(false);
  });

  it("allows closing when the user chooses to close without saving", () => {
    expect(shouldCloseAfterUnsavedChangesPrompt(closeWithoutSavingButtonIndex)).toBe(true);
  });
});

describe("shouldSaveBeforeClose", () => {
  it("starts save-and-close only for the save button", () => {
    expect(shouldSaveBeforeClose(saveAndCloseButtonIndex)).toBe(true);
    expect(shouldSaveBeforeClose(closeWithoutSavingButtonIndex)).toBe(false);
    expect(shouldSaveBeforeClose(2)).toBe(false);
  });
});
