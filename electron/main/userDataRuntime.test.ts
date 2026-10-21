import { describe, expect, it, vi } from "vitest";
import { createUserDataRuntime } from "./userDataRuntime";

describe("userDataRuntime", () => {
  it("reads the tool radial menu from the current user data path", async () => {
    const readToolRadialMenu = vi.fn(async () => ({ menu: "radial" }));
    const runtime = createUserDataRuntime({
      readToolRadialMenu,
      userDataPath: () => "/user-data",
      writeToolRadialMenu: vi.fn()
    });

    await expect(runtime.readToolRadialMenu()).resolves.toEqual({ menu: "radial" });
    expect(readToolRadialMenu).toHaveBeenCalledWith("/user-data");
  });

  it("writes the tool radial menu to the current user data path", async () => {
    const config = { pinnedTools: ["brush"] };
    const writeToolRadialMenu = vi.fn(async (_userDataPath, value) => value);
    const runtime = createUserDataRuntime({
      readToolRadialMenu: vi.fn(),
      userDataPath: () => "/user-data",
      writeToolRadialMenu
    });

    await expect(runtime.writeToolRadialMenu(config)).resolves.toEqual(config);
    expect(writeToolRadialMenu).toHaveBeenCalledWith("/user-data", config);
  });

});
