import { readFile } from "node:fs/promises";
import ts from "typescript";
import { expect, it } from "vitest";

// Opus-led scope: retire only renderer modes whose switch is a constant true.
// Runtime contract coverage stays in the real normalSave* chains and smoke.
it("App no longer imports or selects the retired renderer mode", async () => {
  const source = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const references: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === "normalSaveAppEnabled") references.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  expect(references).toEqual([]);
});

it.each([
  "persistWorkspace", "loadFolderScan", "handleOpenFolderByPath",
  "handleCreateProjectFromStoryboardScript", "handleSaveProject", "handleImportSwbFormat"
])("%s no longer exposes an unreachable legacy mode", async name => {
  const source = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declaration: ts.VariableDeclaration | undefined;
  const find = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) declaration = node;
    ts.forEachChild(node, find);
  };
  find(tree);
  expect(declaration).toBeDefined();
  const modeReferences: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === "normalSaveAppEnabled") modeReferences.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(declaration!);
  expect(modeReferences).toEqual([]);
});

it.each([
  { file: "bitmapLayerPaintingController.ts", ports: ["captureWorkspace", "captureEffectCompletion"] },
  { file: "workspaceCloseGuardController.ts", ports: ["bitmapQueueGuardInputRef", "normalSaveGuard", "settleNormalSave"] },
  { file: "workspaceExternalRefreshController.ts", ports: ["normalSaveRefresh"] }
])("$file requires its production lifecycle capabilities", async ({ file, ports }) => {
  const source = await readFile(new URL(`./${file}`, import.meta.url), "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  for (const name of ports) {
    const properties: ts.PropertySignature[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isPropertySignature(node) && node.name.getText(tree) === name) properties.push(node);
      ts.forEachChild(node, visit);
    };
    visit(tree);
    expect(properties, `missing capability ${name}`).toHaveLength(1);
    expect(properties[0].questionToken, `optional capability ${name}`).toBeUndefined();
  }
});

it("App supplies painting, close and refresh capabilities without retired mode selection", async () => {
  const source = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ["useBitmapLayerPaintingController", "useWorkspaceCloseGuardController", "refreshWorkspaceExternalImportState"];
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && names.includes(node.expression.getText(tree))) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  expect(calls).toHaveLength(names.length);
  for (const call of calls) expect(call.arguments[0].getText(tree)).not.toContain("normalSaveAppEnabled");
});
