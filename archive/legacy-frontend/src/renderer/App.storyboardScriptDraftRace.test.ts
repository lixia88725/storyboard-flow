import { expect, it } from "vitest";
import * as fs from "node:fs/promises";
import ts from "typescript";
import { withStatus } from "./statusAction";
import { markdownPathFromDroppedFiles } from "./markdownDrop";

// Execute production App declarations, not a reimplementation of the request guard.
// State/ref ports are synchronous scaffolding: this is NOT mounted React/DOM evidence.
const fixture = async () => {
  const source = await fs.readFile(new URL("./App.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ["storyboardScriptImportDraftRef", "storyboardScriptInspectRequestRef", "setStoryboardScriptImportDraft",
    "handleStoryboardScriptDrop", "handleSelectStoryboardScriptTargetFolder"];
  const declarations = new Map<string, string>();
  const visit = (node: ts.Node) => {
    if (ts.isVariableStatement(node)) {
      const name = node.declarationList.declarations[0].name.getText(tree);
      if (names.includes(name)) declarations.set(name, node.getText(tree));
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  // The request ref is optional so the same behavioral assertions can replay the
  // pre-repair App; missing public callback/state declarations remain a harness error.
  for (const name of names.filter(name => name !== "storyboardScriptInspectRequestRef")) {
    expect(declarations.has(name), `missing actual App declaration: ${name}`).toBe(true);
  }
  let state: Draft | undefined;
  const statuses: string[] = [];
  const window = { storyboard: {} as Record<string, unknown> };
  const bindings = { window, withStatus, markdownPathFromDroppedFiles,
    useRef: (value: unknown) => ({ current: value }), storyboardScriptImportDraft: undefined,
    setStoryboardScriptImportDraftState: (next: Draft | undefined) => { state = next; },
    setStatus: (message: string) => statuses.push(message) };
  const code = ts.transpile(` ${[...declarations.values()].join("\n")}
    return {ref: storyboardScriptImportDraftRef, setDraft: setStoryboardScriptImportDraft,
      drop: handleStoryboardScriptDrop, select: handleSelectStoryboardScriptTargetFolder};`, { target: ts.ScriptTarget.ES2022 });
  const controls = new Function(...Object.keys(bindings), code)(...Object.values(bindings));
  return { ...controls, window, statuses, state: () => state };
};
type Draft = { sourceMarkdownPath: string; fileName: string; entryCount: number; targetFolderPath: string };
const draft = (name: string): Draft => ({ sourceMarkdownPath: `/synthetic/${name}.md`, fileName: `${name}.md`, entryCount: 1, targetFolderPath: "" });
const gate = <T>() => {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
};
const event = (name: string) => ({ preventDefault: () => {}, dataTransfer: { files: [{ name: `${name}.md`, path: `/synthetic/${name}.md` }] } });

it("actual App select A → cancel → draft B → A folder result preserves B", async () => {
  const f = await fixture(), a = draft("A"), b = draft("B"), g = gate<string>();
  f.window.storyboard = { selectFolder: () => g.promise };
  f.setDraft(a); const pending = f.select();
  f.setDraft(undefined); expect(f.ref.current).toBeUndefined(); f.setDraft(b);
  g.resolve("/late-A"); await pending;
  expect(f.ref.current).toBe(b); expect(f.state()).toBe(b); expect(f.statuses).toEqual([]);
});

it("actual App drop A/B reverse inspect results leave B current", async () => {
  const f = await fixture(), a = gate<object>(), b = gate<object>();
  f.window.storyboard = { filePathForDroppedFile: (file: { path: string }) => file.path,
    inspectStoryboardScript: (p: string) => p.endsWith("A.md") ? a.promise : b.promise };
  const pa = f.drop(event("A")), pb = f.drop(event("B"));
  b.resolve({ entryCount: 2, fileName: "B.md" }); await pb; const current = f.ref.current;
  a.resolve({ entryCount: 1, fileName: "A.md" }); await pa;
  expect(f.ref.current).toBe(current); expect(f.state()).toBe(current);
  expect(current).toEqual({ ...draft("B"), entryCount: 2 });
});

it("actual App stale inspect/select failures cannot overwrite the new draft status", async () => {
  const f = await fixture(), a = gate<object>(), b = gate<object>();
  f.window.storyboard = { filePathForDroppedFile: (file: { path: string }) => file.path,
    inspectStoryboardScript: (p: string) => p.endsWith("A.md") ? a.promise : b.promise };
  const pa = f.drop(event("A")), pb = f.drop(event("B"));
  b.resolve({ entryCount: 2, fileName: "B.md" }); await pb;
  a.reject(new Error("late-A-inspect")); await pa; expect(f.statuses).toEqual([]);
  const g = gate<string>(); f.window.storyboard = { selectFolder: () => g.promise };
  const ps = f.select(); f.setDraft(undefined); const c = draft("C"); f.setDraft(c);
  g.reject(new Error("late-B-folder")); await ps;
  expect(f.statuses).toEqual([]); expect(f.state()).toBe(c); expect(f.ref.current).toBe(c);
});

it("actual App cancel invalidates pending inspect before its successful completion", async () => {
  const f = await fixture(), g = gate<object>();
  f.window.storyboard = { filePathForDroppedFile: (file: { path: string }) => file.path, inspectStoryboardScript: () => g.promise };
  const pending = f.drop(event("A")); f.setDraft(undefined);
  g.resolve({ entryCount: 1, fileName: "A.md" }); await pending;
  expect(f.state()).toBeUndefined(); expect(f.ref.current).toBeUndefined(); expect(f.statuses).toEqual([]);
});
