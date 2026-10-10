import { readFile } from "node:fs/promises";
import ts from "typescript";
import { expect, it } from "vitest";

// Approved first slice: App supplies one Pending domain operation, not a
// second file/history publishing implementation. Runtime protection remains
// covered by normalSavePending*, drag geometry and real Electron smoke.
it("App wires Pending through the required domain without legacy file or history ports", async () => {
  const source = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let options: ts.ObjectLiteralExpression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === "useStoryboardDragEndController") {
      options = node.arguments[0] as ts.ObjectLiteralExpression;
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  expect(options).toBeDefined();
  const properties = options!.properties.map(p => p.name!.getText(tree));
  expect(properties).toEqual(expect.arrayContaining(["pendingTransition", "capturePendingScope", "pendingVersion"]));
  for (const legacyPort of ["clearShotsDirty", "resetHistoryStacks", "moveShotFilesToPending", "restoreShotFilesFromPending"]) {
    expect(properties, `retired Pending port ${legacyPort}`).not.toContain(legacyPort);
  }
  for (const name of ["pendingTransition", "capturePendingScope", "pendingVersion"]) {
    const property = options!.properties.find(p => p.name!.getText(tree) === name)!;
    if (ts.isPropertyAssignment(property)) expect(ts.isConditionalExpression(property.initializer)).toBe(false);
  }
  expect(source).not.toContain("createPendingShotFileController");
});

it("App preserves the Pending caller's explicit scene dialogue setting across inheritance", async () => {
  const source = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === "useStoryboardDragEndController") {
      const options = node.arguments[0] as ts.ObjectLiteralExpression;
      callback = (options.properties.find(p => p.name!.getText(tree) === "inheritSceneMatte") as ts.PropertyAssignment).initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  expect(callback).toBeDefined();
  for (const enabled of [false, true]) {
    let received: { dialogueOverlayEnabled: boolean } | undefined;
    const project = {};
    const inherit = new Function("projectRef", "sceneMatteInheritanceRef", "sceneDialogueOverlayEnabledForProject", ts.transpile(`return (${callback!.getText(tree)});`))(
      { current: project },
      { current: async (_base: unknown, _mode: unknown, _ids: unknown, options: { dialogueOverlayEnabled: boolean }) => { received = options; return true; } },
      () => !enabled
    );
    expect(await inherit(project, "embedded", ["restored"], { dialogueOverlayEnabled: enabled })).toBe(true);
    expect(received!.dialogueOverlayEnabled).toBe(enabled);
  }
});
