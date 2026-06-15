import { describe, expect, it } from "vitest";
import { resolveUpdateNoticeFromManifest } from "./updateNoticeController";

describe("updateNoticeController", () => {
  it("falls back to the release page when a newer version has no direct platform package", () => {
    const notice = resolveUpdateNoticeFromManifest({
      appInfo: {
        version: "1.0.0",
        platform: "darwin",
        arch: "arm64"
      },
      manifest: {
        latest: "1.1.0",
        releaseUrl: "https://example.com/releases/1.1.0",
        downloads: {
          windowsPortable: "https://example.com/storyboard-flow-win.zip"
        }
      }
    });

    expect(notice).toEqual({
      status: "available",
      update: {
        version: "1.1.0",
        notes: "No direct darwin/arm64 package is listed. Open the release page to choose manually.",
        releaseUrl: "https://example.com/releases/1.1.0",
        downloadUrl: "https://example.com/releases/1.1.0"
      }
    });
  });
});
