import { describe, expect, it } from "vitest";
import { createSeedreamImageProvider } from "./seedreamImageProvider";

describe("Seedream image provider", () => {
  it("requires a Seedream API key from AI General Settings", async () => {
    const provider = createSeedreamImageProvider();

    await expect(provider.generate({ prompt: "Draw", images: [] })).rejects.toThrow(
      "Set a Seedream API key in AI General Settings before generating"
    );
  });

  it("uses the supplied API key, model, prompt, and reference images", async () => {
    const calls: Array<{
      url: string;
      authorization?: string;
      body: unknown;
    }> = [];
    const provider = createSeedreamImageProvider({
      apiKey: "seedream-session",
      fetchImpl: async (url, init) => {
        calls.push({
          url: String(url),
          authorization: (init?.headers as { Authorization?: string } | undefined)?.Authorization,
          body: JSON.parse(String(init?.body))
        });
        return new Response(
          JSON.stringify({ data: [{ b64_json: Buffer.from("image").toString("base64") }] }),
          { status: 200 }
        );
      }
    });

    const image = await provider.generate({
      prompt: "Draw",
      model: "doubao-seedream-5.0-lite",
      images: [{ name: "selected-storyboard.png", buffer: Buffer.from("png") }]
    });

    expect(image).toEqual(Buffer.from("image"));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://ark.cn-beijing.volces.com/api/v3/images/generations");
    expect(calls[0].authorization).toBe("Bearer seedream-session");
    expect(calls[0].body).toMatchObject({
      model: "doubao-seedream-5.0-lite",
      prompt: "Draw",
      response_format: "b64_json",
      sequential_image_generation: "disabled",
      stream: false,
      watermark: false,
      image: ["data:image/png;base64,cG5n"]
    });
  });
});
