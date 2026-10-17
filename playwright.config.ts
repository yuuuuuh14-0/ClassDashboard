import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 45_000,
  reporter: "list",
  use: { ...devices["Desktop Chrome"], channel: "msedge", baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  webServer: [
    { command: "node tests/mock-supabase.mjs", url: "http://127.0.0.1:54329/health", reuseExistingServer: false },
    { command: "npm run dev -- --hostname 127.0.0.1 --port 3100", url: "http://127.0.0.1:3100/login", reuseExistingServer: false, timeout: 120_000,
      env: { PLAYWRIGHT_TEST: "1", SUPABASE_URL: "http://127.0.0.1:54329", SUPABASE_ANON_KEY: "test-publishable-key", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54329", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key", SUPABASE_SECRET_KEY: "test-server-only-key", SUPABASE_SERVICE_ROLE_KEY: "test-server-only-key", APP_ORIGIN: "http://127.0.0.1:3100" } },
  ],
});
