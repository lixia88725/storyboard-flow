import type { AiCredentialStore } from "./ai/credentials.js";
import type { AiSettingsStore } from "./ai/settings.js";

export type UserDataRuntimeOptions = {
  crypto: AiCredentialStore["crypto"];
  readToolRadialMenu: (userDataPath: string) => Promise<unknown>;
  userDataPath: () => string;
  writeToolRadialMenu: (userDataPath: string, config: unknown) => Promise<unknown>;
};

export const createUserDataRuntime = (options: UserDataRuntimeOptions) => ({
  aiCredentialStore: (): AiCredentialStore => ({
    crypto: options.crypto,
    userDataPath: options.userDataPath()
  }),
  aiSettingsStore: (): AiSettingsStore => ({
    userDataPath: options.userDataPath()
  }),
  readToolRadialMenu: (): Promise<unknown> => options.readToolRadialMenu(options.userDataPath()),
  writeToolRadialMenu: (config: unknown): Promise<unknown> =>
    options.writeToolRadialMenu(options.userDataPath(), config)
});
