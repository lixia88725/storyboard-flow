import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Topbar } from './Topbar';
import { createProject } from '../shared/projectOps';

const topbarSource = readFileSync(new URL("./Topbar.tsx", import.meta.url), "utf8");

describe("Topbar", () => {
  it("offers the 1.85:1 blank shot preset at 1998 by 1080", () => {
    expect(topbarSource).toContain('{ id: "1.85:1", label: "1.85:1", detail: "1998 x 1080" }');
    expect(topbarSource).toContain("data-blank-shot-preset={preset.id}");
  });

  it("owns the storyboard board mode segmented control", () => {
    expect(topbarSource).toContain("board-view-toggle");
    expect(topbarSource).toContain('setBoardViewMode("storyboard")');
    expect(topbarSource).toContain('setBoardViewMode("japaneseStoryboard")');
    expect(topbarSource).toContain("StoryboardGridIcon");
    expect(topbarSource).toContain("JapaneseStoryboardIcon");
  });

  it("places matte and dialogue actions beside the board view control", () => {
    expect(topbarSource).toContain("shot-presentation-toggle");
    expect(topbarSource).toContain("MatteIcon");
    expect(topbarSource).toContain("DialogueOverlayIcon");
    expect(topbarSource).toContain('handleSetShotMatteMode("expanded")');
    expect(topbarSource).toContain('handleSetShotMatteMode("embedded")');
    expect(topbarSource).toContain("Every storyboard · +75px top / bottom");
    expect(topbarSource).toContain(
      "disabled={isFolderPreview || isDialogueOverlayDisabled || !isSceneMatteConfigured}"
    );
    expect(topbarSource).toContain(
      'className={isSceneDialogueOverlayConfigured ? "selected" : ""}'
    );
    expect(topbarSource).toContain("Turn off dialogue for every storyboard in this scene");
    expect(topbarSource).toContain("void handleDisableSceneMatte()");
    expect(topbarSource).toContain("if (sceneMatteMode)");
  });
});

it('offers one highlighted Import while disabling editing and hiding stale editing menus in preview', () => {
  const props = {
    isFolderPreview: true, needsSwbImport: true, isImportLocked: true,
    isSaveMenuOpen: true, isMatteMenuOpen: true, isAddShotMenuOpen: true,
    project: createProject('Previous editable project'), recentFolders: [],
    folderInputValue: '/old', boardViewMode: 'storyboard'
  } as unknown as Parameters<typeof Topbar>[0];
  const html = renderToStaticMarkup(createElement(Topbar, props));
  const importButton = html.match(/<button[^>]*class="import-button[^>]*>/)?.[0];
  expect(importButton).toContain('is-conversion-required');
  expect(importButton).not.toContain('disabled');
  expect(html.match(/>Import<\/button>/g)).toHaveLength(1);
  expect(html).toMatch(/class="save-main-button" disabled=""/);
  expect(html).toMatch(/class="add-shot-main-button" disabled=""/);
  expect(html).toMatch(/aria-label="Configure storyboard matte"[^>]*disabled=""/);
  expect(html).not.toContain('class="save-menu"');
  expect(html).not.toContain('class="matte-menu"');
  expect(html).not.toContain('class="add-shot-menu"');
  const busy = renderToStaticMarkup(createElement(Topbar, { ...props, isWorkspaceTaskRunning: true }));
  expect(busy.match(/<button[^>]*class="import-button[^>]*>/)?.[0]).toContain('disabled');
  expect(busy).toMatch(/aria-label="Folder path" disabled=""/);
});
