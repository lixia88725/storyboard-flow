import { describe, expect, it } from "vitest";
import { knownImageHasExternalChange } from "./externalChanges.js";

const ownedShot = {
  id: "shot-a",
  swb: {
    status: "owned" as const,
    canvasWidth: 1920,
    canvasHeight: 1080,
    baseFingerprint: "json-pixels"
  }
};

describe("knownImageHasExternalChange", () => {
  it("does not report an unchanged legacy owned TIFF when no fingerprint baseline exists", () => {
    expect(
      knownImageHasExternalChange(
        {
          id: "shot-a",
          swb: {
            status: "owned" as const,
            canvasWidth: 1920,
            canvasHeight: 1080
          }
        },
        "current-pixels",
        {
          shotId: "shot-a",
          canvasWidth: 1920,
          canvasHeight: 1080
        }
      )
    ).toBe(false);
  });

  it("still reports legacy owned TIFFs when metadata no longer matches the shot", () => {
    expect(
      knownImageHasExternalChange(
        {
          id: "shot-a",
          swb: {
            status: "owned" as const,
            canvasWidth: 1920,
            canvasHeight: 1080
          }
        },
        "current-pixels",
        {
          shotId: "other-shot",
          canvasWidth: 1920,
          canvasHeight: 1080
        }
      )
    ).toBe(true);
  });

  it("uses the project fingerprint before stale TIFF metadata", () => {
    expect(
      knownImageHasExternalChange(ownedShot, "json-pixels", {
        shotId: "shot-a",
        canvasWidth: 1920,
        canvasHeight: 1080,
        baseFingerprint: "old-xmp-pixels"
      })
    ).toBe(false);
  });

  it("detects pixel changes against the project fingerprint", () => {
    expect(
      knownImageHasExternalChange(ownedShot, "photoshop-pixels", {
        shotId: "shot-a",
        canvasWidth: 1920,
        canvasHeight: 1080,
        baseFingerprint: "json-pixels"
      })
    ).toBe(true);
  });

  it("does not treat a copied SWB TIFF as externally changed when pixels match the project baseline", () => {
    expect(
      knownImageHasExternalChange(ownedShot, "json-pixels", {
        shotId: "other-shot",
        canvasWidth: 1920,
        canvasHeight: 1080,
        baseFingerprint: "json-pixels"
      })
    ).toBe(false);
  });

  it("rechecks warning shots whose pixels match so stale import warnings can be cleared", () => {
    expect(
      knownImageHasExternalChange(
        {
          ...ownedShot,
          swb: {
            ...ownedShot.swb,
            status: "incompatible-external-edit" as const
          }
        },
        "json-pixels",
        {
          shotId: "other-shot",
          canvasWidth: 1920,
          canvasHeight: 1080,
          baseFingerprint: "json-pixels"
        }
      )
    ).toBe(true);
  });

  it("uses TIFF metadata to detect incompatible structure changes when pixels also changed", () => {
    expect(
      knownImageHasExternalChange(ownedShot, "new-pixels", {
        shotId: "other-shot",
        canvasWidth: 1920,
        canvasHeight: 1080,
        baseFingerprint: "json-pixels"
      })
    ).toBe(true);
  });
});
