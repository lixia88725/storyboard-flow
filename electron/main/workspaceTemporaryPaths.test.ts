import { describe, expect, it } from "vitest";
import {
  isWorkspaceTemporaryImagePath,
  workspaceCopyTemporaryFileName
} from "./workspaceTemporaryPaths.js";

describe("workspace temporary paths", () => {
  it("marks storyboard copy staging files as internal temporary images", () => {
    const fileName = workspaceCopyTemporaryFileName("shot-001.tif", "copy-id");

    expect(fileName).toBe(".storyboard-copy-copy-id-shot-001.tif");
    expect(isWorkspaceTemporaryImagePath(`/project/${fileName}`)).toBe(true);
  });

  it("does not hide final copied storyboard files from workspace scans", () => {
    expect(isWorkspaceTemporaryImagePath("/project/copy-shot-001.tif")).toBe(false);
  });
});
