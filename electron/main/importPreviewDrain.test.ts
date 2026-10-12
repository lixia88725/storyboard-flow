import { it, expect } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { mapWithConcurrency } from "./mapWithConcurrency";
import { withLayerFileOperation } from "./layerFileOperationQueue";

it("the actual Import preview batch waits for every started native writer before rejecting", async () => {
  const root = await fs.mkdtemp(path.join(process.env.TMPDIR!, "import-preview-drain-"));
  let ready!: () => void, release!: () => void, writerDone!: () => void;
  const opened = new Promise<void>(resolve => { ready = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const closed = new Promise<void>(resolve => { writerDone = resolve; });
  const failure = new Error("synthetic first-preview failure");
  let finished = false, successorStarted = false;
  const preview = path.join(root, "preview.png");
  const source = await fs.readFile(new URL("./main.ts", import.meta.url), "utf8");
  const tree = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  const nodes = tree.statements.filter(node => ts.isVariableStatement(node) &&
    node.declarationList.declarations[0].name.getText(tree) === "createProjectPreviewsForShots");
  expect(nodes).toHaveLength(1);
  const bindings = { mapWithConcurrency, previewRootForFolder: () => root, isLikelyTiffPath: () => true,
    // Controlled encoding failure, real descriptor writes and close. This does
    // not claim native sharp ENOSPC or prove IPC startup by AST extraction.
    createPreview: async (image: string) => {
      if (image === "a.tiff") { await opened; throw failure; }
      const fd = await fs.open(preview, "wx");
      try { await fd.writeFile("partial"); ready(); await held; await fd.writeFile("late"); }
      finally { await fd.close(); writerDone(); }
      return preview;
    }
  };
  const compiled = ts.transpileModule(nodes[0].getText(tree) + ";return createProjectPreviewsForShots;",
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const run = new Function(...Object.keys(bindings), compiled)(...Object.values(bindings));
  const operation = withLayerFileOperation(() => run({ shots: [
    { id: "a", imagePath: "a.tiff" }, { id: "b", imagePath: "b.tiff" }
  ] }, root, new Set(["a", "b"]))).catch((error: unknown) => error).finally(() => { finished = true; });
  let successor: Promise<void> | undefined;
  try {
    await Promise.race([opened, operation.then(error => { throw new Error(`Preview ended before writer start: ${String(error)}`); })]);
    successor = withLayerFileOperation(async () => { successorStarted = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect.soft(finished).toBe(false);
    expect.soft(successorStarted).toBe(false);
    release(); expect(await operation).toBe(failure); await closed; await successor;
    expect(await fs.readFile(preview, "utf8")).toBe("partiallate");
  } finally {
    release(); await operation; await closed; await successor;
    await fs.rm(root, { recursive: true, force: true });
  }
}, 15000);
