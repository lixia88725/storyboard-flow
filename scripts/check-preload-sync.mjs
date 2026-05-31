import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsPath = path.join(repoRoot, "electron/preload/preload.ts");
const cjsPath = path.join(repoRoot, "electron/preload/preload.cjs");

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
  const methodPattern = /^  ([A-Za-z][A-Za-z0-9_]*):\s*\(/gm;
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
        source.matchAll(/ipcRenderer\.(?:invoke|on|removeListener)\("([^"]+)"/g),
        (match) => match[1]
      )
    )
  ).sort();

export const assertSame = (label, left, right) => {
  const leftJson = JSON.stringify(left);
  const rightJson = JSON.stringify(right);
  if (leftJson !== rightJson) {
    throw new Error(
      `${label} drifted between preload.ts and preload.cjs\npreload.ts: ${leftJson}\npreload.cjs: ${rightJson}`
    );
  }
};

export const checkPreloadSync = ({ tsSource, cjsSource }) => {
  assertSame("API keys", apiKeys(tsSource), apiKeys(cjsSource));
  assertSame("API signatures", apiSignatures(tsSource), apiSignatures(cjsSource));
  assertSame("IPC channels", ipcChannels(tsSource), ipcChannels(cjsSource));
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

const parameterNames = (paramsSource) =>
  splitTopLevelParams(paramsSource)
    .map((param) => param.trim())
    .filter(Boolean)
    .map((param) => param.replace(/^\.\.\./, "").split(/[:=]/, 1)[0].trim());

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
  const [tsSource, cjsSource] = await Promise.all([
    readFile(tsPath, "utf8"),
    readFile(cjsPath, "utf8")
  ]);

  checkPreloadSync({ tsSource, cjsSource });

  console.log("preload APIs are in sync");
}
