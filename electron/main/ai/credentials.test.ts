import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  clearOpenAiApiKey,
  clearSeedreamApiKey,
  readAiCredentialStatus,
  readOpenAiApiKey,
  readSeedreamApiKey,
  writeOpenAiApiKey,
  writeSeedreamApiKey,
  type AiCredentialCrypto
} from "./credentials";

const fakeCrypto = (): AiCredentialCrypto => ({
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
  decryptString: (buffer) => buffer.toString("utf8").replace(/^encrypted:/, "")
});

describe("AI credentials", () => {
  it("stores the OpenAI API key encrypted in app user data", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "swb-ai-credentials-"));
    const store = { userDataPath, crypto: fakeCrypto() };

    await writeOpenAiApiKey(store, "sk-gui");

    await expect(readAiCredentialStatus(store)).resolves.toEqual({
      hasOpenAiApiKey: true,
      hasSeedreamApiKey: false
    });
    await expect(readOpenAiApiKey(store)).resolves.toBe("sk-gui");
    const raw = await readFile(path.join(userDataPath, "ai-credentials.json"), "utf8");
    expect(raw).not.toContain("sk-gui");
  });

  it("clears the OpenAI API key when requested", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "swb-ai-credentials-"));
    const store = { userDataPath, crypto: fakeCrypto() };

    await writeOpenAiApiKey(store, "sk-gui");
    await clearOpenAiApiKey(store);

    await expect(readAiCredentialStatus(store)).resolves.toEqual({
      hasOpenAiApiKey: false,
      hasSeedreamApiKey: false
    });
    await expect(readOpenAiApiKey(store)).resolves.toBeUndefined();
  });

  it("stores and clears the Seedream API key without touching the OpenAI key", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "swb-ai-credentials-"));
    const store = { userDataPath, crypto: fakeCrypto() };

    await writeOpenAiApiKey(store, "sk-openai");
    await writeSeedreamApiKey(store, "seedream-gui");

    await expect(readAiCredentialStatus(store)).resolves.toEqual({
      hasOpenAiApiKey: true,
      hasSeedreamApiKey: true
    });
    await expect(readOpenAiApiKey(store)).resolves.toBe("sk-openai");
    await expect(readSeedreamApiKey(store)).resolves.toBe("seedream-gui");
    const raw = await readFile(path.join(userDataPath, "ai-credentials.json"), "utf8");
    expect(raw).not.toContain("seedream-gui");

    await clearSeedreamApiKey(store);

    await expect(readAiCredentialStatus(store)).resolves.toEqual({
      hasOpenAiApiKey: true,
      hasSeedreamApiKey: false
    });
    await expect(readOpenAiApiKey(store)).resolves.toBe("sk-openai");
    await expect(readSeedreamApiKey(store)).resolves.toBeUndefined();
  });

  it("requires secure credential storage before saving a key", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "swb-ai-credentials-"));
    const store = {
      userDataPath,
      crypto: {
        ...fakeCrypto(),
        isEncryptionAvailable: () => false
      }
    };

    await expect(writeOpenAiApiKey(store, "sk-gui")).rejects.toThrow(
      "Secure AI credential storage is unavailable"
    );
  });
});
