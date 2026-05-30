import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsPath = path.join(repoRoot, "electron/preload/preload.ts");
const cjsPath = path.join(repoRoot, "electron/preload/preload.cjs");

const [tsSource, cjsSource] = await Promise.all([
  readFile(tsPath, "utf8"),
  readFile(cjsPath, "utf8")
]);

const apiBlock = (source) => {
  const start = source.indexOf("const api = {");
  const end = source.indexOf("\n};", start);
  if (start === -1 || end === -1) {
    throw new Error("Could not find preload api block");
  }

  return source.slice(start, end);
};

const apiKeys = (source) =>
  Array.from(apiBlock(source).matchAll(/^  ([A-Za-z][A-Za-z0-9_]*):/gm), (match) => match[1]).sort();

const ipcChannels = (source) =>
  Array.from(
    new Set(
      Array.from(
        source.matchAll(/ipcRenderer\.(?:invoke|on|removeListener)\("([^"]+)"/g),
        (match) => match[1]
      )
    )
  ).sort();

const assertSame = (label, left, right) => {
  const leftJson = JSON.stringify(left);
  const rightJson = JSON.stringify(right);
  if (leftJson !== rightJson) {
    throw new Error(
      `${label} drifted between preload.ts and preload.cjs\npreload.ts: ${leftJson}\npreload.cjs: ${rightJson}`
    );
  }
};

assertSame("API keys", apiKeys(tsSource), apiKeys(cjsSource));
assertSame("IPC channels", ipcChannels(tsSource), ipcChannels(cjsSource));

console.log("preload APIs are in sync");
