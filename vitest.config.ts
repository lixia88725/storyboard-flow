import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "electron/**/*.test.ts"],
    exclude: ["src/renderer/normalSaveMetadataHistory.test.ts"],
    maxWorkers: 1,
    minWorkers: 1
  }
});
