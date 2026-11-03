import { expect, it } from "vitest";
import { createProject } from "../shared/projectOps";
import { createNormalSaveProjectOwner } from "./normalSaveProjectOwner";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
const h0 = "0".repeat(64), h1 = "1".repeat(64);
it("clean fallback Save still invokes actual output port and merges its no-token rename effect", async () => {
  const projectRef = { current: { ...createProject("P"), shots: [{ id: "s", fileName: "a.tiff", imagePath: "/a.tiff", order: 0 }], pendingBake: { version: 1 as const, shots: { s: { state: "synced" as const, acceptedOutputIdentity: h0 } } } } };
  let outputs = 0;
  const owner = createNormalSaveProjectOwner({ projectRef, setProject: () => {}, freshToken: () => "t", queue: createBitmapLayerWriteQueue(),
    outputWhenClean: true, readIdentity: async s => s.imagePath === "/b.tiff" ? h1 : h0, persist: async () => {},
    output: async () => { outputs++; return [{ shotId: "s", sourcePath: "/a.tiff", targetPath: "/b.tiff", fileName: "b.tiff", outputHash: h1 }]; } });
  expect(await owner.save()).toBe(true);
  expect(outputs).toBe(1);
  expect(projectRef.current.shots[0].imagePath).toBe("/b.tiff");
});
