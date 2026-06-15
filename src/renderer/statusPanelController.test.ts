import { describe, expect, it } from "vitest";
import {
  statusPanelToggleClassName,
  swbStatusLabel,
  updateCheckButtonLabel
} from "./statusPanelController";

describe("statusPanelController", () => {
  it("labels SWB status by import need before warning before ready", () => {
    expect(swbStatusLabel({ needsSwbImport: true, hasSwbWarning: true })).toBe("SWB import needed");
    expect(swbStatusLabel({ needsSwbImport: false, hasSwbWarning: true })).toBe("SWB warning");
    expect(swbStatusLabel({ needsSwbImport: false, hasSwbWarning: false })).toBe("SWB ready");
  });

  it("shows update checking progress in the status action label", () => {
    expect(updateCheckButtonLabel("checking")).toBe("Checking...");
    expect(updateCheckButtonLabel("idle")).toBe("Check for updates");
    expect(updateCheckButtonLabel("available")).toBe("Check for updates");
  });

  it("marks the status toggle when workspace, file names, SWB, or updates need attention", () => {
    expect(
      statusPanelToggleClassName({
        workspaceSaveState: "saved",
        fileNameSyncState: "synced",
        hasSwbWarning: false,
        updateNoticeStatus: "idle"
      })
    ).toBe("status-toggle ");
    expect(
      statusPanelToggleClassName({
        workspaceSaveState: "error",
        fileNameSyncState: "synced",
        hasSwbWarning: false,
        updateNoticeStatus: "idle"
      })
    ).toBe("status-toggle needs-attention");
    expect(
      statusPanelToggleClassName({
        workspaceSaveState: "saved",
        fileNameSyncState: "unsynced",
        hasSwbWarning: false,
        updateNoticeStatus: "idle"
      })
    ).toBe("status-toggle needs-attention");
    expect(
      statusPanelToggleClassName({
        workspaceSaveState: "saved",
        fileNameSyncState: "synced",
        hasSwbWarning: true,
        updateNoticeStatus: "idle"
      })
    ).toBe("status-toggle needs-attention");
    expect(
      statusPanelToggleClassName({
        workspaceSaveState: "saved",
        fileNameSyncState: "synced",
        hasSwbWarning: false,
        updateNoticeStatus: "available"
      })
    ).toBe("status-toggle needs-attention");
  });

});
