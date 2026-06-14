import { randomUUID } from "node:crypto";
import type { AiImageProvider, AiProviderImageInput } from "./openAiImageProvider.js";
import type { ComfyUiSettings } from "./settings.js";
import { renderComfyUiWorkflow, validateComfyUiServerUrl, validateComfyUiWorkflow } from "./comfyUiWorkflow.js";

type ComfyUiImageProviderOptions = {
  settings: ComfyUiSettings;
  fetchImpl?: typeof fetch;
  webSocketFactory?: (url: string) => ComfyUiWebSocket;
  randomId?: () => string;
};

type ComfyUiWebSocket = {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { error?: unknown }) => void) | null;
  onclose: (() => void) | null;
  send: (message: string) => void;
  close: () => void;
};

type ComfyUiUploadResponse = {
  name?: string;
  subfolder?: string;
  type?: string;
};

type ComfyUiPromptResponse = {
  prompt_id?: string;
  error?: unknown;
  node_errors?: unknown;
};

type ComfyUiHistoryImage = {
  filename?: string;
  subfolder?: string;
  type?: string;
};

type ComfyUiHistoryResponse = Record<
  string,
  {
    outputs?: Record<string, { images?: ComfyUiHistoryImage[] }>;
    status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
  }
>;

const defaultWebSocketFactory = (url: string): ComfyUiWebSocket => new WebSocket(url) as unknown as ComfyUiWebSocket;

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const assertOk = async (response: Response, fallback: string): Promise<void> => {
  if (response.ok) {
    return;
  }
  const text = await response.text().catch(() => "");
  throw new Error(text.trim() || `${fallback} failed with ${response.status}`);
};

const joinComfyUiUrl = (serverUrl: string, path: string): string =>
  `${serverUrl.replace(/\/+$/, "")}${path}`;

const websocketUrlForServer = (serverUrl: string, clientId: string): string => {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = new URLSearchParams({ clientId }).toString();
  return url.toString();
};

const uploadImage = async (
  serverUrl: string,
  fetchImpl: typeof fetch,
  image: AiProviderImageInput
): Promise<string> => {
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(image.buffer)], { type: "image/png" }), image.name);
  form.append("type", "input");
  form.append("overwrite", "true");
  const response = await fetchImpl(joinComfyUiUrl(serverUrl, "/upload/image"), {
    method: "POST",
    body: form
  });
  await assertOk(response, "ComfyUI image upload");
  const body = (await response.json()) as ComfyUiUploadResponse;
  if (!body.name) {
    throw new Error("ComfyUI image upload returned no input file name");
  }
  return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
};

const waitForWebSocketOpen = async (socket: ComfyUiWebSocket): Promise<void> =>
  new Promise((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = (event) => reject(new Error(`ComfyUI WebSocket error: ${String(event.error ?? "connection failed")}`));
  });

const createPromptCompletionWatcher = (socket: ComfyUiWebSocket): { waitFor: (promptId: string) => Promise<void> } => {
  const completedPromptIds = new Set<string>();
  const promptErrors = new Map<string, Error>();
  const waiters = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  let socketError: Error | undefined;

  const rejectAll = (error: Error) => {
    socketError = error;
    for (const waiter of waiters.values()) {
      waiter.reject(error);
    }
    waiters.clear();
  };

  socket.onmessage = (event) => {
    try {
      if (typeof event.data !== "string") {
        return;
      }
      const message = JSON.parse(event.data) as { type?: string; data?: { prompt_id?: string; node?: string | null; exception_message?: string } };
      const data = message.data;
      const promptId = data?.prompt_id;
      if (!promptId) {
        return;
      }
      const waiter = waiters.get(promptId);
      if (message.type === "execution_error") {
        const error = new Error(data.exception_message ?? "ComfyUI execution failed");
        if (waiter) {
          waiter.reject(error);
          waiters.delete(promptId);
        } else {
          promptErrors.set(promptId, error);
        }
        return;
      }
      if (message.type === "executing" && data.node === null) {
        if (waiter) {
          waiter.resolve();
          waiters.delete(promptId);
        } else {
          completedPromptIds.add(promptId);
        }
      }
    } catch {
      // Ignore non-JSON progress frames; ComfyUI may emit messages this provider does not need.
    }
  };
  socket.onerror = (event) => rejectAll(new Error(`ComfyUI WebSocket error: ${String(event.error ?? "execution failed")}`));
  socket.onclose = () => rejectAll(new Error("ComfyUI WebSocket closed before generation finished"));

  return {
    waitFor: (promptId: string) => {
      const promptError = promptErrors.get(promptId);
      if (promptError) {
        return Promise.reject(promptError);
      }
      if (completedPromptIds.has(promptId)) {
        return Promise.resolve();
      }
      if (socketError) {
        return Promise.reject(socketError);
      }
      return new Promise((resolve, reject) => {
        waiters.set(promptId, { resolve, reject });
      });
    }
  };
};

const queuePrompt = async ({
  serverUrl,
  fetchImpl,
  prompt,
  clientId
}: {
  serverUrl: string;
  fetchImpl: typeof fetch;
  prompt: unknown;
  clientId: string;
}): Promise<string> => {
  const response = await fetchImpl(joinComfyUiUrl(serverUrl, "/prompt"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      prompt,
      client_id: clientId
    })
  });
  await assertOk(response, "ComfyUI prompt queue");
  const body = (await response.json()) as ComfyUiPromptResponse;
  if (body.error || body.node_errors) {
    throw new Error(`ComfyUI workflow validation failed: ${JSON.stringify(body.error ?? body.node_errors)}`);
  }
  if (!body.prompt_id) {
    throw new Error("ComfyUI prompt queue returned no prompt id");
  }
  return body.prompt_id;
};

const firstHistoryImage = (history: ComfyUiHistoryResponse, promptId: string): ComfyUiHistoryImage => {
  const entry = history[promptId];
  if (!entry) {
    throw new Error("ComfyUI history did not include the generated prompt");
  }
  for (const output of Object.values(entry.outputs ?? {})) {
    const image = output.images?.find((item) => item.filename);
    if (image) {
      return image;
    }
  }
  throw new Error("ComfyUI history did not include an output image");
};

const downloadHistoryImage = async (
  serverUrl: string,
  fetchImpl: typeof fetch,
  image: ComfyUiHistoryImage
): Promise<Buffer> => {
  const params = new URLSearchParams({
    filename: image.filename ?? "",
    subfolder: image.subfolder ?? "",
    type: image.type ?? "output"
  });
  const response = await fetchImpl(joinComfyUiUrl(serverUrl, `/view?${params.toString()}`));
  await assertOk(response, "ComfyUI output download");
  return Buffer.from(await response.arrayBuffer());
};

export const createComfyUiImageProvider = ({
  settings,
  fetchImpl = fetch,
  webSocketFactory = defaultWebSocketFactory,
  randomId = randomUUID
}: ComfyUiImageProviderOptions): AiImageProvider => ({
  generate: async ({ prompt, images, width, height }) => {
    const serverUrl = validateComfyUiServerUrl(settings.serverUrl);
    const timeoutMs = Math.max(1000, Math.round(settings.timeoutMs));
    const validation = validateComfyUiWorkflow(settings.workflowJson, images.length);
    if (!validation.ok) {
      throw new Error(validation.errors.join("; "));
    }
    const uploadedImageNames = await Promise.all(images.map((image) => uploadImage(serverUrl, fetchImpl, image)));
    const workflow = renderComfyUiWorkflow({
      workflowJson: settings.workflowJson,
      prompt,
      uploadedImageNames,
      width,
      height,
      seed: Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
      filenamePrefix: "StoryboardFlow"
    });
    const clientId = randomId();
    const socket = webSocketFactory(websocketUrlForServer(serverUrl, clientId));
    let promptId = "";
    try {
      await withTimeout(waitForWebSocketOpen(socket), timeoutMs, "Timed out connecting to ComfyUI");
      const completionWatcher = createPromptCompletionWatcher(socket);
      promptId = await queuePrompt({ serverUrl, fetchImpl, prompt: workflow, clientId });
      const completion = completionWatcher.waitFor(promptId);
      await withTimeout(completion, timeoutMs, "Timed out waiting for ComfyUI generation");
    } finally {
      socket.close();
    }
    const historyResponse = await fetchImpl(joinComfyUiUrl(serverUrl, `/history/${promptId}`));
    await assertOk(historyResponse, "ComfyUI history lookup");
    const history = (await historyResponse.json()) as ComfyUiHistoryResponse;
    return downloadHistoryImage(serverUrl, fetchImpl, firstHistoryImage(history, promptId));
  }
});
