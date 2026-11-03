export {};
declare global {
  interface Window { flowEditor: import("../../platform/contracts/flowEditor").FlowEditorBridge }
}
