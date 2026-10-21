import { expect, it } from "vitest";
import { createProject, deleteShots } from "../shared/projectOps";
import { createNormalSaveProjectOwner } from "./normalSaveProjectOwner";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";

it("last active shot deletion still invokes the real owner Save output boundary", async () => {
  const project = createProject("last-delete");
  project.shots = [{ id: "last", imagePath: "/owned/last.tiff", fileName: "last.tiff", order: 0,
    swb: { version: 1, status: "owned", canvasWidth: 1, canvasHeight: 1 } }];
  project.pendingBake = { version: 1, shots: { last: { state: "pending", editToken: "current-unit-obligation", acceptedOutputIdentity: "a".repeat(64) } } };
  const ref = { current: project };
  let outputs = 0;
  // Pure owner scheduling regression: filesystem/main output is an explicit boundary,
  // not a claim that this synthetic input or empty ACK certifies a real deletion.
  const owner = createNormalSaveProjectOwner({ projectRef: ref, setProject: () => {},
    queue: createBitmapLayerWriteQueue(), freshToken: () => "unit-token", readIdentity: async () => "a".repeat(64),
    persist: async () => {}, outputWhenClean: true, output: async () => { outputs++; return []; } });
  expect(owner.publishEdit(deleteShots(ref.current, ["last"]), [])).toBe(true);
  expect(ref.current.shots).toHaveLength(0);
  expect(ref.current.pendingDeletedShots).toHaveLength(1);
  await owner.save();
  expect(outputs).toBe(1);
});
