import { describe, expect, it } from "vitest";
import type { Project } from "../types";
import {
  aiResourceMetadataForFile,
  assembleAiImagePrompt,
  normalizeAiResourceMetadata
} from "./context";

const project = {
  id: "project-1",
  name: "Scene 12",
  ai: { projectContext: "A tense, quiet sci-fi thriller in grayscale." },
  shots: [
    {
      id: "shot-1",
      imagePath: "/scene/shot-1.tiff",
      fileName: "shot-1.tiff",
      order: 0,
      scriptText: "The pilot notices a blinking warning light.",
      swb: { version: 1, status: "owned", canvasWidth: 1920, canvasHeight: 1080 },
      layers: []
    }
  ],
  dialogues: [
    { id: "dialogue-1", shotId: "shot-1", text: "What was that?", order: 1 },
    { id: "dialogue-2", shotId: "shot-1", text: "Keep moving.", order: 0 }
  ],
  createdAt: "2026-06-12T00:00:00.000Z",
  updatedAt: "2026-06-12T00:00:00.000Z"
} satisfies Project;

describe("AI context assembly", () => {
  it("builds a prompt from project context, shot script, dialogue, shot note, and reference notes", () => {
    const prompt = assembleAiImagePrompt({
      project,
      shotId: "shot-1",
      selectedShotContext: "Make the panel feel like a low angle close-up.",
      references: [
        {
          id: "hero-front",
          fileName: "hero-front.png",
          role: "Character reference",
          note: "Use this for the pilot's face and helmet."
        },
        {
          id: "cockpit",
          fileName: "cockpit.png",
          role: "Scene reference",
          note: "Use this only for the cockpit layout."
        }
      ]
    });

    expect(prompt).toContain("A tense, quiet sci-fi thriller in grayscale.");
    expect(prompt).toContain("The pilot notices a blinking warning light.");
    expect(prompt).toContain("Keep moving.");
    expect(prompt).toContain("What was that?");
    expect(prompt).toContain("Do not render dialogue text, subtitles, captions, or speech bubbles");
    expect(prompt).toContain("Reference 1: Character reference, hero-front.png. Use this for the pilot's face and helmet.");
    expect(prompt).toContain("Reference 2: Scene reference, cockpit.png. Use this only for the cockpit layout.");
  });

  it("normalizes resource metadata and ignores unknown files", () => {
    const normalized = normalizeAiResourceMetadata(
      {
        version: 1,
        resources: [
          {
            fileName: "hero.png",
            role: "Character reference",
            note: "  Keep costume consistent.  "
          },
          {
            fileName: "../unsafe.png",
            role: "Scene reference",
            note: "ignored"
          }
        ]
      },
      ["hero.png", "room.png"]
    );

    expect(normalized.resources).toEqual([
      {
        fileName: "hero.png",
        role: "Character reference",
        note: "Keep costume consistent."
      },
      {
        fileName: "room.png",
        role: "Reference image",
        note: ""
      }
    ]);
    expect(aiResourceMetadataForFile(normalized, "missing.png")).toMatchObject({
      role: "Reference image",
      note: ""
    });
  });
});
