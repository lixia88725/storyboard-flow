import { expect, it } from "vitest";
import { createProject } from "./projectOps";
import { acknowledgeBake } from "./pendingBake";
import type { Project } from "./types";
const h0 = "0".repeat(64), h1 = "1".repeat(64);
function fixture(): Project {
  return { ...createProject("P1"), shots: [{ id: "s", imagePath: "/a.tiff", fileName: "a.tiff", order: 0, swb: { version: 1, status: "owned", canvasWidth: 8, canvasHeight: 6 } }], pendingBake: { version: 1, shots: { s: { state: "pending", editToken: "t1", acceptedOutputIdentity: h0 } } } };
}
it("rename effect merges into P2, advancing identity without clearing t2 or replacing metadata", () => {
  const p = fixture();
  const p2 = { ...p, name: "P2", pendingBake: { version: 1 as const, shots: { s: { state: "pending" as const, editToken: "t2", acceptedOutputIdentity: h0 } } } };
  const result = acknowledgeBake(p, p2, [{ shotId: "s", capturedToken: "t1", sourcePath: "/a.tiff", targetPath: "/b.tiff", outputHash: h1, fileName: "b.tiff", baseFingerprint: "fp" }]);
  expect(result?.name).toBe("P2");
  expect(result?.shots[0]).toMatchObject({ imagePath: "/b.tiff", fileName: "b.tiff", swb: { baseFingerprint: "fp" } });
  expect(result?.pendingBake?.shots.s).toMatchObject({ editToken: "t2", acceptedOutputIdentity: h1, state: "pending" });
});
it("actual fallback synced output has no invented captured token", () => {
  const p = fixture(); p.pendingBake!.shots.s = { state: "synced", acceptedOutputIdentity: h0 };
  expect(acknowledgeBake(p, p, [{ shotId: "s", sourcePath: "/a.tiff", targetPath: "/a.tiff", outputHash: h1 }])?.pendingBake?.shots.s).toEqual({ state: "synced", acceptedOutputIdentity: h1 });
});
it.each(["removed", "source-changed", "new-shot"])("rejects %s instead of applying old rename to new source", kind => {
  const p = fixture(); const next = { ...p, shots: kind === "removed" ? [] : [{ ...p.shots[0], imagePath: "/new.tiff" }] };
  const ack = { shotId: kind === "new-shot" ? "new" : "s", capturedToken: "t1", sourcePath: "/a.tiff", targetPath: "/b.tiff", outputHash: h1 };
  expect(acknowledgeBake(p, next, [ack])).toBeUndefined();
});
