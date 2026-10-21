import { describe, expect, it } from "vitest";
import { startupResumeTarget } from "./workspaceAutoRestore";

describe("workspace auto restore", () => {
  it("resumes the most recent workspace on startup and after a reload", () => {
    expect(startupResumeTarget(["/work/a", "/work/b"])).toBe("/work/a");
  });

  it("resumes nothing when no workspace was opened before", () => {
    expect(startupResumeTarget([])).toBeUndefined();
  });
});
