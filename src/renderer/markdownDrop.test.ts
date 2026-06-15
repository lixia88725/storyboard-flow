import { describe, expect, it, vi } from "vitest";
import { markdownPathFromDroppedFiles } from "./markdownDrop";

const droppedFile = (name: string, path?: string) => ({ name, path }) as File & { path?: string };

describe("markdownPathFromDroppedFiles", () => {
  it("returns undefined unless exactly one markdown file is dropped", () => {
    expect(markdownPathFromDroppedFiles([], undefined)).toBeUndefined();
    expect(
      markdownPathFromDroppedFiles([droppedFile("one.md"), droppedFile("two.md")], undefined)
    ).toBeUndefined();
    expect(markdownPathFromDroppedFiles([droppedFile("image.png", "/project/image.png")], undefined))
      .toBeUndefined();
  });

  it("uses the dropped-file resolver before falling back to file.path", () => {
    const file = droppedFile("SCRIPT.MD", "/fallback/script.md");
    const resolveDroppedFilePath = vi.fn(() => "/resolved/script.md");

    expect(markdownPathFromDroppedFiles([file], resolveDroppedFilePath)).toBe("/resolved/script.md");
    expect(resolveDroppedFilePath).toHaveBeenCalledWith(file);
  });

  it("falls back to the dropped file path when no resolver is available", () => {
    expect(markdownPathFromDroppedFiles([droppedFile("script.md", "/fallback/script.md")], undefined))
      .toBe("/fallback/script.md");
  });
});
