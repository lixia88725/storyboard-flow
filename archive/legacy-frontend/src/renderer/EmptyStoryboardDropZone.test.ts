import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DndContext } from "@dnd-kit/core";
import { EmptyStoryboardDropZone } from "./EmptyStoryboardDropZone";

// Static composition protection, not a dnd-kit pointer interaction test.
describe("empty storyboard drop wiring", () => {
  it("renders a visible sized restoration target under the real DndContext", () => {
    const html = renderToStaticMarkup(createElement(DndContext, {}, createElement(EmptyStoryboardDropZone)));
    expect(html).toContain('data-empty-board-drop-zone="true"');
    expect(html).toContain('aria-label="Restore storyboard from Pending"');
    expect(html).toContain('min-height:180px');
    expect(html).toContain('Drag a storyboard from Pending here to restore it.');
  });
  it("mounts the same explicit empty target inside both board DndContexts", () => {
    const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const standard = app.slice(app.indexOf('{isStoryboardBoardMode ? ('), app.indexOf('<JapaneseStoryboardView'));
    const japanese = app.slice(app.indexOf('<JapaneseStoryboardView'), app.indexOf('<SelectionMarquee ref='));
    expect(standard).toContain('<EmptyStoryboardDropZone');
    expect(japanese).toContain('<EmptyStoryboardDropZone');
    expect(standard).toContain('orderedShots.length === 0');
    expect(japanese).toContain('orderedShots.length === 0');
  });
});
