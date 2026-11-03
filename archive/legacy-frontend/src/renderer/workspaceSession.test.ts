import { expect, it } from "vitest";
import { createProject } from "../shared/projectOps";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const subject = await import("./workspaceSession").catch(() => undefined);

it("App uses the named lifecycle policies instead of repeating their rules", async () => {
  const app = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const counts = new Map<string, number>();
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAccessExpression(n) && n.expression.getText(tree) === "workspaceSession")
      counts.set(n.name.text, (counts.get(n.name.text) ?? 0) + 1);
    ts.forEachChild(n, visit);
  };
  visit(tree);
  expect(Object.fromEntries(counts)).toEqual({ captureHistory: 1, capturePainting: 1,
    captureDestination: 2, isCurrentDestination: 2, identityForRender: 1, status: 1 });
});

it("captures History admission but keeps recovery checks live", () => {
  expect(subject, "workspace session module missing").toBeDefined();
  let allowed = true;
  let recovery: string | undefined;
  const owner = { captureEffectAdmission: () => () => allowed, hasUnsavedWork: () => true, lastError: undefined };
  const session = subject!.createWorkspaceSession({
    owner: () => owner,
    readRecovery: () => recovery,
    readDestination: () => ({ folderPath: "/A", metadataPath: "/A/project.json" }),
    readIdentity: () => owner
  });
  const isCurrent = session.captureHistory();
  expect(isCurrent()).toBe(true);
  recovery = "Pixels need recovery";
  expect(isCurrent()).toBe(false);
  recovery = undefined;
  expect(isCurrent()).toBe(true);
  allowed = false;
  expect(isCurrent()).toBe(false);
});

it("binds painting to its render destination without adding that restriction to History", () => {
  let destination = { folderPath: "/A", metadataPath: "/A/project.json" };
  let recovery: string | undefined;
  let allowed = true;
  const owner = { captureEffectAdmission: () => () => allowed, hasUnsavedWork: () => true, lastError: undefined };
  const session = subject!.createWorkspaceSession({ owner: () => owner,
    readRecovery: () => recovery, readDestination: () => destination, readIdentity: () => owner });
  expect(session.capturePainting).toBeTypeOf("function");
  const paint = session.capturePainting({ ...destination });
  const history = session.captureHistory();
  expect(paint()).toBe(true);
  destination = { ...destination, metadataPath: "/A/other.json" };
  expect(paint()).toBe(false);
  expect(history()).toBe(true);
  destination = { folderPath: "/B", metadataPath: "/B/project.json" };
  expect(paint()).toBe(false);
  destination = { folderPath: "/A", metadataPath: "/A/project.json" };
  recovery = "Recovery required";
  expect(paint()).toBe(false);
  recovery = undefined;
  allowed = false;
  expect(paint()).toBe(false);
});

it("captures Add/Paste identity and paths and gives stale renders fresh rejection identities", () => {
  let identity = {};
  let destination = { folderPath: "/A", metadataPath: "/A/project.json" };
  const session = subject!.createWorkspaceSession({ owner: () => undefined,
    readRecovery: () => undefined, readDestination: () => destination, readIdentity: () => identity });
  expect(session.captureDestination).toBeTypeOf("function");
  const request = session.captureDestination();
  expect(session.isCurrentDestination(request)).toBe(true);
  expect(session.identityForRender(destination)).toBe(identity);
  identity = {}; // reload/Save/A→B→A has a new identity even when paths are equal.
  expect(session.isCurrentDestination(request)).toBe(false);
  const latest = session.captureDestination();
  destination = { ...destination, metadataPath: "/A/other.json" };
  expect(session.isCurrentDestination(latest)).toBe(false);
  expect(session.identityForRender(latest)).not.toBe(session.identityForRender(latest));
  destination = { folderPath: "/B", metadataPath: "/B/project.json" };
  expect(session.isCurrentDestination(latest)).toBe(false);
});

it("presents recovery and pending output without mistaking metadata saved for TIFF completion", () => {
  let recovery: string | undefined;
  let pending = true;
  const owner = { captureEffectAdmission: () => () => true, hasUnsavedWork: () => pending, lastError: undefined };
  const session = subject!.createWorkspaceSession({ owner: () => owner,
    readRecovery: () => recovery, readDestination: () => ({}), readIdentity: () => owner });
  expect(session.status).toBeTypeOf("function");
  const input = { metadataState: "saved" as const, message: "Saved and synced file names", project: createProject("A") };
  expect(session.status(input)).toEqual({ state: "pending", metadataState: "saved", message: "Working TIFF output pending Save" });
  recovery = "Required persistence failed";
  expect(session.status(input)).toEqual({ state: "error", metadataState: "saved", message: "Workspace incomplete; recovery required" });
  recovery = undefined;
  pending = false;
  expect(session.status(input)).toEqual({ state: "saved", metadataState: "saved", message: input.message });
});
