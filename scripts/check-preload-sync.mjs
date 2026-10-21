import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsPath = path.join(repoRoot, "electron/preload/preload.ts");
const cjsPath = path.join(repoRoot, "electron/preload/preload.cjs");
const globalTypesPath = path.join(repoRoot, "src/renderer/global.d.ts");

export const apiBlock = (source) => {
  const start = source.indexOf("const api = {");
  const end = source.indexOf("\n};", start);
  if (start === -1 || end === -1) {
    throw new Error("Could not find preload api block");
  }

  return source.slice(start, end);
};

export const apiKeys = (source) =>
  Array.from(apiBlock(source).matchAll(/^  ([A-Za-z][A-Za-z0-9_]*):/gm), (match) => match[1]).sort();

export const apiSignatures = (source) => {
  const block = apiBlock(source);
  const signatures = [];
  const methodPattern = /^  ([A-Za-z][A-Za-z0-9_]*):\s*(?:async\s*)?\(/gm;
  let match;

  while ((match = methodPattern.exec(block))) {
    const paramsStart = methodPattern.lastIndex - 1;
    const paramsEnd = matchingParenIndex(block, paramsStart);
    signatures.push([match[1], parameterNames(block.slice(paramsStart + 1, paramsEnd))]);
  }

  return signatures.sort(([left], [right]) => left.localeCompare(right));
};

export const ipcChannels = (source) =>
  Array.from(
    new Set(
      Array.from(
        source.matchAll(/ipcRenderer\.(?:invoke|sendSync|on|removeListener)\("([^"]+)"/g),
        (match) => match[1]
      )
    )
  ).sort();

const objectBlockAfter = (source, needle) => {
  const start = source.indexOf(needle);
  if (start === -1) {
    throw new Error(`Could not find object block for ${needle}`);
  }
  const openIndex = source.indexOf("{", start);
  if (openIndex === -1) {
    throw new Error(`Could not find opening brace for ${needle}`);
  }
  const closeIndex = matchingBraceIndex(source, openIndex);
  return source.slice(openIndex + 1, closeIndex);
};

const topLevelPropertyKeys = (block) => {
  const keys = [];
  let braceDepth = 0;
  let parenDepth = 0;

  for (const line of block.split("\n")) {
    if (braceDepth === 0 && parenDepth === 0) {
      const match = /^\s*([A-Za-z][A-Za-z0-9_]*)\??:/.exec(line);
      if (match) {
        keys.push(match[1]);
      }
    }
    const delta = nestingDelta(line);
    braceDepth += delta.brace;
    parenDepth += delta.paren;
  }

  return keys.sort();
};

const topLevelFunctionTypeSignatures = (block) => {
  const signatures = [];
  let braceDepth = 0;
  let parenDepth = 0;
  let offset = 0;

  for (const line of block.split("\n")) {
    if (braceDepth === 0 && parenDepth === 0) {
      const match = /^\s*([A-Za-z][A-Za-z0-9_]*)\??:\s*\(/.exec(line);
      if (match) {
        const paramsStart = offset + line.indexOf("(");
        const paramsEnd = matchingParenIndex(block, paramsStart);
        signatures.push([match[1], parameterNames(block.slice(paramsStart + 1, paramsEnd))]);
      }
    }

    const delta = nestingDelta(line);
    braceDepth += delta.brace;
    parenDepth += delta.paren;
    offset += line.length + 1;
  }

  return signatures.sort(([left], [right]) => left.localeCompare(right));
};

const topLevelObjectFunctionSignatures = (block) => {
  const signatures = [];
  let braceDepth = 0;
  let parenDepth = 0;
  let offset = 0;

  for (const line of block.split("\n")) {
    if (braceDepth === 0 && parenDepth === 0) {
      const match = /^\s*([A-Za-z][A-Za-z0-9_]*)\??:\s*(?:async\s*)?\(/.exec(line);
      if (match) {
        const paramsStart = offset + line.indexOf("(");
        const paramsEnd = matchingParenIndex(block, paramsStart);
        signatures.push([match[1], parameterNames(block.slice(paramsStart + 1, paramsEnd))]);
      }
    }

    const delta = nestingDelta(line);
    braceDepth += delta.brace;
    parenDepth += delta.paren;
    offset += line.length + 1;
  }

  return signatures.sort(([left], [right]) => left.localeCompare(right));
};

const nestingDelta = (line) => {
  const delta = { brace: 0, paren: 0 };
  for (const char of line) {
    if (char === "{") delta.brace += 1;
    if (char === "}") delta.brace -= 1;
    if (char === "(") delta.paren += 1;
    if (char === ")") delta.paren -= 1;
  }
  return delta;
};

export const nestedApiKeys = (source, key) => topLevelPropertyKeys(objectBlockAfter(apiBlock(source), `${key}:`));

export const nestedApiSignatures = (source, key) =>
  topLevelObjectFunctionSignatures(objectBlockAfter(apiBlock(source), `${key}:`));

export const globalStoryboardApiKeys = (source) =>
  topLevelPropertyKeys(objectBlockAfter(source, "storyboard:"));

export const globalStoryboardNestedApiKeys = (source, key) =>
  topLevelPropertyKeys(objectBlockAfter(objectBlockAfter(source, "storyboard:"), `${key}:`));

export const globalStoryboardNestedApiSignatures = (source, key) =>
  topLevelFunctionTypeSignatures(objectBlockAfter(objectBlockAfter(source, "storyboard:"), `${key}:`));

export const globalStoryboardApiSignatures = (source) =>
  topLevelFunctionTypeSignatures(objectBlockAfter(source, "storyboard:"));

export const assertSame = (label, left, right, leftSource = "preload.ts", rightSource = "preload.cjs") => {
  const leftJson = JSON.stringify(left);
  const rightJson = JSON.stringify(right);
  if (leftJson !== rightJson) {
    throw new Error(
      `${label} drifted between ${leftSource} and ${rightSource}\n${leftSource}: ${leftJson}\n${rightSource}: ${rightJson}`
    );
  }
};

export const checkPreloadSync = ({ tsSource, cjsSource, globalSource }) => {
  assertSame("API keys", apiKeys(tsSource), apiKeys(cjsSource));
  assertSame("API signatures", apiSignatures(tsSource), apiSignatures(cjsSource));
  assertSame("IPC channels", ipcChannels(tsSource), ipcChannels(cjsSource));

  if (globalSource) {
    assertSame(
      "global.d.ts API keys",
      apiKeys(tsSource),
      globalStoryboardApiKeys(globalSource),
      "preload.ts",
      "global.d.ts"
    );
    assertSame(
      "global.d.ts API signatures",
      apiSignatures(tsSource),
      globalStoryboardApiSignatures(globalSource),
      "preload.ts",
      "global.d.ts"
    );
    const namespaces = Array.from(apiBlock(tsSource).matchAll(/^  ([A-Za-z][A-Za-z0-9_]*):\s*\{/gm), match => match[1]);
    for (const namespace of namespaces) {
      assertSame(
        `global.d.ts ${namespace} API keys`,
        nestedApiKeys(tsSource, namespace),
        globalStoryboardNestedApiKeys(globalSource, namespace),
        "preload.ts",
        "global.d.ts"
      );
      assertSame(
        `global.d.ts ${namespace} API signatures`,
        nestedApiSignatures(tsSource, namespace),
        globalStoryboardNestedApiSignatures(globalSource, namespace),
        "preload.ts",
        "global.d.ts"
      );
    }
  }
};

const matchingParenIndex = (source, openIndex) => {
  let depth = 0;

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  throw new Error("Could not parse preload api method parameters");
};

const matchingBraceIndex = (source, openIndex) => {
  let depth = 0;

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  throw new Error("Could not parse object block braces");
};

const parameterNames = (paramsSource) =>
  splitTopLevelParams(paramsSource)
    .map((param) => param.trim())
    .filter(Boolean)
    .map((param) => param.replace(/^\.\.\./, "").split(/[:=]/, 1)[0].trim().replace(/\?$/, ""));

const splitTopLevelParams = (paramsSource) => {
  const params = [];
  let start = 0;
  let parenDepth = 0;
  let angleDepth = 0;
  let bracketDepth = 0;

  for (let index = 0; index < paramsSource.length; index += 1) {
    const char = paramsSource[index];
    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth -= 1;
    if (char === "<") angleDepth += 1;
    if (char === ">") angleDepth -= 1;
    if (char === "[" || char === "{") bracketDepth += 1;
    if (char === "]" || char === "}") bracketDepth -= 1;

    if (char === "," && parenDepth === 0 && angleDepth === 0 && bracketDepth === 0) {
      params.push(paramsSource.slice(start, index));
      start = index + 1;
    }
  }

  params.push(paramsSource.slice(start));
  return params;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [tsSource, cjsSource, globalSource] = await Promise.all([
    readFile(tsPath, "utf8"),
    readFile(cjsPath, "utf8"),
    readFile(globalTypesPath, "utf8")
  ]);

  checkPreloadSync({ tsSource, cjsSource, globalSource });

  console.log("preload APIs are in sync");
}
