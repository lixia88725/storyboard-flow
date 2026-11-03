import { describe, expect, it } from "vitest";
import { IMPORT_REQUIRED_HELP } from "./importRequiredHelp";

describe("IMPORT_REQUIRED_HELP", () => {
  it("uses the edit-lock message as the help dialog title", () => {
    expect(IMPORT_REQUIRED_HELP.title).toBe("Import external changes before editing");
    expect(IMPORT_REQUIRED_HELP.heading).toBe("为什么需要 Import？");
    expect(IMPORT_REQUIRED_HELP.paragraphs.join("\n")).toContain("Storyboard Flow");
  });
});
