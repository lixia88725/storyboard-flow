import { describe, expect, it } from "vitest";

import { getOnionSkinNeighbors } from "./onionSkin";

const shots = [{ id: "shot-1" }, { id: "shot-2" }, { id: "shot-3" }];

describe("getOnionSkinNeighbors", () => {
  it("returns previous and next neighbors for the current shot", () => {
    expect(getOnionSkinNeighbors(shots, "shot-2", true)).toEqual({
      previous: shots[0],
      next: shots[2]
    });
  });

  it("returns only next for the first shot", () => {
    expect(getOnionSkinNeighbors(shots, "shot-1", true)).toEqual({
      previous: undefined,
      next: shots[1]
    });
  });

  it("returns only previous for the last shot", () => {
    expect(getOnionSkinNeighbors(shots, "shot-3", true)).toEqual({
      previous: shots[1],
      next: undefined
    });
  });

  it("returns no neighbors when disabled", () => {
    expect(getOnionSkinNeighbors(shots, "shot-2", false)).toEqual({});
  });
});
