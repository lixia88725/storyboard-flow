import { describe, expect, it } from "vitest";
import { createController, type ShortcutTool } from "./toolShortcuts";

/** Drives the controller with real key ordering and a clock the test controls, so the
 * tap/hold decision is exercised, not just a key table. */
const harness = (start: ShortcutTool = "brush") => {
  let tool: ShortcutTool = start;
  let clock = 0;
  const applied: ShortcutTool[] = [];
  const controller = createController({
    current: () => tool, holdMs: 200, now: () => clock,
    apply: next => { tool = next; applied.push(next); }
  });
  const down = (key: string, extra: Partial<{ repeat: boolean; isComposing: boolean; metaKey: boolean; target: EventTarget | null }> = {}) =>
    controller.keyDown({ key, repeat: false, ...extra });
  const up = (key: string, extra: Partial<{ isComposing: boolean; metaKey: boolean; target: EventTarget | null }> = {}) =>
    controller.keyUp({ key, repeat: false, ...extra });
  return { controller, down, up, applied, tool: () => tool, tick: (ms: number) => { clock += ms; } };
};

describe("tool keys", () => {
  it("switches brush, eraser and lasso on the first press", () => {
    const h = harness("select");
    expect(h.down("b")).toBe("handled");
    expect(h.tool()).toBe("brush");
    expect(h.down("e")).toBe("temporary");
    expect(h.tool()).toBe("eraser");
    expect(h.down("l")).toBe("handled");
    expect(h.tool()).toBe("select");
  });

  it("keeps the eraser when E is tapped", () => {
    const h = harness("brush");
    h.down("e"); h.tick(80);
    expect(h.up("e")).toBe("kept");
    expect(h.tool()).toBe("eraser");
  });

  it("returns to the previous tool when E is held past the threshold", () => {
    const h = harness("brush");
    h.down("e"); h.tick(260);
    expect(h.up("e")).toBe("restored");
    expect(h.tool()).toBe("brush");
    expect(h.applied).toEqual(["eraser", "brush"]);
  });

  it("ignores auto-repeat without applying anything twice", () => {
    const h = harness("brush");
    h.down("e");
    expect(h.down("e", { repeat: true })).toBe("held");
    expect(h.down("e", { repeat: true })).toBe("held");
    expect(h.applied).toEqual(["eraser"]);
  });

  it("does not restore on keyup after the user picks another tool during the hold", () => {
    const h = harness("brush");
    h.down("e");
    h.controller.toolChosenByUser("select");
    h.tool();
    h.tick(500);
    expect(h.up("e")).toBe("restored");
    expect(h.tool()).not.toBe("brush");
  });

  it("clears the hold on blur so no eraser is left behind", () => {
    const h = harness("brush");
    h.down("e");
    expect(h.controller.blur()).toBe(true);
    expect(h.tool()).toBe("brush");
    expect(h.controller.state().holding).toBe(false);
  });

  it("maps K to the blur tool", () => {
    const h = harness("brush");
    expect(h.down("k")).toBe("handled");
    expect(h.tool()).toBe("blur");
  });

  it("releases the borrowed eraser even when focus moved into a text field", () => {
    const h = harness("brush");
    h.down("e");
    h.tick(300);
    const field = { tagName: "TEXTAREA", isContentEditable: false } as unknown as EventTarget;
    expect(h.up("e", { target: field })).toBe("restored");
    expect(h.tool()).toBe("brush");
    expect(h.controller.state().holding).toBe(false);
  });

  it("ignores keys typed into text fields, during IME and with modifiers", () => {
    const h = harness("brush");
    const field = { tagName: "INPUT", isContentEditable: false } as unknown as EventTarget;
    expect(h.down("e", { target: field })).toBe("ignored");
    expect(h.down("b", { isComposing: true })).toBe("ignored");
    expect(h.down("l", { metaKey: true })).toBe("ignored");
    expect(h.tool()).toBe("brush");
  });

  it("lets B finish a borrowed eraser without a late restore", () => {
    const h = harness("brush");
    h.down("e");
    h.tick(40);
    expect(h.down("b")).toBe("handled");
    expect(h.tool()).toBe("brush");
    h.tick(400);
    expect(h.up("e")).toBe("ignored");
    expect(h.tool()).toBe("brush");
    expect(h.applied).toEqual(["eraser", "brush"]);
  });

  it("treats K as a real tool change during an eraser hold", () => {
    const h = harness("brush");
    h.down("e");
    h.down("k");
    expect(h.tool()).toBe("blur");
    h.tick(400);
    expect(h.up("e")).toBe("ignored");
    expect(h.tool()).toBe("blur");
  });

  it("does not undo a tapped eraser when the window blurs later", () => {
    const h = harness("brush");
    h.down("e"); h.tick(60);
    expect(h.up("e")).toBe("kept");
    expect(h.controller.blur()).toBe(false);
    expect(h.tool()).toBe("eraser");
  });
});
