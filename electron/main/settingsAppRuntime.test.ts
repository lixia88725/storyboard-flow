import { describe, expect, it, vi } from "vitest";
import { createSettingsAppHandlers } from "./settingsAppRuntime.js";

describe("createSettingsAppHandlers", () => {
  it("delegates tool radial menu reads and writes to the user data runtime", async () => {
    const readToolRadialMenu = vi.fn(async () => ({ brush: "B" }));
    const writeToolRadialMenu = vi.fn(async (config: unknown) => config);

    const handlers = createSettingsAppHandlers({
      readToolRadialMenu,
      writeToolRadialMenu
    });

    await expect(handlers.getToolRadialMenu()).resolves.toEqual({ brush: "B" });
    await expect(handlers.setToolRadialMenu({ eraser: "E" })).resolves.toEqual({ eraser: "E" });

    expect(readToolRadialMenu).toHaveBeenCalledOnce();
    expect(writeToolRadialMenu).toHaveBeenCalledWith({ eraser: "E" });
  });
});
