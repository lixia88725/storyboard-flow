import { describe, expect, it, vi } from "vitest";
import {
  loadToolRadialMenuConfig,
  saveToolRadialMenuConfig,
  type ToolRadialSettingsApi
} from "./toolRadialSettingsController";
import { defaultToolRadialMenuConfig } from "./toolRadialMenu";

describe("toolRadialSettingsController", () => {
  it("loads and normalizes saved radial menu config", async () => {
    const api: ToolRadialSettingsApi = {
      getToolRadialMenu: vi.fn(async () => ({
        brush: {
          slots: [
            {
              id: "saved-brush",
              type: "preset",
              label: "Saved",
              tool: "brush",
              color: "#123456",
              applyColor: true
            }
          ]
        }
      })),
      setToolRadialMenu: vi.fn()
    };

    const config = await loadToolRadialMenuConfig(api);

    expect(config.brush.slots[0]).toMatchObject({
      id: "saved-brush",
      type: "preset",
      label: "Saved",
      tool: "brush",
      color: "#123456",
      applyColor: true
    });
    expect(config.brush.slots).toHaveLength(8);
    expect(config.eraser.slots).toHaveLength(8);
  });

  it("falls back to defaults when saved radial menu config cannot be loaded", async () => {
    const api: ToolRadialSettingsApi = {
      getToolRadialMenu: vi.fn(async () => {
        throw new Error("corrupt settings");
      }),
      setToolRadialMenu: vi.fn()
    };

    await expect(loadToolRadialMenuConfig(api)).resolves.toEqual(defaultToolRadialMenuConfig());
  });

  it("normalizes and persists radial menu config while reporting save failures", async () => {
    const api: ToolRadialSettingsApi = {
      getToolRadialMenu: vi.fn(),
      setToolRadialMenu: vi.fn(async () => {
        throw new Error("disk full");
      })
    };
    const setConfig = vi.fn();
    const setStatus = vi.fn();

    await saveToolRadialMenuConfig(api, { brush: { slots: [] } }, { setConfig, setStatus });

    const normalized = defaultToolRadialMenuConfig();
    expect(setConfig).toHaveBeenCalledWith(normalized);
    expect(api.setToolRadialMenu).toHaveBeenCalledWith(normalized);
    expect(setStatus).toHaveBeenCalledWith("Could not save radial shortcut settings");
  });
});
