export type UserDataRuntimeOptions = {
  readToolRadialMenu: (userDataPath: string) => Promise<unknown>;
  userDataPath: () => string;
  writeToolRadialMenu: (userDataPath: string, config: unknown) => Promise<unknown>;
};

export const createUserDataRuntime = (options: UserDataRuntimeOptions) => ({
  readToolRadialMenu: (): Promise<unknown> => options.readToolRadialMenu(options.userDataPath()),
  writeToolRadialMenu: (config: unknown): Promise<unknown> =>
    options.writeToolRadialMenu(options.userDataPath(), config)
});
