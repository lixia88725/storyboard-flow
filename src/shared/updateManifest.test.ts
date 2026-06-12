import { describe, expect, it } from "vitest";
import {
  cacheBustedUpdateManifestUrl,
  currentPlatformDownloadKey,
  findAvailableUpdate,
  isVersionGreater,
  parseUpdateManifest
} from "./updateManifest";

describe("updateManifest", () => {
  it("adds a cache-busting query to manifest URLs", () => {
    expect(
      cacheBustedUpdateManifestUrl(
        "https://raw.githubusercontent.com/lixia88725/storyboard-flow-releases/main/update.json",
        123
      )
    ).toBe("https://raw.githubusercontent.com/lixia88725/storyboard-flow-releases/main/update.json?_=123");

    expect(cacheBustedUpdateManifestUrl("not a url", 123)).toBe("not a url");
  });

  it("detects a newer semantic version", () => {
    expect(isVersionGreater("0.1.1", "0.1.0")).toBe(true);
    expect(isVersionGreater("0.2.0", "0.1.9")).toBe(true);
    expect(isVersionGreater("1.0.0", "0.9.9")).toBe(true);
    expect(isVersionGreater("0.1.0", "0.1.0")).toBe(false);
    expect(isVersionGreater("0.1.0", "0.1.1")).toBe(false);
  });

  it("ignores invalid version strings", () => {
    expect(isVersionGreater("latest", "0.1.0")).toBe(false);
    expect(isVersionGreater("0.1.1", "dev")).toBe(false);
  });

  it("parses a valid manifest and picks the current platform download", () => {
    const manifest = parseUpdateManifest({
      latest: "0.1.1",
      notes: "Update notes",
      releaseUrl: "https://github.com/lixia88725/storyboard-flow-releases/releases/tag/v0.1.1",
      downloads: {
        windowsPortable: "https://example.com/windows.zip",
        macosAppleSilicon: "https://example.com/macos.zip"
      }
    });

    expect(manifest).toEqual({
      latest: "0.1.1",
      notes: "Update notes",
      releaseUrl: "https://github.com/lixia88725/storyboard-flow-releases/releases/tag/v0.1.1",
      downloads: {
        windowsPortable: "https://example.com/windows.zip",
        macosAppleSilicon: "https://example.com/macos.zip"
      }
    });
    expect(currentPlatformDownloadKey("win32", "x64")).toBe("windowsPortable");
    expect(currentPlatformDownloadKey("darwin", "arm64")).toBe("macosAppleSilicon");
    expect(currentPlatformDownloadKey("darwin", "x64")).toBe("macosIntel");
  });

  it("returns an available update only when the current platform has a download", () => {
    const update = findAvailableUpdate({
      currentVersion: "0.1.0",
      platform: "win32",
      arch: "x64",
      manifest: {
        latest: "0.1.1",
        releaseUrl: "https://github.com/lixia88725/storyboard-flow-releases/releases/tag/v0.1.1",
        downloads: {
          windowsPortable: "https://example.com/windows.zip"
        }
      }
    });

    expect(update).toEqual({
      version: "0.1.1",
      releaseUrl: "https://github.com/lixia88725/storyboard-flow-releases/releases/tag/v0.1.1",
      downloadUrl: "https://example.com/windows.zip",
      notes: undefined
    });

    expect(
      findAvailableUpdate({
        currentVersion: "0.1.0",
        platform: "darwin",
        arch: "arm64",
        manifest: {
          latest: "0.1.1",
          releaseUrl: "https://github.com/lixia88725/storyboard-flow-releases/releases/tag/v0.1.1",
          downloads: {
            windowsPortable: "https://example.com/windows.zip"
          }
        }
      })
    ).toBeUndefined();
  });
});
