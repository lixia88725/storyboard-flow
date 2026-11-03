import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Project } from "../shared/types";
import {
  japaneseStoryboardRowClassName,
  japaneseStoryboardRows,
  japaneseStoryboardZoomStyle,
  sameJapaneseStoryboardRowViewProps,
  type JapaneseStoryboardRowViewProps
} from "./JapaneseStoryboardView";

vi.mock("./SketchPad", () => ({
  SketchPad: () => null
}));

const project = {
  id: "project",
  name: "Project",
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
  shots: [
    {
      id: "shot-b",
      imagePath: "/tmp/b.tif",
      fileName: "b.tif",
      order: 1
    },
    {
      id: "shot-a",
      imagePath: "/tmp/a.tif",
      fileName: "a.tif",
      order: 0,
      scriptText: "Character enters."
    }
  ],
  dialogues: [
    { id: "dialogue-b", shotId: "shot-a", text: "Second line", order: 1 },
    { id: "dialogue-a", shotId: "shot-a", text: "First line", order: 0 }
  ]
} satisfies Project;

const japaneseStoryboardCss = readFileSync(
  new URL("./styles/japanese-storyboard.css", import.meta.url),
  "utf8"
);
const japaneseStoryboardSource = readFileSync(new URL("./JapaneseStoryboardView.tsx", import.meta.url), "utf8");

describe("JapaneseStoryboardView", () => {
  it("builds rows in storyboard order with action and dialogue text", () => {
    expect(japaneseStoryboardRows(project)).toEqual([
      {
        shot: project.shots[1],
        shotNumber: "001",
        actionText: "Character enters.",
        dialogueText: "First line\nSecond line"
      },
      {
        shot: project.shots[0],
        shotNumber: "002",
        actionText: "",
        dialogueText: ""
      }
    ]);
  });

  it("marks selected and dragging rows in the class name", () => {
    expect(japaneseStoryboardRowClassName({ isSelected: false, isDragging: false })).toBe(
      "japanese-storyboard-row"
    );
    expect(japaneseStoryboardRowClassName({ isSelected: true, isDragging: true })).toBe(
      "japanese-storyboard-row is-selected is-dragging"
    );
  });

  it("builds zoom styles as stable table density instead of transform scaling", () => {
    expect(japaneseStoryboardZoomStyle(50)).toEqual({
      "--japanese-storyboard-zoom": "0.5"
    });
    expect(japaneseStoryboardZoomStyle(125)).toEqual({
      "--japanese-storyboard-zoom": "1.25"
    });
  });

  it("keeps picture previews in their own aspect ratio instead of stretching to row height", () => {
    const previewRule = japaneseStoryboardCss.match(/\.japanese-storyboard-picture-preview\s*\{[^}]+}/)?.[0];

    expect(previewRule).toContain("height: auto");
    expect(previewRule).not.toContain("height: 100%");
  });

  it("uses the editable sketch pad for picture cells instead of a read-only preview", () => {
    expect(japaneseStoryboardSource).toContain('import { SketchPad } from "./SketchPad"');
    expect(japaneseStoryboardSource).toContain("<SketchPad");
    expect(japaneseStoryboardSource).not.toContain('import { ShotPreviewComposite } from "./ShotPreviewComposite"');
  });

  it("keeps an unaffected memoized row stable when another shot selection changes", () => {
    const row = japaneseStoryboardRows(project)[0];
    const noop = vi.fn();
    const noopAsync = vi.fn(async () => undefined);
    const props = {
      activeSketchTool: "brush",
      brushColor: "#000000",
      brushOpacity: 1,
      brushSize: 8,
      brushSoftness: 0,
      eraserOpacity: 1,
      eraserSize: 24,
      eraserSoftness: 0,
      folderPath: "/scene",
      bitmapRevision: 0,
      isZoomScrubbing: false,
      isPrimarySelected: false,
      isSelected: false,
      row,
      onActionText: noop,
      onDialogueText: noop,
      onFill: noopAsync,
      onFocusShot: noop,
      onPickColor: noop,
      onSelectShot: noop,
      onSelectionTransform: noopAsync,
      onBitmapSelectionChange: noop,
      onSketchBeginInteraction: noop,
      onSketchStroke: noopAsync
    } satisfies JapaneseStoryboardRowViewProps;

    expect(
      sameJapaneseStoryboardRowViewProps(props, {
        ...props,
        row: { ...row }
      })
    ).toBe(true);
    expect(
      sameJapaneseStoryboardRowViewProps(props, {
        ...props,
        isSelected: true
      })
    ).toBe(false);
  });

  it("keeps the marquee hit area full-size while centering the sheet", () => {
    const viewRule = japaneseStoryboardCss.match(/\.japanese-storyboard-view\s*\{[^}]+}/)?.[0];
    const sheetRule = japaneseStoryboardCss.match(/\.japanese-storyboard-sheet\s*\{[^}]+}/)?.[0];

    expect(japaneseStoryboardSource).toContain('className="japanese-storyboard-sheet"');
    expect(viewRule).toContain("width: 100%");
    expect(viewRule).toContain("min-height: 100%");
    expect(sheetRule).toContain("width: min(1320px, 100%)");
    expect(sheetRule).toContain("margin: 0 auto");
  });

  it("lets the picture column grow closer to animation mode before max zoom", () => {
    const viewRule = japaneseStoryboardCss.match(/\.japanese-storyboard-view\s*\{[^}]+}/)?.[0];
    const sheetRule = japaneseStoryboardCss.match(/\.japanese-storyboard-sheet\s*\{[^}]+}/)?.[0];

    expect(viewRule).toContain("min(1040px, 64vw)");
    expect(sheetRule).toContain("width: min(1320px, 100%)");
  });
});
