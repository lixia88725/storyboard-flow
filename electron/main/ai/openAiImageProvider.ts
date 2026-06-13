export type AiProviderImageInput = {
  name: string;
  buffer: Buffer;
};

export type AiImageProviderRequest = {
  prompt: string;
  images: AiProviderImageInput[];
  model?: string;
};

export type AiImageProvider = {
  generate: (request: AiImageProviderRequest) => Promise<Buffer>;
};

type OpenAiImageProviderOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

type OpenAiImageResponse = {
  data?: Array<{ b64_json?: string }>;
  error?: { message?: string };
};

export const createOpenAiImageProvider = ({
  apiKey,
  fetchImpl = fetch
}: OpenAiImageProviderOptions = {}): AiImageProvider => ({
  generate: async ({ prompt, images, model = "gpt-image-2" }) => {
    if (!apiKey) {
      throw new Error("Set an OpenAI API key in AI General Settings before generating");
    }

    const form = new FormData();
    form.append("model", model.trim() || "gpt-image-2");
    form.append("prompt", prompt);
    form.append("n", "1");
    images.forEach((image) => {
      form.append(
        images.length > 1 ? "image[]" : "image",
        new Blob([new Uint8Array(image.buffer)], { type: "image/png" }),
        image.name
      );
    });

    const response = await fetchImpl("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: form
    });
    const body = (await response.json()) as OpenAiImageResponse;
    if (!response.ok) {
      throw new Error(body.error?.message ?? `OpenAI image generation failed with ${response.status}`);
    }
    const encoded = body.data?.[0]?.b64_json;
    if (!encoded) {
      throw new Error("OpenAI image generation returned no image data");
    }
    return Buffer.from(encoded, "base64");
  }
});
