import { describe, expect, it, vi } from "vitest";
import { createUserDataRuntime } from "./userDataRuntime";

const fakeCrypto = {
  decryptString: vi.fn(() => "secret"),
  encryptString: vi.fn(() => Buffer.from("encrypted")),
  isEncryptionAvailable: vi.fn(() => true)
};

describe("userDataRuntime", () => {
  it("reads the tool radial menu from the current user data path", async () => {
    const readToolRadialMenu = vi.fn(async () => ({ menu: "radial" }));
    const runtime = createUserDataRuntime({
      crypto: fakeCrypto,
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
      crypto: fakeCrypto,
      readToolRadialMenu: vi.fn(),
      userDataPath: () => "/user-data",
      writeToolRadialMenu
    });

    await expect(runtime.writeToolRadialMenu(config)).resolves.toEqual(config);
    expect(writeToolRadialMenu).toHaveBeenCalledWith("/user-data", config);
  });

  it("creates AI stores with the current user data path", () => {
    let currentUserDataPath = "/user-data-a";
    const runtime = createUserDataRuntime({
      crypto: fakeCrypto,
      readToolRadialMenu: vi.fn(),
      userDataPath: () => currentUserDataPath,
      writeToolRadialMenu: vi.fn()
    });

    expect(runtime.aiCredentialStore()).toEqual({
      crypto: fakeCrypto,
      userDataPath: "/user-data-a"
    });

    currentUserDataPath = "/user-data-b";
    expect(runtime.aiSettingsStore()).toEqual({
      userDataPath: "/user-data-b"
    });
  });
});
