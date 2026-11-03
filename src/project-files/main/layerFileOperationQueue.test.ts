import { expect, it } from "vitest";
import { withLayerFileOperation } from "./layerFileOperationQueue";

it("layer operations hold source/target serialization through rejection, and nested awaited helpers do not deadlock", async () => {
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const first = withLayerFileOperation(async () => {
    events.push("source read"); started();
    await withLayerFileOperation(async () => { events.push("nested prepare"); await gate; });
    events.push("first rejected after settle"); throw new Error("synthetic commit refusal");
  });
  const caught = first.catch(error => error.message);
  await entered;
  const second = withLayerFileOperation(async () => { events.push("second source read"); });
  await Promise.resolve();
  expect(events).toEqual(["source read", "nested prepare"]);
  release();
  expect(await caught).toBe("synthetic commit refusal");
  await second;
  expect(events).toEqual(["source read", "nested prepare", "first rejected after settle", "second source read"]);
});
