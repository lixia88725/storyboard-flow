import { defineConfig } from 'vitest/config';
export default defineConfig({cacheDir:'./private-full-cache',test:{include:['electron/**/*.test.ts','src/**/*.test.ts'],exclude:['src/renderer/normalSaveMetadataHistory.test.ts'],maxWorkers:1,minWorkers:1}});
