import { readFile } from "node:fs/promises";
import ts from "typescript";
import { expect, it } from "vitest";
import { classifyPendingBake } from "../../src/shared/pendingBake";
import { manualImageImportAdmission } from "./manualImageImportRules";
import type { Project } from "../../src/shared/types";

const shared = await import("./pendingBakeRules").catch(() => undefined);
const hash = "a".repeat(64);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isHash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);

// Evaluate the actual certification conditions, not an invented stand-in.
// This is pure-policy evidence only: filesystem/path/identity checks remain in
// actual main/Create integration tests and cannot be certified by this table.
async function condition(file: string, error: string) {
  const source = await readFile(new URL(file, import.meta.url), "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isIfStatement(node) && node.thenStatement.getText(tree).includes(error)) expression = node.expression;
    ts.forEachChild(node, visit);
  };
  visit(tree);
  expect(expression).toBeDefined();
  return (raw: unknown, shots: unknown[]) => new Function("envelope", "entries", "shots", "record", "hash", "isCertifiedPendingBakeEntry", "hasCertifiedPendingBakeState",
    ts.transpile(`return !(${expression!.getText(tree)});`))(
      raw, (raw as { shots?: unknown } | null)?.shots, shots, record, isHash,
      shared?.isCertifiedPendingBakeEntry, shared?.hasCertifiedPendingBakeState
    ) as boolean;
}
const main = await condition("../main/main.ts", "Save compatibility is unknown;");
const create = await condition("../main/layerAssetService.ts", "Create ownership unknown;");
const envelope = (entry: unknown) => ({ version: 1, shots: { s: entry } });
const arrayEntry = Object.assign([], { state: "synced", acceptedOutputIdentity: hash });
const coercibleEntry = { state: "synced", acceptedOutputIdentity: { toString: () => hash } };

it.each([
  { name: "missing", raw: undefined, view: "missing", manual: true, empty: true, occupied: false, create: false },
  { name: "null", raw: null, view: "corrupt", manual: false, empty: false, occupied: false, create: false },
  { name: "future", raw: { version: 2, shots: {} }, view: "unsupported", manual: false, empty: false, occupied: false, create: false },
  { name: "string version", raw: { version: "1", shots: {} }, view: "corrupt", manual: false, empty: false, occupied: false, create: false },
  { name: "empty supported", raw: { version: 1, shots: {} }, view: "supported", manual: true, empty: true, occupied: true, create: true },
  { name: "unknown", raw: envelope({ state: "unknown" }), view: "supported", manual: false, empty: false, occupied: false, create: false },
  { name: "synced", raw: envelope({ state: "synced", acceptedOutputIdentity: hash }), view: "supported", manual: true, empty: true, occupied: true, create: true },
  { name: "pending", raw: envelope({ state: "pending", acceptedOutputIdentity: hash, editToken: "t1" }), view: "supported", manual: true, empty: true, occupied: true, create: true },
  { name: "synced token", raw: envelope({ state: "synced", acceptedOutputIdentity: hash, editToken: "t1" }), view: "corrupt", manual: false, empty: false, occupied: false, create: false },
  { name: "empty token", raw: envelope({ state: "pending", acceptedOutputIdentity: hash, editToken: "" }), view: "corrupt", manual: false, empty: false, occupied: false, create: false },
  { name: "uppercase hash", raw: envelope({ state: "synced", acceptedOutputIdentity: "A".repeat(64) }), view: "corrupt", manual: false, empty: false, occupied: false, create: false },
  // Existing Create's field predicate has historically coerced the hash and
  // did not require record-shaped entries. Preserve, don't silently change
  // its disk admission policy during a shared-rule extraction.
  { name: "array fields", raw: envelope(arrayEntry), view: "corrupt", manual: false, empty: false, occupied: false, create: true },
  { name: "coercible hash", raw: envelope(coercibleEntry), view: "corrupt", manual: false, empty: false, occupied: false, create: true }
])("preserves caller policy for $name", ({ raw, view, manual, empty, occupied, create: createExpected }) => {
  const project = { pendingBake: raw, shots: [], dialogues: [] } as unknown as Project;
  expect(classifyPendingBake(project)).toBe(view);
  let admitted = true;
  try { manualImageImportAdmission({ pendingBake: raw, shots: [] }); } catch { admitted = false; }
  expect(admitted).toBe(manual);
  expect(main(raw, [])).toBe(empty);
  expect(main(raw, [{}])).toBe(occupied);
  expect(create(raw, [])).toBe(createExpected);
});

it("provides the shared pure certification module", () => {
  expect(shared, "shared certification module absent").toBeDefined();
  expect(shared!.isCertifiedPendingBakeEntry({ state: "synced", acceptedOutputIdentity: hash })).toBe(true);
  expect(shared!.isCertifiedPendingBakeEntry({ state: "unknown" })).toBe(false);
  expect(shared!.classifyPendingBakeEnvelope(envelope({ state: "unknown", extension: true }))).toBe("supported");
});
