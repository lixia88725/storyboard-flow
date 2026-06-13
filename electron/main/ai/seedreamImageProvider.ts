import path from "node:path";
import type { AiImageProvider } from "./openAiImageProvider.js";

type SeedreamImageProviderOptions = {
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

type SeedreamImageResponse = {
  data?: Array<{
    b64_json?: string;
    url?: string;
    error?: {
      code?: string;
      message?: string;
    };
  }>;
  error?: {
    code?: string;
    message?: string;
  };
};

const seedreamImageGenerationUrl = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
const defaultSeedreamModel = "doubao-seedream-5.0-lite";

const mimeTypeForImageName = (name: string): string => {
  const extension = path.extname(name).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  if (extension === ".bmp") {
    return "image/bmp";
  }
  if (extension === ".tif" || extension === ".tiff") {
    return "image/tiff";
  }
  if (extension === ".gif") {
    return "image/gif";
  }
  if (extension === ".heic") {
    return "image/heic";
  }
  if (extension === ".heif") {
    return "image/heif";
  }
  return "image/png";
};

const imageDataUrl = ({ name, buffer }: { name: string; buffer: Buffer }): string =>
  `data:${mimeTypeForImageName(name)};base64,${buffer.toString("base64")}`;

const responseErrorMessage = (body: SeedreamImageResponse, status: number): string =>
  body.error?.message ?? body.data?.find((item) => item.error)?.error?.message ?? `Seedream image generation failed with ${status}`;

export const createSeedreamImageProvider = ({
  apiKey,
  fetchImpl = fetch
}: SeedreamImageProviderOptions = {}): AiImageProvider => ({
  generate: async ({ prompt, images, model = defaultSeedreamModel }) => {
    if (!apiKey) {
      throw new Error("Set a Seedream API key in AI General Settings before generating");
    }

    const response = await fetchImpl(seedreamImageGenerationUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model.trim() || defaultSeedreamModel,
        prompt,
        image: images.map(imageDataUrl),
        response_format: "b64_json",
        sequential_image_generation: "disabled",
        stream: false,
        watermark: false
      })
    });
    const body = (await response.json()) as SeedreamImageResponse;
    if (!response.ok) {
      throw new Error(responseErrorMessage(body, response.status));
    }

    const encoded = body.data?.find((item) => item.b64_json)?.b64_json;
    if (encoded) {
      return Buffer.from(encoded, "base64");
    }

    const imageUrl = body.data?.find((item) => item.url)?.url;
    if (imageUrl) {
      const imageResponse = await fetchImpl(imageUrl);
      if (!imageResponse.ok) {
        throw new Error(`Seedream image download failed with ${imageResponse.status}`);
      }
      return Buffer.from(await imageResponse.arrayBuffer());
    }

    throw new Error(responseErrorMessage(body, response.status));
  }
});
