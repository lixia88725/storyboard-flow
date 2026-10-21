import { describe, expect, it } from "vitest";
import { createProject } from "./projectOps";
import type { Project } from "./types";

// Missing module is represented as missing behavior, not a collection error.
const rules = await import("./pendingBake").catch(() => undefined);
describe("normal Save envelope", () => {
  it("initializes a real new blank output as pending, never synced", () => {
    expect(rules, "normal Save initialization rules are missing").toBeDefined();
    const p = createProject("test");
    p.shots = [{ id: "s", imagePath: "/fixture/s.tiff", fileName: "s.tiff", order: 0 }];
    const next = rules!.initializeCompletedShot(p, "s", "a".repeat(64), "t1");
    expect(next.pendingBake?.shots.s).toEqual({ state: "pending", editToken: "t1", acceptedOutputIdentity: "a".repeat(64) });
    expect(rules!.pendingBakeForProject(createProject("empty"))).toEqual({ version: 1, shots: {} });
  });
  it.each([undefined, { version: 2, shots: {} }, { version: 1, shots: { s: { state: "pending", editToken: "t" } } },
    { version: 1, shots: { s: { state: "synced", acceptedOutputIdentity: "A".repeat(64) } } },
    { version: 1, shots: { s: { state: "synced", editToken: "old", acceptedOutputIdentity: "a".repeat(64) } } }])(
    "treats malformed or unsupported input as unknown without mutating original", raw => {
      const p = createProject("test");
      p.shots = [{ id: "s", imagePath: "/fixture/s.tiff", fileName: "s.tiff", order: 0 }];
      p.pendingBake = raw as Project["pendingBake"];
      const original = JSON.stringify(p);
      expect(rules!.pendingBakeForProject(p).shots.s).toEqual({ state: "unknown" });
      expect(JSON.stringify(p)).toBe(original);
    });
  it("refuses mismatched ACK source/token/hash and missing or duplicate completions", () => {
    const p = createProject("test");
    p.shots = [{ id: "s", imagePath: "/fixture/s.tiff", fileName: "s.tiff", order: 0 }];
    const captured = rules!.initializeCompletedShot(p, "s", "a".repeat(64), "t1");
    const ack = { shotId: "s", sourcePath: "/fixture/s.tiff", targetPath: "/fixture/s.tiff", capturedToken: "t1", outputHash: "b".repeat(64) };
    expect(rules!.acknowledgeBake(captured, captured, [ack])!.pendingBake!.shots.s.state).toBe("synced");
    for (const patch of [{ sourcePath: "/other" }, { targetPath: "/rename" }, { capturedToken: "t0" }, { outputHash: "bad" }, { shotId: "other" }]) {
      expect(rules!.acknowledgeBake(captured, captured, [{ ...ack, ...patch }])).toBeUndefined();
    }
    expect(rules!.acknowledgeBake(captured, captured, [])).toBeUndefined();
    expect(rules!.acknowledgeBake(captured, captured, [ack, ack])).toBeUndefined();
  });
});
