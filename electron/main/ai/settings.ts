import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateComfyUiServerUrl } from "./comfyUiWorkflow.js";

export type AiSettingsStore = {
  userDataPath: string;
};

export type ComfyUiSettings = {
  serverUrl: string;
  workflowJson: string;
  timeoutMs: number;
};

export type AiAppSettings = {
  comfyUi: ComfyUiSettings;
};

type StoredAiSettings = {
  version: 1;
  comfyUi?: Partial<ComfyUiSettings>;
};

export const defaultComfyUiSettings: ComfyUiSettings = {
  serverUrl: "http://127.0.0.1:8188",
  workflowJson: "",
  timeoutMs: 120000
};

const aiSettingsPath = (userDataPath: string): string =>
  path.join(userDataPath, "ai-settings.json");

const readStoredAiSettings = async (store: AiSettingsStore): Promise<StoredAiSettings> => {
  try {
    return JSON.parse(await readFile(aiSettingsPath(store.userDataPath), "utf8")) as StoredAiSettings;
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return { version: 1 };
    }
    throw error;
  }
};

const writeStoredAiSettings = async (store: AiSettingsStore, settings: StoredAiSettings): Promise<void> => {
  await mkdir(store.userDataPath, { recursive: true });
  await writeFile(aiSettingsPath(store.userDataPath), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
};

const normalizeComfyUiSettings = (settings: Partial<ComfyUiSettings> | undefined): ComfyUiSettings => ({
  serverUrl: validateComfyUiServerUrl(settings?.serverUrl ?? defaultComfyUiSettings.serverUrl),
  workflowJson: settings?.workflowJson ?? defaultComfyUiSettings.workflowJson,
  timeoutMs: Math.max(1000, Math.round(settings?.timeoutMs ?? defaultComfyUiSettings.timeoutMs))
});

export const readAiSettings = async (store: AiSettingsStore): Promise<AiAppSettings> => {
  const settings = await readStoredAiSettings(store);
  return {
    comfyUi: normalizeComfyUiSettings(settings.comfyUi)
  };
};

export const writeComfyUiSettings = async (
  store: AiSettingsStore,
  comfyUi: ComfyUiSettings
): Promise<AiAppSettings> => {
  const current = await readStoredAiSettings(store);
  const nextComfyUi = normalizeComfyUiSettings(comfyUi);
  await writeStoredAiSettings(store, {
    ...current,
    version: 1,
    comfyUi: nextComfyUi
  });
  return readAiSettings(store);
};
