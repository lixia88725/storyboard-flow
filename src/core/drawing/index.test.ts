import { describe, expect, it } from "vitest";
import type {
  ImageDocumentV1,
  ImageEditResultV1,
  ImageEditV1,
  LayerV1,
  ResultV1
} from "../../../electron/shared/refactorV1";
import * as drawing from "./index";
import { applyImageEdit } from "./index";

const assetA = "a".repeat(64);
const assetB = "b".repeat(64);
const assetC = "c".repeat(64);

const layer = (id: string, overrides: Partial<LayerV1> = {}): LayerV1 => ({
  id,
  name: `Layer ${id}`,
  kind: "paint",
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: "normal",
  width: 1920,
  height: 1080,
  assetId: assetA,
  ...overrides
});

const image = (
  layers: LayerV1[],
  overrides: Partial<ImageDocumentV1> = {}
): ImageDocumentV1 => ({
  id: "image-main",
  revision: 7,
  width: 1920,
  height: 1080,
  layers,
  ...overrides
});

/** Runtime-invalid values are exactly what CONTRACTS.md asks us to reject, so tests cast on purpose. */
const asEdit = (value: unknown): ImageEditV1 => value as ImageEditV1;
const asImage = (value: unknown): ImageDocumentV1 => value as ImageDocumentV1;

const expectOk = (result: ResultV1<ImageEditResultV1>): ImageEditResultV1 => {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  }
  return result.value;
};

const expectFailure = (result: ResultV1<ImageEditResultV1>, code: string) => {
  if (result.ok) {
    throw new Error(`expected failure ${code}, got ok`);
  }
  expect(result.error.code).toBe(code);
  expect(result.error.message.length).toBeGreaterThan(0);
  return result.error;
};

const ids = (document: ImageDocumentV1): string[] => document.layers.map((entry) => entry.id);
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const deepFreeze = <T,>(value: T): T => {
  if (typeof value === "object" && value !== null) {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

const threeLayers = (): ImageDocumentV1 =>
  image([
    layer("layer-bottom", { assetId: assetB }),
    layer("layer-middle", { opacity: 0.5, blendMode: "multiply" }),
    layer("layer-top", { locked: false })
  ]);

describe("applyImageEdit — public interface surface", () => {
  it("exports only applyImageEdit: no hidden undo stack or extra abstraction", () => {
    expect(Object.keys(drawing).sort()).toEqual(["applyImageEdit"]);
  });
});

describe("insertLayer", () => {
  it("inserts at the bottom, middle and top with exact final ordering", () => {
    const document = threeLayers();

    const atBottom = expectOk(
      applyImageEdit(document, { kind: "insertLayer", layer: layer("layer-new"), index: 0 })
    );
    expect(ids(atBottom.after)).toEqual(["layer-new", "layer-bottom", "layer-middle", "layer-top"]);

    const atMiddle = expectOk(
      applyImageEdit(document, { kind: "insertLayer", layer: layer("layer-new"), index: 2 })
    );
    expect(ids(atMiddle.after)).toEqual([
      "layer-bottom",
      "layer-middle",
      "layer-new",
      "layer-top"
    ]);

    const atTop = expectOk(
      applyImageEdit(document, { kind: "insertLayer", layer: layer("layer-new"), index: 3 })
    );
    expect(ids(atTop.after)).toEqual([
      "layer-bottom",
      "layer-middle",
      "layer-top",
      "layer-new"
    ]);
  });

  it("bumps the revision once, reports a visual change and keeps unrelated properties", () => {
    const document = threeLayers();
    const inserted = layer("layer-new", { name: "Scribble", opacity: 0.25, blendMode: "screen" });
    const value = expectOk(applyImageEdit(document, { kind: "insertLayer", layer: inserted, index: 1 }));

    expect(value.changed).toBe(true);
    expect(value.visualChanged).toBe(true);
    expect(value.after.revision).toBe(document.revision + 1);
    expect(value.after.layers[1]).toEqual(inserted);
    expect(value.after.layers[0]).toEqual(document.layers[0]);
    expect(value.after.layers[2]).toEqual(document.layers[1]);
    expect(value.after.layers[3]).toEqual(document.layers[2]);
  });

  it("treats a hidden insert as a visual change (stack changed) but never mutates the input", () => {
    const document = threeLayers();
    const before = clone(document);
    const value = expectOk(
      applyImageEdit(document, {
        kind: "insertLayer",
        layer: layer("layer-hidden", { visible: false }),
        index: 1
      })
    );

    expect(value.visualChanged).toBe(true);
    expect(document).toEqual(before);
  });

  it("rejects duplicate ids, out-of-range indices, wrong sizes and malformed values", () => {
    const document = threeLayers();

    expectFailure(
      applyImageEdit(document, { kind: "insertLayer", layer: layer("layer-top"), index: 0 }),
      "invalid-input"
    );
    expectFailure(
      applyImageEdit(document, { kind: "insertLayer", layer: layer("layer-new"), index: 4 }),
      "invalid-input"
    );
    expectFailure(
      applyImageEdit(document, {
        kind: "insertLayer",
        layer: layer("layer-new", { width: 1921 }),
        index: 0
      }),
      "invalid-input"
    );
    expectFailure(
      applyImageEdit(document, {
        kind: "insertLayer",
        layer: layer("layer-new", { assetId: "A".repeat(64) }),
        index: 0
      }),
      "invalid-input"
    );
    expectFailure(
      applyImageEdit(document, {
        kind: "insertLayer",
        layer: layer("layer-new", { assetId: "a".repeat(63) }),
        index: 0
      }),
      "invalid-input"
    );
    expectFailure(
      applyImageEdit(document, {
        kind: "insertLayer",
        layer: layer("layer-new", { opacity: 1.5 }),
        index: 0
      }),
      "invalid-input"
    );
    expectFailure(
      applyImageEdit(document, {
        kind: "insertLayer",
        layer: layer("layer-new", { blendMode: "overlay" as LayerV1["blendMode"] }),
        index: 0
      }),
      "invalid-input"
    );
    expectFailure(
      applyImageEdit(document, {
        kind: "insertLayer",
        layer: layer("bad id!", {}),
        index: 0
      }),
      "invalid-input"
    );
    expectFailure(
      applyImageEdit(document, asEdit({ kind: "insertLayer", layer: layer("layer-new"), index: 1.5 })),
      "invalid-input"
    );
    expectFailure(
      applyImageEdit(document, asEdit({ kind: "insertLayer", layer: layer("layer-new"), index: -1 })),
      "invalid-input"
    );
  });

  it("rejects layers carrying unsupported fields instead of silently dropping them", () => {
    const document = threeLayers();
    const withExtra = { ...layer("layer-new"), maskAssetId: assetC };

    expectFailure(
      applyImageEdit(document, { kind: "insertLayer", layer: withExtra as LayerV1, index: 0 }),
      "invalid-input"
    );
  });

  it("keeps unicode names byte-for-byte", () => {
    const document = threeLayers();
    const name = "立ち絵　レイヤー🎬";
    const value = expectOk(
      applyImageEdit(document, {
        kind: "insertLayer",
        layer: layer("layer-new", { name }),
        index: 0
      })
    );
    expect(value.after.layers[0]!.name).toBe(name);
  });
});

describe("removeLayer", () => {
  it("removes a layer from any position, preserving exact order and metadata", () => {
    const document = threeLayers();
    const value = expectOk(applyImageEdit(document, { kind: "removeLayer", layerId: "layer-middle" }));

    expect(ids(value.after)).toEqual(["layer-bottom", "layer-top"]);
    expect(value.after.layers[0]).toEqual(document.layers[0]);
    expect(value.after.layers[1]).toEqual(document.layers[2]);
    expect(value.changed).toBe(true);
    expect(value.visualChanged).toBe(true);
    expect(value.after.revision).toBe(document.revision + 1);
  });

  it("fails removing the final layer with invalid-input, not not-found", () => {
    const document = image([layer("only")]);
    expectFailure(applyImageEdit(document, { kind: "removeLayer", layerId: "only" }), "invalid-input");
  });

  it("reports an unknown layer as not-found and a locked layer as locked", () => {
    const document = image([layer("bottom"), layer("locked-one", { locked: true })]);

    expectFailure(applyImageEdit(document, { kind: "removeLayer", layerId: "missing" }), "not-found");
    expectFailure(applyImageEdit(document, { kind: "removeLayer", layerId: "locked-one" }), "locked");
    expectFailure(applyImageEdit(document, { kind: "removeLayer", layerId: "" }), "invalid-input");
  });

  it("prefers the structural refusal over the lock refusal for a single locked layer", () => {
    const document = image([layer("only-locked", { locked: true })]);
    expectFailure(applyImageEdit(document, { kind: "removeLayer", layerId: "only-locked" }), "invalid-input");
  });
});

describe("moveLayer", () => {
  it("moves a layer to the bottom, top and middle using the post-removal index", () => {
    const document = threeLayers();

    const toBottom = expectOk(
      applyImageEdit(document, { kind: "moveLayer", layerId: "layer-top", index: 0 })
    );
    expect(ids(toBottom.after)).toEqual(["layer-top", "layer-bottom", "layer-middle"]);

    const toTop = expectOk(
      applyImageEdit(document, { kind: "moveLayer", layerId: "layer-bottom", index: 2 })
    );
    expect(ids(toTop.after)).toEqual(["layer-middle", "layer-top", "layer-bottom"]);

    const toMiddle = expectOk(
      applyImageEdit(document, { kind: "moveLayer", layerId: "layer-top", index: 1 })
    );
    expect(ids(toMiddle.after)).toEqual(["layer-bottom", "layer-top", "layer-middle"]);

    expect(toTop.after.revision).toBe(document.revision + 1);
    expect(toTop.visualChanged).toBe(true);
  });

  it("is a no-op when the layer already sits at the requested index", () => {
    const document = threeLayers();

    // "layer-middle" is at index 1 and stays at index 1 after removal + insert.
    const value = expectOk(
      applyImageEdit(document, { kind: "moveLayer", layerId: "layer-middle", index: 1 })
    );

    expect(value.changed).toBe(false);
    expect(value.visualChanged).toBe(false);
    expect(value.after).toBe(document);
    expect(value.after.revision).toBe(document.revision);
  });

  it("rejects out-of-range indices and unknown layers", () => {
    const document = threeLayers();

    expectFailure(
      applyImageEdit(document, { kind: "moveLayer", layerId: "layer-top", index: 3 }),
      "invalid-input"
    );
    expectFailure(
      applyImageEdit(document, { kind: "moveLayer", layerId: "missing", index: 0 }),
      "not-found"
    );
  });

  it("refuses to reorder a locked layer but still allows a locked no-op", () => {
    const document = image([layer("bottom"), layer("locked-top", { locked: true })]);

    expectFailure(
      applyImageEdit(document, { kind: "moveLayer", layerId: "locked-top", index: 0 }),
      "locked"
    );

    const noOp = expectOk(
      applyImageEdit(document, { kind: "moveLayer", layerId: "locked-top", index: 1 })
    );
    expect(noOp.changed).toBe(false);
  });
});

describe("setLayer", () => {
  it("renames without claiming a visual change and bumps the revision once", () => {
    const document = threeLayers();
    const value = expectOk(
      applyImageEdit(document, { kind: "setLayer", layerId: "layer-middle", patch: { name: "Line art" } })
    );

    expect(value.after.layers[1]!.name).toBe("Line art");
    expect(value.changed).toBe(true);
    expect(value.visualChanged).toBe(false);
    expect(value.after.revision).toBe(document.revision + 1);
    // Unrelated layers and properties survive untouched.
    expect(value.after.layers[1]!.opacity).toBe(0.5);
    expect(value.after.layers[1]!.blendMode).toBe("multiply");
    expect(value.after.layers[0]).toEqual(document.layers[0]);
  });

  it("toggles the lock without claiming a visual change", () => {
    const document = threeLayers();
    const value = expectOk(
      applyImageEdit(document, { kind: "setLayer", layerId: "layer-middle", patch: { locked: true } })
    );

    expect(value.after.layers[1]!.locked).toBe(true);
    expect(value.changed).toBe(true);
    expect(value.visualChanged).toBe(false);
  });

  it("marks visibility, opacity and blend-mode changes as visual", () => {
    const document = threeLayers();

    for (const patch of [{ visible: false }, { opacity: 0.25 }, { blendMode: "screen" as const }]) {
      const value = expectOk(
        applyImageEdit(document, { kind: "setLayer", layerId: "layer-middle", patch })
      );
      expect(value.changed).toBe(true);
      expect(value.visualChanged).toBe(true);
    }

    const mixed = expectOk(
      applyImageEdit(document, {
        kind: "setLayer",
        layerId: "layer-middle",
        patch: { name: "Renamed", visible: false }
      })
    );
    expect(mixed.visualChanged).toBe(true);
    expect(mixed.after.layers[1]!.name).toBe("Renamed");
    expect(mixed.after.layers[1]!.visible).toBe(false);
  });

  it("treats identical values and empty patches as no-ops without a revision bump", () => {
    const document = threeLayers();

    // layer-top carries the defaults: visible, unlocked, opacity 1, normal, name "Layer layer-top".
    for (const patch of [
      { name: "Layer layer-top" },
      { opacity: 1 },
      { visible: true },
      { locked: false },
      { blendMode: "normal" as const },
      { name: "Layer layer-top", opacity: 1, blendMode: "normal" as const },
      {}
    ]) {
      const value = expectOk(
        applyImageEdit(document, { kind: "setLayer", layerId: "layer-top", patch })
      );
      expect(value.changed).toBe(false);
      expect(value.visualChanged).toBe(false);
      expect(value.after).toBe(document);
    }

    // Same check against a non-default layer, using its actual current values.
    const middle = expectOk(
      applyImageEdit(document, {
        kind: "setLayer",
        layerId: "layer-middle",
        patch: { opacity: 0.5, blendMode: "multiply" }
      })
    );
    expect(middle.changed).toBe(false);
  });

  it("keeps a locked layer's name/opacity/blend mode while allowing visibility and unlock", () => {
    const document = image([layer("bottom"), layer("locked", { locked: true, opacity: 0.4 })]);

    expectFailure(
      applyImageEdit(document, { kind: "setLayer", layerId: "locked", patch: { name: "Nope" } }),
      "locked"
    );
    expectFailure(
      applyImageEdit(document, { kind: "setLayer", layerId: "locked", patch: { opacity: 0.9 } }),
      "locked"
    );
    expectFailure(
      applyImageEdit(document, { kind: "setLayer", layerId: "locked", patch: { blendMode: "screen" } }),
      "locked"
    );
    // A refused edit applies nothing, including the parts that were allowed: it is atomic.
    expectFailure(
      applyImageEdit(document, {
        kind: "setLayer",
        layerId: "locked",
        patch: { visible: false, opacity: 0.9 }
      }),
      "locked"
    );

    const hidden = expectOk(
      applyImageEdit(document, { kind: "setLayer", layerId: "locked", patch: { visible: false } })
    );
    expect(hidden.after.layers[1]!.visible).toBe(false);
    expect(hidden.visualChanged).toBe(true);

    const unlocked = expectOk(
      applyImageEdit(document, { kind: "setLayer", layerId: "locked", patch: { locked: false } })
    );
    expect(unlocked.after.layers[1]!.locked).toBe(false);
    expect(unlocked.visualChanged).toBe(false);

    // After unlocking, the same metadata edit is accepted.
    const renamed = expectOk(
      applyImageEdit(unlocked.after, { kind: "setLayer", layerId: "locked", patch: { name: "Nope" } })
    );
    expect(renamed.after.layers[1]!.name).toBe("Nope");
  });

  it("rejects invalid opacity, modes, field names and unknown layers", () => {
    const document = threeLayers();

    for (const opacity of [1.0001, -0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectFailure(
        applyImageEdit(asImage(document), asEdit({ kind: "setLayer", layerId: "layer-top", patch: { opacity } })),
        "invalid-input"
      );
    }
    expectFailure(
      applyImageEdit(document, asEdit({ kind: "setLayer", layerId: "layer-top", patch: { blendMode: "overlay" } })),
      "invalid-input"
    );
    expectFailure(
      applyImageEdit(document, asEdit({ kind: "setLayer", layerId: "layer-top", patch: { id: "hijack" } })),
      "invalid-input"
    );
    expectFailure(
      applyImageEdit(document, asEdit({ kind: "setLayer", layerId: "layer-top", patch: { name: undefined } })),
      "invalid-input"
    );
    expectFailure(
      applyImageEdit(document, { kind: "setLayer", layerId: "missing", patch: { name: "x" } }),
      "not-found"
    );
    expectFailure(
      applyImageEdit(asImage(document), asEdit({ kind: "setLayer", layerId: "layer-top", patch: null })),
      "invalid-input"
    );
  });
});

describe("replacePixels", () => {
  it("adopts a new asset reference and marks the image visual", () => {
    const document = threeLayers();
    const value = expectOk(
      applyImageEdit(document, {
        kind: "replacePixels",
        layerId: "layer-middle",
        assetId: assetC
      })
    );

    expect(value.after.layers[1]!.assetId).toBe(assetC);
    expect(value.after.layers[1]!.name).toBe("Layer layer-middle");
    expect(value.after.layers[0]).toEqual(document.layers[0]);
    expect(value.after.layers[2]).toEqual(document.layers[2]);
    expect(value.changed).toBe(true);
    expect(value.visualChanged).toBe(true);
    expect(value.after.revision).toBe(document.revision + 1);
  });

  it("is a no-op for the current asset and a locked failure for a different one", () => {
    const document = image([layer("bottom"), layer("locked", { locked: true, assetId: assetB })]);

    const noOp = expectOk(
      applyImageEdit(document, { kind: "replacePixels", layerId: "locked", assetId: assetB })
    );
    expect(noOp.changed).toBe(false);
    expect(noOp.after).toBe(document);

    expectFailure(
      applyImageEdit(document, { kind: "replacePixels", layerId: "locked", assetId: assetC }),
      "locked"
    );
    expectFailure(
      applyImageEdit(document, { kind: "replacePixels", layerId: "missing", assetId: assetC }),
      "not-found"
    );
  });

  it("rejects malformed asset references", () => {
    const document = threeLayers();

    for (const assetId of ["A".repeat(64), "a".repeat(63), "a".repeat(65), "data:image/png;base64,AAAA", ""]) {
      expectFailure(
        applyImageEdit(document, { kind: "replacePixels", layerId: "layer-top", assetId }),
        "invalid-input"
      );
    }
  });
});

describe("invalid documents and unknown edits", () => {
  it("rejects malformed documents with invalid-input", () => {
    const good = threeLayers();
    const edit: ImageEditV1 = { kind: "setLayer", layerId: "layer-top", patch: { name: "x" } };

    const brokenDocuments: unknown[] = [
      null,
      [],
      { ...good, id: "bad id" },
      { ...good, revision: -1 },
      { ...good, revision: 1.5 },
      { ...good, width: 0 },
      { ...good, height: -1080 },
      { ...good, layers: [] },
      { ...good, layers: [layer("dup"), layer("dup")] },
      { ...good, layers: [layer("sized", { height: 720 })] },
      { ...good, layers: [{ ...layer("no-asset"), assetId: undefined }] },
      { ...good, layers: [{ ...layer("extra"), maskAssetId: assetC }] },
      { ...good, layers: "not-an-array" },
      { ...good, unsupported: true },
      { ...good, revision: Number.MAX_SAFE_INTEGER }
    ];

    for (const document of brokenDocuments) {
      expectFailure(applyImageEdit(asImage(document), edit), "invalid-input");
    }
  });

  it("rejects unknown edit kinds and extra edit fields", () => {
    const document = threeLayers();

    expectFailure(applyImageEdit(document, asEdit({ kind: "deleteImage" })), "invalid-input");
    expectFailure(applyImageEdit(document, asEdit({ kind: "removeLayer", layerId: "layer-top", force: true })), "invalid-input");
    expectFailure(applyImageEdit(document, asEdit(null)), "invalid-input");
    expectFailure(applyImageEdit(document, asEdit({ kind: "removeLayer" })), "invalid-input");
  });

  it("is deterministic: identical input produces identical results", () => {
    const document = threeLayers();
    const edit: ImageEditV1 = { kind: "setLayer", layerId: "layer-top", patch: { opacity: 0.3 } };

    expect(applyImageEdit(document, edit)).toEqual(applyImageEdit(document, edit));
    expect(applyImageEdit(document, asEdit({ kind: "bogus" }))).toEqual(
      applyImageEdit(document, asEdit({ kind: "bogus" }))
    );
  });
});

describe("D1 — unsupported command kinds are rejected, never thrown", () => {
  it("returns invalid-input for inherited Object property names", () => {
    const document = threeLayers();
    const snapshot = clone(document);

    for (const kind of [
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
      "valueOf",
      "deleteImage"
    ]) {
      const result = applyImageEdit(document, asEdit({ kind }));
      expectFailure(result, "invalid-input");
      expect(document).toEqual(snapshot);
    }
  });

  it("does not throw when the inherited value is not a key list", () => {
    const document = threeLayers();

    expect(() => applyImageEdit(document, asEdit({ kind: "constructor" }))).not.toThrow();
    expect(() => applyImageEdit(document, asEdit({ kind: "__proto__" }))).not.toThrow();
    expect(applyImageEdit(document, asEdit({ kind: "constructor" })).ok).toBe(false);
  });
});

describe("D2 — maximum revision keeps no-op semantics", () => {
  const maxedImage = (): ImageDocumentV1 =>
    image([layer("bottom"), layer("top")], { revision: Number.MAX_SAFE_INTEGER });

  it("accepts every no-op at the maximum revision and returns the same before/after", () => {
    const document = maxedImage();
    const edits: ImageEditV1[] = [
      // name equal to the current one
      { kind: "setLayer", layerId: "top", patch: { name: "Layer top" } },
      // empty patch
      { kind: "setLayer", layerId: "top", patch: {} },
      // move onto the current index
      { kind: "moveLayer", layerId: "top", index: 1 },
      // same asset reference
      { kind: "replacePixels", layerId: "top", assetId: assetA }
    ];

    for (const edit of edits) {
      const value = expectOk(applyImageEdit(document, edit));
      expect(value.changed).toBe(false);
      expect(value.visualChanged).toBe(false);
      expect(value.before).toBe(document);
      expect(value.after).toBe(document);
      expect(value.after.revision).toBe(Number.MAX_SAFE_INTEGER);
    }
  });

  it("still refuses a genuine change that would overflow, leaving the input unchanged", () => {
    const document = maxedImage();
    const snapshot = clone(document);
    const edits: ImageEditV1[] = [
      { kind: "setLayer", layerId: "top", patch: { name: "Renamed" } },
      { kind: "setLayer", layerId: "top", patch: { visible: false } },
      { kind: "setLayer", layerId: "top", patch: { opacity: 0.5 } },
      { kind: "moveLayer", layerId: "top", index: 0 },
      { kind: "replacePixels", layerId: "top", assetId: assetB },
      { kind: "insertLayer", layer: layer("inserted"), index: 0 },
      { kind: "removeLayer", layerId: "top" }
    ];

    for (const edit of edits) {
      expectFailure(applyImageEdit(document, edit), "invalid-input");
      expect(document).toEqual(snapshot);
    }
  });
});

describe("ownership, immutability and undo from before", () => {
  it("returns the supplied document as before and leaves the input deeply unchanged", () => {
    const document = threeLayers();
    const snapshot = clone(document);

    const edits: ImageEditV1[] = [
      { kind: "insertLayer", layer: layer("layer-new"), index: 1 },
      { kind: "removeLayer", layerId: "layer-middle" },
      { kind: "moveLayer", layerId: "layer-top", index: 0 },
      { kind: "setLayer", layerId: "layer-middle", patch: { opacity: 0.1, name: "Renamed" } },
      { kind: "replacePixels", layerId: "layer-middle", assetId: assetC }
    ];

    for (const edit of edits) {
      const value = expectOk(applyImageEdit(document, edit));
      expect(value.before).toBe(document);
      expect(document).toEqual(snapshot);
    }
  });

  it("isolates the result from the input: mutating the returned document cannot corrupt it", () => {
    const document = threeLayers();
    const snapshot = clone(document);
    const value = expectOk(
      applyImageEdit(document, { kind: "setLayer", layerId: "layer-middle", patch: { name: "Moved" } })
    );

    // No layer object is shared with the input, even for untouched layers.
    for (const [index, returnedLayer] of value.after.layers.entries()) {
      expect(returnedLayer).not.toBe(document.layers[index]);
    }
    expect(value.after.layers).not.toBe(document.layers);

    value.after.layers[0]!.name = "corrupted";
    value.after.layers[1]!.assetId = assetC;
    value.after.layers.push(layer("extra"));
    value.after.revision = 999;
    value.after.width = 1;

    expect(document).toEqual(snapshot);
  });

  it("works on a deep-frozen document, proving no write happens anywhere", () => {
    const frozen = deepFreeze(threeLayers());

    const value = expectOk(
      applyImageEdit(frozen, { kind: "setLayer", layerId: "layer-middle", patch: { visible: false } })
    );
    expect(value.after.layers[1]!.visible).toBe(false);
    expect(expectOk(applyImageEdit(frozen, { kind: "insertLayer", layer: layer("n"), index: 0 })).changed).toBe(true);
    expect(expectOk(applyImageEdit(frozen, { kind: "moveLayer", layerId: "layer-top", index: 0 })).changed).toBe(true);
    expect(expectOk(applyImageEdit(frozen, { kind: "removeLayer", layerId: "layer-top" })).changed).toBe(true);
    expect(expectOk(applyImageEdit(frozen, { kind: "replacePixels", layerId: "layer-top", assetId: assetC })).changed).toBe(true);
  });

  it("offers no hidden undo stack: the caller restores by reinstalling result.before", () => {
    const document = threeLayers();
    const original = clone(document);

    const edited = expectOk(
      applyImageEdit(document, { kind: "setLayer", layerId: "layer-middle", patch: { name: "Pencils" } })
    );
    const pixels = expectOk(
      applyImageEdit(edited.after, { kind: "replacePixels", layerId: "layer-middle", assetId: assetB })
    );
    const reordered = expectOk(
      applyImageEdit(pixels.after, { kind: "moveLayer", layerId: "layer-middle", index: 0 })
    );

    // Walking back through the returned `before` values restores exact metadata and asset refs.
    expect(reordered.before).toBe(pixels.after);
    expect(pixels.before).toBe(edited.after);
    expect(edited.before).toBe(document);
    expect(edited.before).toEqual(original);
    expect(edited.after.layers[1]!.assetId).toBe(assetA);
    expect(pixels.after.layers[1]!.assetId).toBe(assetB);
  });

  it("counts revisions exactly once per successful edit across a mixed sequence", () => {
    let document = threeLayers();
    const start = document.revision;
    let changes = 0;

    const sequence: ImageEditV1[] = [
      { kind: "insertLayer", layer: layer("layer-a"), index: 1 },
      { kind: "setLayer", layerId: "layer-a", patch: { name: "A" } },
      { kind: "setLayer", layerId: "layer-a", patch: { name: "A" } }, // no-op
      { kind: "moveLayer", layerId: "layer-a", index: 1 }, // no-op
      { kind: "replacePixels", layerId: "layer-a", assetId: assetB },
      { kind: "replacePixels", layerId: "layer-a", assetId: assetB }, // no-op
      { kind: "removeLayer", layerId: "layer-a" },
      { kind: "removeLayer", layerId: "layer-a" }, // failure
      { kind: "setLayer", layerId: "layer-top", patch: { locked: true } },
      { kind: "removeLayer", layerId: "layer-top" } // locked failure
    ];

    for (const edit of sequence) {
      const result = applyImageEdit(document, edit);
      if (!result.ok) {
        // Expected failures in this sequence: the second remove of a gone layer (not-found) and
        // removing the just-locked top layer (locked).
        expect(["not-found", "locked"]).toContain(result.error.code);
        continue;
      }

      if (result.value.changed) {
        changes += 1;
        expect(result.value.after.revision).toBe(document.revision + 1);
      } else {
        expect(result.value.after.revision).toBe(document.revision);
      }
      document = result.value.after;
    }

    expect(changes).toBe(5);
    expect(document.revision).toBe(start + changes);
    expect(ids(document)).toEqual(["layer-bottom", "layer-middle", "layer-top"]);
  });
});

describe('atomic group ordering',()=>{
 it('preserves stack order rather than selection order and does not mutate the input',()=>{
  const before=image(['a','b','c','d'].map(id=>layer(id)));
  const r=applyImageEdit(before,{kind:'moveLayers',layerIds:['c','a'],targetLayerId:'d',placement:'after'});
  expect(r.ok).toBe(true);if(!r.ok)return;
  expect(r.value.after.layers.map(l=>l.id)).toEqual(['b','d','a','c']);expect(r.value.after.revision).toBe(8);
  expect(before.layers.map(l=>l.id)).toEqual(['a','b','c','d']);
 });
 it('refuses missing, duplicate, sparse and locked selections without partial ordering',()=>{
  const before=image([layer('a'),layer('b',{locked:true}),layer('c')]);
  for(const layerIds of [['missing'],['a','a'],['a',,'b'],['a','b']]){
   expect(applyImageEdit(before,asEdit({kind:'moveLayers',layerIds,targetLayerId:'c',placement:'after'})).ok).toBe(false);
  }
  expect(before.layers.map(l=>l.id)).toEqual(['a','b','c']);
 });
 it('allows a no-op at exhausted revision but refuses a real change',()=>{
  const before=image([layer('a'),layer('b')],{revision:Number.MAX_SAFE_INTEGER});
  const edit={kind:'moveLayers' as const,layerIds:['a'],targetLayerId:'b',placement:'before' as const};
  const noop=applyImageEdit(before,edit);expect(noop).toMatchObject({ok:true,value:{changed:false}});
  expect(applyImageEdit(before,{...edit,placement:'after'}).ok).toBe(false);
 });
});

describe('atomic opacity changes',()=>{
 it('changes all selected opacities in one revision and preserves unrelated fields',()=>{
  const before=image([layer('a',{opacity:0.8}),layer('b',{opacity:0.3}),layer('c')]);
  const r=applyImageEdit(before,{kind:'setLayerOpacities',changes:[{layerId:'a',before:0.8,opacity:0.6},{layerId:'b',before:0.3,opacity:0.1}]});
  expect(r).toMatchObject({ok:true,value:{changed:true,visualChanged:true,after:{revision:8}}});
  if(r.ok){expect(r.value.after.layers.map(l=>l.opacity)).toEqual([0.6,0.1,1]);expect(r.value.after.layers[2]).toEqual(before.layers[2]);}
  expect(before.layers.map(l=>l.opacity)).toEqual([0.8,0.3,1]);
 });
 it('refuses stale, locked, missing and invalid members before changing any layer',()=>{
  const before=image([layer('a'),layer('b',{locked:true})]);
  for(const changes of [
   [{layerId:'a',before:0.9,opacity:0.5}],
   [{layerId:'a',before:1,opacity:0.5},{layerId:'b',before:1,opacity:0.5}],
   [{layerId:'a',before:1,opacity:0.5},{layerId:'missing',before:1,opacity:0.5}],
   [{layerId:'a',before:1,opacity:NaN}],
   [{layerId:'a',before:1,opacity:0.5},{layerId:'a',before:1,opacity:0.5}],
   [{layerId:'a',before:1,opacity:0.5},,]
  ])expect(applyImageEdit(before,asEdit({kind:'setLayerOpacities',changes})).ok).toBe(false);
  expect(before.layers.map(l=>l.opacity)).toEqual([1,1]);
 });
 it('allows unchanged locked layers and no-op at exhausted revision',()=>{
  const before=image([layer('a',{locked:true})],{revision:Number.MAX_SAFE_INTEGER});
  expect(applyImageEdit(before,{kind:'setLayerOpacities',changes:[{layerId:'a',before:1,opacity:1}]})).toMatchObject({ok:true,value:{changed:false}});
 });
});
