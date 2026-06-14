import { describe, expect, it } from "vitest";
import { createComfyUiImageProvider } from "./comfyUiImageProvider";

const workflowJson = JSON.stringify({
  "1": { class_type: "LoadImage", inputs: { image: "__SBF_IMAGE_1__" } },
  "2": { class_type: "CLIPTextEncode", inputs: { text: "__SBF_PROMPT__" } },
  "3": { class_type: "SaveImage", inputs: { filename_prefix: "__SBF_FILENAME_PREFIX__" } }
});

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | undefined;
  onmessage: ((event: { data: string }) => void) | undefined;
  onerror: ((event: { error?: unknown }) => void) | undefined;
  onclose: (() => void) | undefined;
  sent: string[] = [];
  url: string;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }

  send(message: string) {
    this.sent.push(message);
  }

  close() {
    this.onclose?.();
  }
}

describe("ComfyUI image provider", () => {
  it("uploads inputs, queues workflow, waits for completion, and downloads the first output image", async () => {
    FakeWebSocket.instances = [];
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    const output = Buffer.from("generated-image");
    const fetchImpl = async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const requestUrl = String(url);
      calls.push({ url: requestUrl, method: init?.method, body: init?.body });
      if (requestUrl.endsWith("/upload/image")) {
        return Response.json({ name: "uploaded-storyboard.png", subfolder: "", type: "input" });
      }
      if (requestUrl.endsWith("/prompt")) {
        const body = JSON.parse(String(init?.body));
        expect(body.prompt["1"].inputs.image).toBe("uploaded-storyboard.png");
        expect(body.prompt["2"].inputs.text).toBe("Storyboard prompt");
        expect(body.prompt_id).toBeUndefined();
        setTimeout(() => {
          FakeWebSocket.instances[0].onmessage?.({
            data: JSON.stringify({ type: "executing", data: { prompt_id: "prompt-1", node: null } })
          });
        }, 0);
        return Response.json({ prompt_id: "prompt-1", number: 1 });
      }
      if (requestUrl.includes("/history/")) {
        const promptId = requestUrl.split("/history/")[1];
        return Response.json({
          [promptId]: {
            outputs: {
              "3": {
                images: [{ filename: "ComfyUI_00001_.png", subfolder: "", type: "output" }]
              }
            }
          }
        });
      }
      if (requestUrl.includes("/view?")) {
        return new Response(new Uint8Array(output));
      }
      throw new Error(`Unexpected URL: ${requestUrl}`);
    };

    const provider = createComfyUiImageProvider({
      settings: {
        serverUrl: "http://127.0.0.1:8188",
        workflowJson,
        timeoutMs: 1000
      },
      fetchImpl,
      webSocketFactory: (url) => new FakeWebSocket(url) as unknown as WebSocket,
      randomId: () => "00000000-0000-4000-8000-000000000001"
    });

    await expect(
      provider.generate({
        prompt: "Storyboard prompt",
        images: [{ name: "selected-storyboard.png", buffer: Buffer.from("input") }]
      })
    ).resolves.toEqual(output);
    expect(calls.map((call) => call.url)).toEqual([
      "http://127.0.0.1:8188/upload/image",
      "http://127.0.0.1:8188/prompt",
      "http://127.0.0.1:8188/history/prompt-1",
      "http://127.0.0.1:8188/view?filename=ComfyUI_00001_.png&subfolder=&type=output"
    ]);
  });

  it("does not miss a completion message emitted before the prompt response returns", async () => {
    FakeWebSocket.instances = [];
    const output = Buffer.from("fast-generated-image");
    const fetchImpl = async (url: string | URL, init?: RequestInit): Promise<Response> => {
      const requestUrl = String(url);
      if (requestUrl.endsWith("/upload/image")) {
        return Response.json({ name: "uploaded-storyboard.png", subfolder: "", type: "input" });
      }
      if (requestUrl.endsWith("/prompt")) {
        const body = JSON.parse(String(init?.body));
        FakeWebSocket.instances[0].onmessage?.({
          data: JSON.stringify({ type: "executing", data: { prompt_id: "prompt-1", node: null } })
        });
        return Response.json({ prompt_id: body.prompt_id ?? "prompt-1", number: 1 });
      }
      if (requestUrl.includes("/history/")) {
        return Response.json({
          "prompt-1": {
            outputs: {
              "3": {
                images: [{ filename: "ComfyUI_00001_.png", subfolder: "", type: "output" }]
              }
            }
          }
        });
      }
      if (requestUrl.includes("/view?")) {
        return new Response(new Uint8Array(output));
      }
      throw new Error(`Unexpected URL: ${requestUrl}`);
    };

    const provider = createComfyUiImageProvider({
      settings: {
        serverUrl: "http://127.0.0.1:8188",
        workflowJson,
        timeoutMs: 100
      },
      fetchImpl,
      webSocketFactory: (url) => new FakeWebSocket(url) as unknown as WebSocket
    });

    await expect(
      provider.generate({
        prompt: "Storyboard prompt",
        images: [{ name: "selected-storyboard.png", buffer: Buffer.from("input") }]
      })
    ).resolves.toEqual(output);
  });
});
