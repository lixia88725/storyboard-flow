import { describe, expect, it } from "vitest";
import {
  statusPanelToggleClassName,
  flowStatusLabel,
  updateCheckButtonLabel
} from "./statusPanelController";

describe("statusPanelController", () => {
  it("labels FLOW status by import need before warning before ready", () => {
    expect(flowStatusLabel({ needsFlowImport: true, hasFlowWarning: true })).toBe("FLOW import needed");
    expect(flowStatusLabel({ needsFlowImport: false, hasFlowWarning: true })).toBe("FLOW warning");
    expect(flowStatusLabel({ needsFlowImport: false, hasFlowWarning: false })).toBe("FLOW ready");
  });

  it("shows update checking progress in the status action label", () => {
    expect(updateCheckButtonLabel("checking")).toBe("Checking...");
    expect(updateCheckButtonLabel("idle")).toBe("Check for updates");
    expect(updateCheckButtonLabel("available")).toBe("Check for updates");
  });

  it("marks the status toggle when workspace, file names, FLOW, or updates need attention", () => {
    expect(
      statusPanelToggleClassName({
        workspaceSaveState: "saved",
        fileNameSyncState: "synced",
        hasFlowWarning: false,
        updateNoticeStatus: "idle"
      })
    ).toBe("status-toggle ");
    expect(
      statusPanelToggleClassName({
        workspaceSaveState: "error",
        fileNameSyncState: "synced",
        hasFlowWarning: false,
        updateNoticeStatus: "idle"
      })
    ).toBe("status-toggle needs-attention");
    expect(
      statusPanelToggleClassName({
        workspaceSaveState: "saved",
        fileNameSyncState: "unsynced",
        hasFlowWarning: false,
        updateNoticeStatus: "idle"
      })
    ).toBe("status-toggle needs-attention");
    expect(
      statusPanelToggleClassName({
        workspaceSaveState: "saved",
        fileNameSyncState: "synced",
        hasFlowWarning: true,
        updateNoticeStatus: "idle"
      })
    ).toBe("status-toggle needs-attention");
    expect(
      statusPanelToggleClassName({
        workspaceSaveState: "saved",
        fileNameSyncState: "synced",
        hasFlowWarning: false,
        updateNoticeStatus: "available"
      })
    ).toBe("status-toggle needs-attention");
  });

});
