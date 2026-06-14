export type ComfyUiWorkflow = Record<string, { class_type?: string; inputs?: Record<string, unknown>; [key: string]: unknown }>;

export type ComfyUiWorkflowValidation = {
  ok: boolean;
  errors: string[];
  imagePlaceholderCount: number;
};

export type RenderComfyUiWorkflowInput = {
  workflowJson: string;
  prompt: string;
  uploadedImageNames: string[];
  width?: number;
  height?: number;
  seed?: number;
  filenamePrefix?: string;
};

const imagePlaceholderPattern = /__SBF_IMAGE_(\d+)__/g;
const promptPlaceholder = "__SBF_PROMPT__";

const parseWorkflow = (workflowJson: string): ComfyUiWorkflow => {
  const parsed = JSON.parse(workflowJson) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Workflow JSON must be an object");
  }
  return parsed as ComfyUiWorkflow;
};

const walkValues = (value: unknown, visit: (value: string) => void): void => {
  if (typeof value === "string") {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => walkValues(item, visit));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => walkValues(item, visit));
  }
};

const imagePlaceholderIndexes = (workflow: ComfyUiWorkflow): Set<number> => {
  const indexes = new Set<number>();
  walkValues(workflow, (value) => {
    for (const match of value.matchAll(imagePlaceholderPattern)) {
      indexes.add(Number(match[1]));
    }
  });
  return indexes;
};

const hasStringValue = (workflow: ComfyUiWorkflow, needle: string): boolean => {
  let found = false;
  walkValues(workflow, (value) => {
    if (value.includes(needle)) {
      found = true;
    }
  });
  return found;
};

export const validateComfyUiServerUrl = (serverUrl: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(serverUrl.trim());
  } catch {
    throw new Error("ComfyUI server URL must be a valid local URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("ComfyUI server URL must use http or https");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname)) {
    throw new Error("ComfyUI server URL must point to local ComfyUI");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
};

export const validateComfyUiWorkflow = (
  workflowJson: string,
  imageCount = 1
): ComfyUiWorkflowValidation => {
  const errors: string[] = [];
  let workflow: ComfyUiWorkflow;
  try {
    workflow = parseWorkflow(workflowJson);
  } catch {
    return {
      ok: false,
      errors: ["Workflow JSON is invalid"],
      imagePlaceholderCount: 0
    };
  }

  if (!hasStringValue(workflow, promptPlaceholder)) {
    errors.push("Workflow must include __SBF_PROMPT__");
  }
  const imageIndexes = imagePlaceholderIndexes(workflow);
  const placeholderCount = imageIndexes.size === 0 ? 0 : Math.max(...imageIndexes);
  if (!imageIndexes.has(1)) {
    errors.push("Workflow must include __SBF_IMAGE_1__");
  }
  for (let index = 1; index <= placeholderCount; index += 1) {
    if (!imageIndexes.has(index)) {
      errors.push("Workflow image placeholders must be continuous from __SBF_IMAGE_1__");
      break;
    }
  }
  if (placeholderCount > 0 && imageCount > placeholderCount) {
    errors.push(
      `Workflow has ${placeholderCount} image placeholder${placeholderCount === 1 ? "" : "s"} but generation needs ${imageCount} images`
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    imagePlaceholderCount: placeholderCount
  };
};

const replacePlaceholderValue = (value: unknown, input: RenderComfyUiWorkflowInput): unknown => {
  if (typeof value === "string") {
    const exactReplacements: Record<string, unknown> = {
      [promptPlaceholder]: input.prompt,
      __SBF_WIDTH__: input.width,
      __SBF_HEIGHT__: input.height,
      __SBF_SEED__: input.seed,
      __SBF_FILENAME_PREFIX__: input.filenamePrefix
    };
    if (Object.prototype.hasOwnProperty.call(exactReplacements, value)) {
      return exactReplacements[value] ?? value;
    }
    return value
      .replaceAll(promptPlaceholder, input.prompt)
      .replaceAll("__SBF_WIDTH__", String(input.width ?? ""))
      .replaceAll("__SBF_HEIGHT__", String(input.height ?? ""))
      .replaceAll("__SBF_SEED__", String(input.seed ?? ""))
      .replaceAll("__SBF_FILENAME_PREFIX__", input.filenamePrefix ?? "")
      .replace(imagePlaceholderPattern, (_match, rawIndex: string) => input.uploadedImageNames[Number(rawIndex) - 1] ?? "");
  }
  if (Array.isArray(value)) {
    return value.map((item) => replacePlaceholderValue(item, input));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replacePlaceholderValue(item, input)])
    );
  }
  return value;
};

export const renderComfyUiWorkflow = (input: RenderComfyUiWorkflowInput): ComfyUiWorkflow => {
  const validation = validateComfyUiWorkflow(input.workflowJson, input.uploadedImageNames.length);
  if (!validation.ok) {
    throw new Error(validation.errors.join("; "));
  }
  return replacePlaceholderValue(parseWorkflow(input.workflowJson), input) as ComfyUiWorkflow;
};
