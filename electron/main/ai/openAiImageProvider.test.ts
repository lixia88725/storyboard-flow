import { describe, expect, it } from "vitest";
import { createOpenAiImageProvider } from "./openAiImageProvider";

describe("OpenAI image provider", () => {
  it("requires an OpenAI API key from AI General Settings", async () => {
    const provider = createOpenAiImageProvider();

    await expect(provider.generate({ prompt: "Draw", images: [] })).rejects.toThrow(
      "Set an OpenAI API key in AI General Settings before generating"
    );
  });

  it("uses the supplied API key and model", async () => {
    const calls: Array<{ authorization?: string; model?: FormDataEntryValue | null }> = [];
    const provider = createOpenAiImageProvider({
      apiKey: "sk-session",
      fetchImpl: async (_url, init) => {
        calls.push({
          authorization: (init?.headers as { Authorization?: string } | undefined)?.Authorization,
          model: (init?.body as FormData).get("model")
        });
        return new Response(
          JSON.stringify({ data: [{ b64_json: Buffer.from("image").toString("base64") }] }),
          { status: 200 }
        );
      }
    });

    await provider.generate({ prompt: "Draw", images: [], model: "gpt-image-2" });

    expect(calls).toEqual([{ authorization: "Bearer sk-session", model: "gpt-image-2" }]);
  });
});
