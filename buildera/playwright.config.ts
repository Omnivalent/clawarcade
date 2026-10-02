import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 120_000,
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    // Cloud/CI images may ship a pinned Chromium; point at it instead of downloading.
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
});
