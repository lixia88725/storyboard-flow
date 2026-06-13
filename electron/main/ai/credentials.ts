import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type AiCredentialCrypto = {
  isEncryptionAvailable: () => boolean;
  encryptString: (value: string) => Buffer;
  decryptString: (value: Buffer) => string;
};

export type AiCredentialStore = {
  userDataPath: string;
  crypto: AiCredentialCrypto;
};

export type AiCredentialStatus = {
  hasOpenAiApiKey: boolean;
  hasSeedreamApiKey: boolean;
};

type StoredSecret = {
  storage: "safeStorage";
  value: string;
};

type StoredAiCredentials = {
  version: 1;
  openAiApiKey?: StoredSecret;
  seedreamApiKey?: StoredSecret;
};

const aiCredentialsPath = (userDataPath: string): string =>
  path.join(userDataPath, "ai-credentials.json");

const readStoredAiCredentials = async (store: AiCredentialStore): Promise<StoredAiCredentials> => {
  try {
    return JSON.parse(await readFile(aiCredentialsPath(store.userDataPath), "utf8")) as StoredAiCredentials;
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return { version: 1 };
    }
    throw error;
  }
};

const writeStoredAiCredentials = async (
  store: AiCredentialStore,
  credentials: StoredAiCredentials
): Promise<void> => {
  await mkdir(store.userDataPath, { recursive: true });
  await writeFile(aiCredentialsPath(store.userDataPath), `${JSON.stringify(credentials, null, 2)}\n`, "utf8");
};

export const readAiCredentialStatus = async (store: AiCredentialStore): Promise<AiCredentialStatus> => {
  const credentials = await readStoredAiCredentials(store);
  return {
    hasOpenAiApiKey: Boolean(credentials.openAiApiKey?.value),
    hasSeedreamApiKey: Boolean(credentials.seedreamApiKey?.value)
  };
};

const readStoredSecret = async (
  store: AiCredentialStore,
  secret: StoredSecret | undefined
): Promise<string | undefined> => {
  if (!secret?.value) {
    return undefined;
  }
  return store.crypto.decryptString(Buffer.from(secret.value, "base64"));
};

const writeApiKey = async (
  store: AiCredentialStore,
  key: "openAiApiKey" | "seedreamApiKey",
  apiKey: string,
  clear: (store: AiCredentialStore) => Promise<AiCredentialStatus>
): Promise<AiCredentialStatus> => {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    return clear(store);
  }
  if (!store.crypto.isEncryptionAvailable()) {
    throw new Error("Secure AI credential storage is unavailable");
  }
  const credentials = await readStoredAiCredentials(store);
  await writeStoredAiCredentials(store, {
    ...credentials,
    version: 1,
    [key]: {
      storage: "safeStorage",
      value: store.crypto.encryptString(trimmed).toString("base64")
    }
  });
  return readAiCredentialStatus(store);
};

const clearApiKey = async (
  store: AiCredentialStore,
  key: "openAiApiKey" | "seedreamApiKey"
): Promise<AiCredentialStatus> => {
  const credentials = await readStoredAiCredentials(store);
  const { [key]: _removed, ...remaining } = credentials;
  await writeStoredAiCredentials(store, { ...remaining, version: 1 });
  return readAiCredentialStatus(store);
};

export const readOpenAiApiKey = async (store: AiCredentialStore): Promise<string | undefined> => {
  const credentials = await readStoredAiCredentials(store);
  return readStoredSecret(store, credentials.openAiApiKey);
};

export const writeOpenAiApiKey = async (
  store: AiCredentialStore,
  apiKey: string
): Promise<AiCredentialStatus> => writeApiKey(store, "openAiApiKey", apiKey, clearOpenAiApiKey);

export const clearOpenAiApiKey = async (store: AiCredentialStore): Promise<AiCredentialStatus> => {
  return clearApiKey(store, "openAiApiKey");
};

export const readSeedreamApiKey = async (store: AiCredentialStore): Promise<string | undefined> => {
  const credentials = await readStoredAiCredentials(store);
  return readStoredSecret(store, credentials.seedreamApiKey);
};

export const writeSeedreamApiKey = async (
  store: AiCredentialStore,
  apiKey: string
): Promise<AiCredentialStatus> => writeApiKey(store, "seedreamApiKey", apiKey, clearSeedreamApiKey);

export const clearSeedreamApiKey = async (store: AiCredentialStore): Promise<AiCredentialStatus> => {
  return clearApiKey(store, "seedreamApiKey");
};
