const { defineConfig, devices } = require('@playwright/test');

const config = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      OAUTH_SERVER_URL: 'http://localhost:4000',
      VITE_ANALYTICS_ENDPOINT: '/api/analytics',
      VITE_ANALYTICS_WEBSITE_ID: 'dummy',
      VITE_OAUTH_PORTAL_URL: 'http://localhost:3000/mock-oauth',
      VITE_APP_ID: 'test-app-id',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

console.log('WebServer env from config:', config.webServer.env);

module.exports = config;
